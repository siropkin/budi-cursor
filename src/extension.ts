import * as vscode from "vscode";
import {
  StatuslineData,
  buildStatusText,
  buildTooltip,
  clickUrl,
  deriveHealthState,
  fetchDaemonHealth,
  fetchStatusline,
  MIN_API_VERSION,
} from "./budiClient";
import { clearActiveWorkspace, writeActiveWorkspace } from "./sessionStore";

let statusBarItem: vscode.StatusBarItem;
let dataPollTimer: ReturnType<typeof setInterval> | undefined;
let log: vscode.OutputChannel;
let refreshInFlight = false;
let pendingRefreshDaemonUrl: string | undefined;
let cachedStatusline: StatuslineData | null = null;
let apiVersionWarningShown = false;
let daemonOfflineWarningLogged = false;

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("budi");
  context.subscriptions.push(log);
  log.appendLine(`[budi] activated at ${new Date().toISOString()}`);

  const settings = vscode.workspace.getConfiguration("budi");
  let daemonUrl: string = settings.get("daemonUrl", "http://127.0.0.1:7878");
  let cloudEndpoint: string = settings.get("cloudEndpoint", "https://app.getbudi.dev");
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
  statusBarItem.command = "budi.openDashboard";
  statusBarItem.text = "\u26AA budi";
  statusBarItem.tooltip = "budi — Cursor usage\n\nLoading...";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("budi.openDashboard", () => {
      const url = clickUrl({ cloudEndpoint, statusline: cachedStatusline });
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("budi.refreshStatus", () => {
      log.appendLine("[budi] manual refresh triggered");
      requestRefresh(daemonUrl, cloudEndpoint);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("budi")) return;
      const updated = vscode.workspace.getConfiguration("budi");
      daemonUrl = updated.get("daemonUrl", "http://127.0.0.1:7878");
      cloudEndpoint = updated.get("cloudEndpoint", "https://app.getbudi.dev");
      dataPollInterval = updated.get("pollingIntervalMs", 15000);
      restartDataPoll(daemonUrl, cloudEndpoint, dataPollInterval);
      requestRefresh(daemonUrl, cloudEndpoint);
    }),
  );

  void checkApiVersionOnce(daemonUrl);
  requestRefresh(daemonUrl, cloudEndpoint);
  startDataPoll(daemonUrl, cloudEndpoint, dataPollInterval);
}

export function deactivate(): void {
  if (dataPollTimer) {
    clearInterval(dataPollTimer);
    dataPollTimer = undefined;
  }
  clearActiveWorkspace();
}

function startDataPoll(daemonUrl: string, cloudEndpoint: string, intervalMs: number): void {
  dataPollTimer = setInterval(() => {
    requestRefresh(daemonUrl, cloudEndpoint);
  }, intervalMs);
}

function restartDataPoll(daemonUrl: string, cloudEndpoint: string, intervalMs: number): void {
  if (dataPollTimer) clearInterval(dataPollTimer);
  startDataPoll(daemonUrl, cloudEndpoint, intervalMs);
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

function requestRefresh(daemonUrl: string, cloudEndpoint: string): void {
  pendingRefreshDaemonUrl = daemonUrl;
  if (refreshInFlight) return;
  refreshInFlight = true;
  void (async () => {
    try {
      while (pendingRefreshDaemonUrl) {
        const nextDaemonUrl = pendingRefreshDaemonUrl;
        pendingRefreshDaemonUrl = undefined;
        await refreshData(nextDaemonUrl, cloudEndpoint);
      }
    } catch (err) {
      log.appendLine(`[budi] refresh error: ${err}`);
    } finally {
      refreshInFlight = false;
      if (pendingRefreshDaemonUrl) {
        requestRefresh(pendingRefreshDaemonUrl, cloudEndpoint);
      }
    }
  })();
}

async function refreshData(daemonUrl: string, cloudEndpoint: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders?.[0]?.uri.fsPath;
  if (cwd) writeActiveWorkspace(cwd);

  const [health, statusline] = await Promise.all([
    fetchDaemonHealth(daemonUrl),
    fetchStatusline(daemonUrl, cwd),
  ]);
  cachedStatusline = statusline;

  const state = deriveHealthState(health, statusline);
  statusBarItem.text = buildStatusText(state, statusline);
  statusBarItem.tooltip = buildTooltip(state, statusline, cloudEndpoint);

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
}
