import * as vscode from "vscode";

import {
  InstallCommand,
  initHandoffCommandFor,
  installCommandForPlatform,
} from "./installCommands";
import { recordCounterEvent } from "./onboardingCounters";

/**
 * In-editor welcome view shown when the extension is in `firstRun`
 * mode (siropkin/budi#314).
 *
 * Responsibilities:
 *   - Explain budi in one sentence and name the single command that
 *     installs it.
 *   - Offer "Open Terminal With This Command" (primary action): opens
 *     an integrated terminal with the canonical install command
 *     pre-filled but NOT executed, so the user sees what they are
 *     running before pressing enter.
 *   - Offer "I already installed it" (secondary action): force-recheck
 *     `/health` and, on success, swap the view to the hand-off step.
 *   - Once the daemon is detected, offer a single "Finish setup in
 *     terminal" action that runs `budi init && budi doctor` in a
 *     pre-filled integrated terminal (no auto-execute).
 *
 * The view retires itself automatically when the extension sees its
 * first successful Cursor-provider reading (see `extension.ts`).
 */

export type WelcomeStage = "needs-install" | "needs-init";

export interface WelcomeViewDeps {
  /** Optional platform override for tests. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Optional recheck hook. Called when the user clicks "I already installed it". */
  onRecheck?: () => Promise<void> | void;
  /** Optional counter sink override for tests. */
  recordEvent?: (event: Parameters<typeof recordCounterEvent>[0]) => void;
}

let currentPanel: vscode.WebviewPanel | undefined;
let currentStage: WelcomeStage = "needs-install";
let deps: WelcomeViewDeps = {};

function resolvePlatform(): NodeJS.Platform {
  return deps.platform ?? process.platform;
}

function record(event: Parameters<typeof recordCounterEvent>[0]): void {
  if (deps.recordEvent) {
    deps.recordEvent(event);
    return;
  }
  recordCounterEvent(event);
}

/**
 * Open (or reveal) the welcome view at the given stage. The view is a
 * singleton — calling this twice reveals the existing panel rather
 * than spawning a second one.
 */
export function showWelcome(
  context: vscode.ExtensionContext,
  stage: WelcomeStage,
  options: WelcomeViewDeps = {},
): vscode.WebviewPanel {
  deps = options;
  currentStage = stage;

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Active);
    currentPanel.webview.html = renderHtml(stage, resolvePlatform());
    return currentPanel;
  }

  const panel = vscode.window.createWebviewPanel(
    "budi.welcome",
    "Welcome to budi",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  panel.webview.html = renderHtml(stage, resolvePlatform());

  record("welcome_view_impression");

  panel.webview.onDidReceiveMessage(
    async (msg: { type?: string }) => {
      if (!msg || typeof msg.type !== "string") return;
      switch (msg.type) {
        case "openInstallTerminal":
          record("open_terminal_click");
          openInstallCommandInTerminal(resolvePlatform());
          return;
        case "recheck":
          if (deps.onRecheck) await deps.onRecheck();
          return;
        case "runInit":
          record("handoff_completed");
          runInitInTerminal(resolvePlatform());
          return;
        default:
          return;
      }
    },
    undefined,
    context.subscriptions,
  );

  panel.onDidDispose(
    () => {
      if (panel === currentPanel) currentPanel = undefined;
    },
    null,
    context.subscriptions,
  );

  currentPanel = panel;
  return panel;
}

/** Advance the welcome view from "install budi" to "run `budi init`". */
export function transitionTo(stage: WelcomeStage): void {
  currentStage = stage;
  if (!currentPanel) return;
  currentPanel.webview.html = renderHtml(stage, resolvePlatform());
  currentPanel.reveal(vscode.ViewColumn.Active);
}

/**
 * Close the welcome view. Used when the extension receives its first
 * successful Cursor-provider reading — the welcome view has done its
 * job and should step out of the way.
 */
export function hideWelcome(): void {
  if (currentPanel) {
    currentPanel.dispose();
    currentPanel = undefined;
  }
}

export function isWelcomeVisible(): boolean {
  return currentPanel !== undefined;
}

export function currentWelcomeStage(): WelcomeStage {
  return currentStage;
}

function openInstallCommandInTerminal(platform: NodeJS.Platform): void {
  const cmd: InstallCommand = installCommandForPlatform(platform);
  const terminal = vscode.window.createTerminal({ name: "budi install" });
  terminal.show(true);
  // sendText(…, false) pre-fills the command but does NOT press enter,
  // so the user reads what they're about to run before executing.
  terminal.sendText(cmd.command, false);
}

function runInitInTerminal(platform: NodeJS.Platform): void {
  const cmd = initHandoffCommandFor(platform);
  const terminal = vscode.window.createTerminal({ name: "budi init" });
  terminal.show(true);
  terminal.sendText(cmd, false);
}

/**
 * Render the welcome-view HTML. Exported for unit tests so we can
 * assert the install command text is present verbatim — it is a
 * security-sensitive string and must not drift from
 * `installCommands.ts` silently.
 */
export function renderHtml(stage: WelcomeStage, platform: NodeJS.Platform): string {
  const install = installCommandForPlatform(platform);
  const initCommand = initHandoffCommandFor(platform);
  if (stage === "needs-install") {
    return renderInstallStage(install);
  }
  return renderInitStage(initCommand);
}

function esc(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInstallStage(cmd: InstallCommand): string {
  const installBlock = esc(cmd.command);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Welcome to budi</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px 28px; max-width: 640px; color: var(--vscode-foreground); }
  h1 { font-size: 20px; margin: 0 0 4px 0; display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; display: inline-block; }
  p { line-height: 1.5; }
  .muted { opacity: 0.75; font-size: 12px; margin-top: -4px; }
  pre { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12)); padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 12.5px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  button { font: inherit; padding: 8px 14px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: transparent; color: var(--vscode-foreground); border-color: var(--vscode-contrastBorder, rgba(127,127,127,0.3)); }
  .footnote { margin-top: 20px; font-size: 12px; opacity: 0.7; }
  a { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
<h1><span class="dot" aria-hidden="true"></span> Welcome to budi</h1>
<p class="muted">Shows your Cursor spend over the last 1d / 7d / 30d in the status bar, privately, on your machine.</p>

<p>To start tracking, budi needs a small background daemon on this computer. That's one command — your prompts and code never leave your machine.</p>

<p><strong>${esc(cmd.label)}:</strong></p>
<pre>${installBlock}</pre>

<div class="actions">
  <button class="primary" onclick="send('openInstallTerminal')">Open Terminal With This Command</button>
  <button class="secondary" onclick="send('recheck')">I already installed it</button>
</div>

<p class="footnote">The command is pre-filled in Cursor's integrated terminal — read it before pressing enter.</p>

<script>
  const vscode = acquireVsCodeApi();
  function send(type) { vscode.postMessage({ type }); }
</script>
</body>
</html>`;
}

function renderInitStage(initCommand: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Welcome to budi</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px 28px; max-width: 640px; color: var(--vscode-foreground); }
  h1 { font-size: 20px; margin: 0 0 4px 0; display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; display: inline-block; }
  p { line-height: 1.5; }
  .muted { opacity: 0.75; font-size: 12px; margin-top: -4px; }
  pre { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12)); padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 12.5px; }
  button { font: inherit; padding: 8px 14px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .footnote { margin-top: 20px; font-size: 12px; opacity: 0.7; }
</style>
</head>
<body>
<h1><span class="dot" aria-hidden="true"></span> budi is installed — one more step</h1>
<p class="muted">Finish setup and verify everything works.</p>

<p>Run <code>budi init</code> to start the daemon and discover your agents' local transcripts, then <code>budi doctor</code> to verify everything is healthy. This command does both in order:</p>
<pre>${esc(initCommand)}</pre>

<div class="actions">
  <button class="primary" onclick="send('runInit')">Finish setup in terminal</button>
</div>

<p class="footnote">Nothing is auto-executed. Review the prompts <code>budi init</code> shows before accepting. Once budi is running and routing Cursor traffic, this view closes automatically.</p>

<script>
  const vscode = acquireVsCodeApi();
  function send(type) { vscode.postMessage({ type }); }
</script>
</body>
</html>`;
}
