import * as vscode from "vscode";
import {
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_DAEMON_URL,
  Host,
  HealthState,
  StatuslineData,
  buildProviderList,
  buildStatusText,
  buildTooltip,
  buildTooltipHeader,
  clickUrl,
  deriveHealthState,
  detectHost,
  fetchDaemonHealth,
  fetchStatusline,
  isAllowedCloudEndpoint,
  isLoopbackDaemonUrl,
  MIN_API_VERSION,
  resolveCosts,
} from "./budiClient";
import { getDetectedProviders, startExtensionsProbe } from "./extensionsProbe";
import { clearActiveWorkspace, writeActiveWorkspace } from "./sessionStore";
import {
  hideWelcome,
  isWelcomeVisible,
  showWelcome,
  transitionTo,
  type WelcomeStage,
} from "./welcomeView";

const EVER_SAW_DAEMON_KEY = "budi.everSawDaemon";

let statusBarItem: vscode.StatusBarItem;
let dataPollTimer: ReturnType<typeof setInterval> | undefined;
let log: vscode.OutputChannel;
let refreshInFlight = false;
let pendingRefreshDaemonUrl: string | undefined;
let cachedStatusline: StatuslineData | null = null;
let apiVersionWarningShown = false;
let daemonOfflineWarningLogged = false;
let lastState: HealthState = "gray";
let everSawDaemon = false;
let host: Host = "cursor";

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("budi");
  context.subscriptions.push(log);
  log.appendLine(`[budi] activated at ${new Date().toISOString()}`);

  host = detectHost(vscode.env.appName);
  log.appendLine(`[budi] host detected: appName="${vscode.env.appName}" → ${host}`);

  const initialProviders = startExtensionsProbe(context, {
    host,
    log,
    onChange: (providers) => {
      log.appendLine(`[budi] AI extension list changed → providers=[${providers.join(", ")}]`);
    },
  });
  log.appendLine(`[budi] initial providers=[${initialProviders.join(", ")}]`);

  everSawDaemon = context.globalState.get<boolean>(EVER_SAW_DAEMON_KEY, false);

  const settings = vscode.workspace.getConfiguration("budi");
  let daemonUrl: string = readDaemonUrl(settings);
  let cloudEndpoint: string = readCloudEndpoint(settings);
  let dataPollInterval: number = settings.get("pollingIntervalMs", 15000);

  const folders = vscode.workspace.workspaceFolders;
  log.appendLine(
    `[budi] workspaceFolders = ${folders?.map((f) => f.uri.fsPath).join(", ") ?? "none"}`,
  );
  if (folders && folders.length > 0) {
    writeActiveWorkspace(folders[0].uri.fsPath);
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
  statusBarItem.name = "budi";
  statusBarItem.command = "budi.statusBarClick";
  statusBarItem.text = "budi";
  statusBarItem.tooltip = `${buildTooltipHeader(host, initialProviders)}\n\nLoading...`;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Single command the status bar always routes through. It branches
  // on the current state instead of hard-coding the dashboard URL so
  // first-run users land in the welcome view (siropkin/budi#314) and
  // everyone else keeps the Claude Code click-through shape.
  context.subscriptions.push(
    vscode.commands.registerCommand("budi.statusBarClick", () => {
      if (lastState === "firstRun") {
        openWelcome(context, "needs-install", daemonUrl, cloudEndpoint);
        return;
      }
      const url = clickUrl({ cloudEndpoint, statusline: cachedStatusline, host });
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("budi.openDashboard", () => {
      const url = clickUrl({ cloudEndpoint, statusline: cachedStatusline, host });
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("budi.refreshStatus", () => {
      log.appendLine("[budi] manual refresh triggered");
      requestRefresh(daemonUrl, cloudEndpoint, context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("budi.showWelcome", () => {
      const stage: WelcomeStage = everSawDaemon ? "needs-init" : "needs-install";
      openWelcome(context, stage, daemonUrl, cloudEndpoint);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("budi")) return;
      const updated = vscode.workspace.getConfiguration("budi");
      daemonUrl = readDaemonUrl(updated);
      cloudEndpoint = readCloudEndpoint(updated);
      dataPollInterval = updated.get("pollingIntervalMs", 15000);
      restartDataPoll(daemonUrl, cloudEndpoint, dataPollInterval, context);
      requestRefresh(daemonUrl, cloudEndpoint, context);
    }),
  );

  void checkApiVersionOnce(daemonUrl);
  requestRefresh(daemonUrl, cloudEndpoint, context);
  startDataPoll(daemonUrl, cloudEndpoint, dataPollInterval, context);
}

// Refuse non-loopback `daemonUrl` overrides (siropkin/budi-cursor#42).
// `getConfiguration("budi").get` returns the merged user/workspace
// value, so a malicious repo's `.vscode/settings.json` would otherwise
// redirect daemon polling — including the absolute workspace path — to
// an attacker host. Loopback is the only legitimate target per SOUL.md.
function readDaemonUrl(settings: vscode.WorkspaceConfiguration): string {
  const raw = settings.get<string>("daemonUrl", DEFAULT_DAEMON_URL);
  if (isLoopbackDaemonUrl(raw)) return raw;
  log.appendLine(
    `[budi] ignoring non-loopback daemonUrl=${JSON.stringify(raw)} — daemon must run on 127.0.0.1, localhost, or ::1. Falling back to ${DEFAULT_DAEMON_URL}.`,
  );
  return DEFAULT_DAEMON_URL;
}

// Refuse off-domain `cloudEndpoint` overrides (siropkin/budi-cursor#43).
// The status-bar click hands `${cloudEndpoint}/dashboard[...]` straight
// to `vscode.env.openExternal`, so a workspace override pointing at
// `app.getbudi.dev.attacker.example` would be a one-click phishing
// primitive. The cloud only ever lives on getbudi.dev (SOUL.md §"Repos
// in this constellation"); anything else is treated as malicious and
// the default is used instead.
function readCloudEndpoint(settings: vscode.WorkspaceConfiguration): string {
  const raw = settings.get<string>("cloudEndpoint", DEFAULT_CLOUD_ENDPOINT);
  if (isAllowedCloudEndpoint(raw)) return raw;
  log.appendLine(
    `[budi] ignoring off-domain cloudEndpoint=${JSON.stringify(raw)} — cloud endpoint must be an https URL on getbudi.dev. Falling back to ${DEFAULT_CLOUD_ENDPOINT}.`,
  );
  return DEFAULT_CLOUD_ENDPOINT;
}

export function deactivate(): void {
  if (dataPollTimer) {
    clearInterval(dataPollTimer);
    dataPollTimer = undefined;
  }
  clearActiveWorkspace();
}

function startDataPoll(
  daemonUrl: string,
  cloudEndpoint: string,
  intervalMs: number,
  context: vscode.ExtensionContext,
): void {
  dataPollTimer = setInterval(() => {
    requestRefresh(daemonUrl, cloudEndpoint, context);
  }, intervalMs);
}

function restartDataPoll(
  daemonUrl: string,
  cloudEndpoint: string,
  intervalMs: number,
  context: vscode.ExtensionContext,
): void {
  if (dataPollTimer) clearInterval(dataPollTimer);
  startDataPoll(daemonUrl, cloudEndpoint, intervalMs, context);
}

async function checkApiVersionOnce(daemonUrl: string): Promise<void> {
  const health = await fetchDaemonHealth(daemonUrl);
  if (!health) return;
  log.appendLine(
    `[budi] daemon health: version=${health.version}, api_version=${health.api_version}`,
  );
  if (health.api_version < MIN_API_VERSION && !apiVersionWarningShown) {
    apiVersionWarningShown = true;
    void vscode.window.showWarningMessage(
      `budi: The daemon (api_version ${health.api_version}) is older than ` +
        `this extension requires (api_version ${MIN_API_VERSION}). ` +
        `Run \`budi update\` or reinstall from https://getbudi.dev.`,
    );
  }
}

function requestRefresh(
  daemonUrl: string,
  cloudEndpoint: string,
  context: vscode.ExtensionContext,
): void {
  pendingRefreshDaemonUrl = daemonUrl;
  if (refreshInFlight) return;
  refreshInFlight = true;
  void (async () => {
    try {
      while (pendingRefreshDaemonUrl) {
        const nextDaemonUrl = pendingRefreshDaemonUrl;
        pendingRefreshDaemonUrl = undefined;
        await refreshData(nextDaemonUrl, cloudEndpoint, context);
      }
    } catch (err) {
      log.appendLine(`[budi] refresh error: ${err}`);
    } finally {
      refreshInFlight = false;
      if (pendingRefreshDaemonUrl) {
        requestRefresh(pendingRefreshDaemonUrl, cloudEndpoint, context);
      }
    }
  })();
}

async function refreshData(
  daemonUrl: string,
  cloudEndpoint: string,
  context: vscode.ExtensionContext,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders?.[0]?.uri.fsPath;
  if (cwd) writeActiveWorkspace(cwd);

  const providers = buildProviderList(host, getDetectedProviders());
  const [health, statusline] = await Promise.all([
    fetchDaemonHealth(daemonUrl),
    fetchStatusline(daemonUrl, providers, cwd),
  ]);
  cachedStatusline = statusline;

  if (health && !everSawDaemon) {
    everSawDaemon = true;
    await context.globalState.update(EVER_SAW_DAEMON_KEY, true);
    log.appendLine("[budi] first daemon detection — extension leaves firstRun mode.");
  }

  const state = deriveHealthState(health, statusline, everSawDaemon);
  lastState = state;
  statusBarItem.text = buildStatusText(state, statusline, host);
  statusBarItem.tooltip = buildTooltip(state, statusline, cloudEndpoint, host);

  if (state === "red") {
    if (!daemonOfflineWarningLogged) {
      log.appendLine(
        "[budi] daemon not reachable — status bar showing offline. Run `budi doctor`.",
      );
      daemonOfflineWarningLogged = true;
    }
  } else {
    daemonOfflineWarningLogged = false;
  }

  // Drive the welcome view off the polled state so it stays in sync
  // without blocking the refresh loop on UI work.
  syncWelcomeView(state, statusline);
}

function syncWelcomeView(state: HealthState, statusline: StatuslineData | null): void {
  if (!isWelcomeVisible()) return;

  // First successful Cursor-provider reading retires the welcome view.
  if (state === "green" || state === "yellow") {
    const costs = resolveCosts(statusline ?? {});
    const hasCursorTraffic = costs.cost1d > 0 || costs.cost7d > 0 || costs.cost30d > 0;
    if (hasCursorTraffic) {
      hideWelcome();
      log.appendLine("[budi] first Cursor reading recorded — welcome view retired.");
      return;
    }
    // Daemon is up but no Cursor traffic yet — keep the user on the
    // init hand-off stage so they know how to verify.
    transitionTo("needs-init");
    return;
  }

  if (state === "firstRun") {
    transitionTo("needs-install");
    return;
  }

  // state === "red" while the welcome view is open means the user
  // installed the daemon but it is still not reachable. Keep the
  // install stage open with a hint in the output channel rather
  // than an in-face modal.
  if (state === "red") {
    transitionTo("needs-install");
    log.appendLine(
      "[budi] daemon still unreachable after install flow — run `budi doctor` once the install finishes.",
    );
  }
}

function openWelcome(
  context: vscode.ExtensionContext,
  stage: WelcomeStage,
  daemonUrl: string,
  cloudEndpoint: string,
): void {
  showWelcome(context, stage, {
    host,
    onRecheck: async () => {
      log.appendLine("[budi] welcome-view recheck triggered");
      // A single eager poll; the normal loop keeps going underneath.
      await refreshData(daemonUrl, cloudEndpoint, context);
    },
  });
}
