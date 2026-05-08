import * as vscode from "vscode";
import {
  DaemonHealth,
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_DAEMON_URL,
  HealthState,
  StatuslineData,
  buildStatusText,
  buildTooltip,
  buildTooltipHeader,
  clickUrl,
  deriveHealthState,
  fetchDaemonHealth,
  fetchStatusline,
  isAllowedCloudEndpoint,
  isLoopbackDaemonUrl,
  MIN_API_VERSION,
  resolveCosts,
} from "./budiClient";
import { upgradeCommandForPlatform } from "./installCommands";
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
let upgradeChannel: vscode.OutputChannel | undefined;
let refreshInFlight = false;
let pendingRefreshDaemonUrl: string | undefined;
let cachedStatusline: StatuslineData | null = null;
let apiVersionWarningShown = false;
let daemonOfflineWarningLogged = false;
let lastState: HealthState = "gray";
let everSawDaemon = false;
let suppressUpdatePrompt = false;

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("budi");
  context.subscriptions.push(log);
  log.appendLine(`[budi] activated at ${new Date().toISOString()}`);

  everSawDaemon = context.globalState.get<boolean>(EVER_SAW_DAEMON_KEY, false);

  const settings = vscode.workspace.getConfiguration("budi");
  let daemonUrl: string = readDaemonUrl(settings);
  let cloudEndpoint: string = readCloudEndpoint(settings);
  let dataPollInterval: number = readPollingInterval(settings);
  suppressUpdatePrompt = readSuppressUpdatePrompt(settings);

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
  statusBarItem.tooltip = `${buildTooltipHeader([])}\n\nLoading...`;
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
      const url = clickUrl({ cloudEndpoint, statusline: cachedStatusline });
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("budi.openDashboard", () => {
      const url = clickUrl({ cloudEndpoint, statusline: cachedStatusline });
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
      dataPollInterval = readPollingInterval(updated);
      suppressUpdatePrompt = readSuppressUpdatePrompt(updated);
      restartDataPoll(daemonUrl, cloudEndpoint, dataPollInterval, context);
      requestRefresh(daemonUrl, cloudEndpoint, context);
    }),
  );

  // Re-read settings when the user later trusts the workspace
  // (siropkin/budi-cursor#45). Until trust is granted we ignore
  // workspace-scoped overrides for security-sensitive keys; once
  // granted, those values become effective without an editor reload.
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      log.appendLine("[budi] workspace trust granted — re-reading settings");
      const updated = vscode.workspace.getConfiguration("budi");
      daemonUrl = readDaemonUrl(updated);
      cloudEndpoint = readCloudEndpoint(updated);
      dataPollInterval = readPollingInterval(updated);
      suppressUpdatePrompt = readSuppressUpdatePrompt(updated);
      restartDataPoll(daemonUrl, cloudEndpoint, dataPollInterval, context);
      requestRefresh(daemonUrl, cloudEndpoint, context);
    }),
  );

  requestRefresh(daemonUrl, cloudEndpoint, context);
  startDataPoll(daemonUrl, cloudEndpoint, dataPollInterval, context);
}

// Workspace-trust gate (siropkin/budi-cursor#45). In an untrusted
// workspace we deliberately ignore workspace-scoped overrides and read
// only the user-scoped (global) value, falling back to the default if
// the user has not set one. This is the platform-level companion to
// the per-setting allow-lists in #42 and #43: even if a malicious repo
// somehow bypasses the value-shape checks, an untrusted workspace's
// overrides never reach this code path. We cannot rely on VS Code's
// untrusted-workspace machinery alone because the user can opt back
// into "support all workspaces" — so the trust gate is enforced here
// in code, not just declared in `package.json`.
function readSecuritySensitive<T>(
  settings: vscode.WorkspaceConfiguration,
  key: string,
  fallback: T,
): T {
  if (vscode.workspace.isTrusted) return settings.get<T>(key, fallback);
  const inspected = settings.inspect<T>(key);
  return inspected?.globalValue ?? fallback;
}

// Refuse non-loopback `daemonUrl` overrides (siropkin/budi-cursor#42).
// `getConfiguration("budi").get` returns the merged user/workspace
// value, so a malicious repo's `.vscode/settings.json` would otherwise
// redirect daemon polling — including the absolute workspace path — to
// an attacker host. Loopback is the only legitimate target per SOUL.md.
function readDaemonUrl(settings: vscode.WorkspaceConfiguration): string {
  const raw = readSecuritySensitive<string>(settings, "daemonUrl", DEFAULT_DAEMON_URL);
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
  const raw = readSecuritySensitive<string>(settings, "cloudEndpoint", DEFAULT_CLOUD_ENDPOINT);
  if (isAllowedCloudEndpoint(raw)) return raw;
  log.appendLine(
    `[budi] ignoring off-domain cloudEndpoint=${JSON.stringify(raw)} — cloud endpoint must be an https URL on getbudi.dev. Falling back to ${DEFAULT_CLOUD_ENDPOINT}.`,
  );
  return DEFAULT_CLOUD_ENDPOINT;
}

function readPollingInterval(settings: vscode.WorkspaceConfiguration): number {
  return readSecuritySensitive<number>(settings, "pollingIntervalMs", 15000);
}

// `budi.suppressUpdatePrompt` lets users on centrally-managed daemons
// silence the actionable upgrade toast when a `version-stale` health is
// detected (siropkin/budi-cursor#51). The status-bar copy still reads
// `budi · update needed`, so this is a softer mute, not a hide. Read
// through the regular merged config — there is no security blast radius.
function readSuppressUpdatePrompt(settings: vscode.WorkspaceConfiguration): boolean {
  return settings.get<boolean>("suppressUpdatePrompt", false);
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

/**
 * Fire the actionable upgrade toast at most once per session
 * (siropkin/budi-cursor#51). The toast offers two buttons:
 *
 * - **Show update command** — opens an output channel pre-populated with
 *   `budi update` plus the platform-appropriate fallback (`brew upgrade`
 *   on macOS, the standalone install script on Linux/Windows). We never
 *   execute the command on the user's behalf — daemon installs span
 *   Homebrew, manual binaries, and corp-managed paths.
 * - **Dismiss** — silences the toast for the rest of the session. The
 *   bar copy stays as `budi · update needed` so the surface does not
 *   pretend the daemon is fine.
 *
 * `budi.suppressUpdatePrompt = true` skips the toast entirely (centrally
 * managed daemons), but the bar copy and tooltip still surface the
 * stale-version state.
 */
function maybeShowVersionStaleToast(health: DaemonHealth): void {
  if (apiVersionWarningShown) return;
  apiVersionWarningShown = true;
  if (suppressUpdatePrompt) {
    log.appendLine(
      "[budi] version-stale detected but budi.suppressUpdatePrompt=true — toast suppressed.",
    );
    return;
  }
  void (async () => {
    const choice = await vscode.window.showWarningMessage(
      `budi: Local daemon is older than this extension requires ` +
        `(daemon api_version=${health.api_version}, required=${MIN_API_VERSION}). ` +
        `Run \`budi update\` and reload the window.`,
      "Show update command",
      "Dismiss",
    );
    if (choice === "Show update command") {
      showUpgradeCommand(health);
    }
  })();
}

function ensureUpgradeChannel(): vscode.OutputChannel {
  if (!upgradeChannel) {
    upgradeChannel = vscode.window.createOutputChannel("budi: Update");
  }
  return upgradeChannel;
}

function showUpgradeCommand(health: DaemonHealth): void {
  const channel = ensureUpgradeChannel();
  const platformCommand = upgradeCommandForPlatform(process.platform);
  channel.clear();
  channel.appendLine("budi: Upgrade your local daemon");
  channel.appendLine("");
  channel.appendLine(`  Installed daemon: ${health.version} (api_version ${health.api_version})`);
  channel.appendLine(`  Required api_version: ${MIN_API_VERSION}`);
  channel.appendLine("");
  channel.appendLine("Recommended one-liner (works on every platform):");
  channel.appendLine("");
  channel.appendLine("  $ budi update");
  channel.appendLine("");
  channel.appendLine(`Or, ${platformCommand.label}:`);
  channel.appendLine("");
  channel.appendLine(`  ${platformCommand.command}`);
  channel.appendLine("");
  channel.appendLine(
    "After upgrading, reload this editor window (Developer: Reload Window) so the",
  );
  channel.appendLine("extension picks up the new daemon. The status bar should switch from");
  channel.appendLine("`budi · update needed` back to the cost line.");
  channel.show(true);
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

  const [health, statusline] = await Promise.all([
    fetchDaemonHealth(daemonUrl),
    fetchStatusline(daemonUrl, cwd),
  ]);
  cachedStatusline = statusline;

  if (health && !everSawDaemon) {
    everSawDaemon = true;
    await context.globalState.update(EVER_SAW_DAEMON_KEY, true);
    log.appendLine("[budi] first daemon detection — extension leaves firstRun mode.");
  }

  const state = deriveHealthState(health, statusline, everSawDaemon);
  lastState = state;
  statusBarItem.text = buildStatusText(state, statusline);
  statusBarItem.tooltip = buildTooltip(state, statusline, cloudEndpoint, health);

  // Single-line, grep-friendly resolved-decision log. Downstream debugging
  // ("why does my bar say update needed?") is one grep against this line
  // (siropkin/budi-cursor#51 acceptance #4).
  if (health) {
    const decision = health.api_version < MIN_API_VERSION ? "version-stale" : "accepted";
    log.appendLine(
      `[budi] daemon health: version=${health.version}, api_version=${health.api_version}, required=${MIN_API_VERSION}, decision=${decision}`,
    );
  }

  if (state === "unreachable") {
    if (!daemonOfflineWarningLogged) {
      log.appendLine("[budi] daemon unreachable — status bar showing offline. Run `budi doctor`.");
      daemonOfflineWarningLogged = true;
    }
  } else {
    daemonOfflineWarningLogged = false;
  }

  if (state === "version-stale" && health) {
    maybeShowVersionStaleToast(health);
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

  // state === "unreachable" while the welcome view is open means the
  // user installed the daemon but it is still not responding. Keep the
  // install stage open with a hint in the output channel rather than
  // an in-face modal.
  if (state === "unreachable") {
    transitionTo("needs-install");
    log.appendLine(
      "[budi] daemon still unreachable after install flow — run `budi doctor` once the install finishes.",
    );
    return;
  }

  // state === "version-stale" means the daemon is responding (the
  // install flow worked) but the user is on an older release than this
  // extension supports. Move them past the install stage so the upgrade
  // toast carries the action — re-running the install command would
  // upgrade the daemon, but the welcome view is the wrong surface for
  // that conversation.
  if (state === "version-stale") {
    transitionTo("needs-init");
  }
}

function openWelcome(
  context: vscode.ExtensionContext,
  stage: WelcomeStage,
  daemonUrl: string,
  cloudEndpoint: string,
): void {
  showWelcome(context, stage, {
    onRecheck: async () => {
      log.appendLine("[budi] welcome-view recheck triggered");
      // A single eager poll; the normal loop keeps going underneath.
      await refreshData(daemonUrl, cloudEndpoint, context);
    },
  });
}
