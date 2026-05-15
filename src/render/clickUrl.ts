import { CURSOR_PROVIDER, type StatuslineData } from "../http/statuslineClient";

interface ClickUrlOptions {
  cloudEndpoint: string;
  statusline: StatuslineData | null;
}

/**
 * Click-through URL for the statusline item. Mirrors
 * `crates/budi-cli/src/commands/statusline.rs::cmd_statusline`:
 * when there is an active session (here: active Cursor traffic in the
 * rolling 1d window), open the cloud session list; otherwise open the
 * dashboard root. The cloud endpoint defaults to `https://app.getbudi.dev`.
 *
 * First-run (`firstRun` health state, #314) is handled upstream — the
 * status bar command switches to the in-editor welcome view instead of
 * calling this helper.
 */
export function clickUrl({ cloudEndpoint, statusline }: ClickUrlOptions): string {
  const base = cloudEndpoint.replace(/\/+$/, "");
  if (statusline && statusline.active_provider === CURSOR_PROVIDER) {
    return `${base}/dashboard/sessions`;
  }
  return `${base}/dashboard`;
}
