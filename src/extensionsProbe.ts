import * as vscode from "vscode";

import type { Host } from "./budiClient";

/**
 * Map of installed editor-extension ID → budi-core provider name.
 *
 * Mirrors the table in siropkin/budi-cursor#27 (parent siropkin/budi-cursor#25).
 * Keys are pre-lowercased because VS Code matches extension IDs
 * case-insensitively — render-side lookups must lowercase the candidate too.
 *
 * The provider names are the wire-level scope tags budi-core accepts on
 * `/analytics/statusline?provider=…`. `copilot_chat` lands in 8.4.0
 * (siropkin/budi#651); `continue` / `cline` / `roo_code` are deferred to
 * 9.0.0 (siropkin/budi#295). The probe still reports the deferred ones
 * so the multi-provider request builder (siropkin/budi-cursor#28) can
 * pass them through unchanged once the daemon recognizes them — per
 * #650 the daemon returns zero for unknown providers, so over-reporting
 * is safe.
 */
export const EXTENSION_PROVIDER_MAP: Readonly<Record<string, string>> = {
  "github.copilot": "copilot_chat",
  "github.copilot-chat": "copilot_chat",
  "continue.continue": "continue",
  "saoudrizwan.claude-dev": "cline",
  "rooveterinaryinc.roo-cline": "roo_code",
};

/**
 * Map a list of installed extension IDs to the budi-core providers they
 * imply. Deduplicates (two Copilot extensions → one provider) and
 * preserves first-seen order so the resulting list renders
 * deterministically in tooltips and HTTP query strings.
 *
 * On the `cursor` host we return `[]` — the Cursor provider is decided
 * by host detection (siropkin/budi-cursor#26), not by probing the
 * extension list. A stray `github.copilot-chat` install on Cursor must
 * not cause us to scope the request to anything other than `cursor`.
 */
export function probeProvidersFromExtensions(
  extensionIds: readonly string[],
  host: Host,
): string[] {
  if (host === "cursor") return [];
  const seen = new Set<string>();
  const providers: string[] = [];
  for (const id of extensionIds) {
    const provider = EXTENSION_PROVIDER_MAP[id.toLowerCase()];
    if (provider && !seen.has(provider)) {
      seen.add(provider);
      providers.push(provider);
    }
  }
  return providers;
}

let cachedProviders: readonly string[] = [];

/**
 * Latest probe result. Consumed by the multi-provider request builder
 * (siropkin/budi-cursor#28) so the request scopes to providers actually
 * installed on this machine. Empty until `startExtensionsProbe` runs.
 */
export function getDetectedProviders(): readonly string[] {
  return cachedProviders;
}

export interface ExtensionsProbeOptions {
  host: Host;
  log: vscode.OutputChannel;
  /** Called whenever the live extension list changes. */
  onChange?: (providers: readonly string[]) => void;
}

/**
 * Compute the initial provider list from `vscode.extensions.all`, log
 * one line per recognized extension, and subscribe to
 * `vscode.extensions.onDidChange` so the cache stays current when the
 * user installs or uninstalls an AI extension live.
 *
 * The disposable from `onDidChange` is pushed onto
 * `context.subscriptions`, so deactivation cleans it up automatically.
 */
export function startExtensionsProbe(
  context: vscode.ExtensionContext,
  options: ExtensionsProbeOptions,
): readonly string[] {
  const { host, log, onChange } = options;
  cachedProviders = probeFromHost(host);
  for (const ext of vscode.extensions.all) {
    const provider = EXTENSION_PROVIDER_MAP[ext.id.toLowerCase()];
    if (provider) {
      log.appendLine(`[budi] detected AI extension: ${ext.id} → ${provider}`);
    }
  }
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      cachedProviders = probeFromHost(host);
      onChange?.(cachedProviders);
    }),
  );
  return cachedProviders;
}

function probeFromHost(host: Host): readonly string[] {
  return probeProvidersFromExtensions(
    vscode.extensions.all.map((ext) => ext.id),
    host,
  );
}
