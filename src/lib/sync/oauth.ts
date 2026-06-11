/**
 * Thin JS wrapper around the `tauri-plugin-oauth` Rust plugin
 * (the crate ships no npm package — we invoke its commands directly).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface OauthConfig {
  /** Hard-coded ports to try; omit to let the OS pick a free one. */
  ports?: number[];
  /** Static HTML shown in the browser tab after the redirect. */
  response?: string;
}

/** Starts the loopback server and returns the port it listens on. */
export async function startOauthServer(config?: OauthConfig): Promise<number> {
  return await invoke<number>("plugin:oauth|start", { config });
}

/** Stops the loopback server listening on `port`. */
export async function cancelOauthServer(port: number): Promise<void> {
  await invoke("plugin:oauth|cancel", { port });
}

/** Fires with the full redirect URL (e.g. `http://127.0.0.1:PORT/callback?code=...`). */
export function onOauthUrl(handler: (url: string) => void): Promise<UnlistenFn> {
  return listen<string>("oauth://url", (event) => handler(event.payload));
}

/** Fires when the loopback server received something that is not a valid URL. */
export function onOauthInvalidUrl(handler: (error: string) => void): Promise<UnlistenFn> {
  return listen<string>("oauth://invalid-url", (event) => handler(event.payload));
}
