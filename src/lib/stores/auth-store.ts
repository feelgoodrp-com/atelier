import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import {
  clearPresence,
  configureApiClient,
  discordStartUrl,
  exchangeDeviceCode,
  fetchMe,
  logoutDevice,
  refreshSession,
  type DeviceMeta,
  type TokenResponse,
  type User,
} from "@/lib/sync/api-client";
import {
  cancelOauthServer,
  onOauthInvalidUrl,
  onOauthUrl,
  startOauthServer,
} from "@/lib/sync/oauth";
import {
  DEFAULT_API_URL,
  getApiUrl as loadApiUrl,
  getRefreshToken,
  setApiUrl as persistApiUrl,
  setRefreshToken,
} from "@/lib/settings";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Loopback success page (shown in the browser after Discord login) — same
 * Feelgood look as the API pages: animated blurry blobs + glass card + logo
 * (loaded from the API, hidden when unreachable).
 */
function oauthResponseHtml(apiUrl: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>atelier by feelgood</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}
body{background:#0b0b0b;color:#fff;font-family:"Sora","Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.blob{position:absolute;border-radius:50%;filter:blur(90px);opacity:.32;pointer-events:none}
.b1{width:480px;height:480px;background:#5865F2;top:-120px;left:-100px;animation:d1 22s ease-in-out infinite alternate}
.b2{width:420px;height:420px;background:#7289DA;bottom:-140px;right:-80px;animation:d2 26s ease-in-out infinite alternate}
.b3{width:320px;height:320px;background:#3b2f8f;top:45%;left:60%;animation:d3 19s ease-in-out infinite alternate}
@keyframes d1{to{transform:translate(120px,80px) scale(1.15)}}
@keyframes d2{to{transform:translate(-100px,-70px) scale(1.2)}}
@keyframes d3{to{transform:translate(-80px,60px) scale(.85)}}
.grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:50px 50px}
.card{position:relative;z-index:1;background:rgba(0,0,0,.55);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:44px 48px;max-width:440px;width:calc(100% - 48px);text-align:center;animation:rise .5s ease-out both;box-shadow:0 24px 80px rgba(0,0,0,.45)}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
.logo{width:72px;height:72px;margin-bottom:14px}
.wm{display:flex;align-items:baseline;justify-content:center;gap:7px;margin-bottom:26px}
.wm b{font-size:22px;font-weight:600;letter-spacing:-.02em}.wm span{font-size:12px;font-weight:500;color:#7289DA}
.icon{width:52px;height:52px;margin:0 auto 18px}
.icon svg{width:100%;height:100%;stroke:#4ade80}
.icon circle{stroke-width:2.5;fill:none;stroke-dasharray:160;stroke-dashoffset:160;animation:draw .6s ease-out .15s forwards}
.icon path{stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:60;stroke-dashoffset:60;animation:draw .45s ease-out .55s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
h2{font-size:19px;font-weight:600;margin-bottom:10px}
p{font-size:13.5px;line-height:1.6;color:rgba(255,255,255,.55)}
.foot{margin-top:28px;font-size:10.5px;color:rgba(255,255,255,.25)}
</style></head>
<body>
<div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="grid"></div>
<main class="card">
<img class="logo" src="${apiUrl}/logo.png" alt="" onerror="this.style.display='none'">
<div class="wm"><b>atelier</b><span>by feelgood</span></div>
<div class="icon"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg></div>
<h2>Anmeldung abgeschlossen</h2>
<p>Willkommen zurück! Du kannst dieses Fenster schließen und zur App zurückkehren.</p>
<div class="foot">atelier by feelgood</div>
</main>
<script>setTimeout(function(){ try { window.close(); } catch (e) {} }, 2000);</script>
</body></html>`;
}

export type AuthStatus = "loggedOut" | "loggingIn" | "loggedIn";

interface AuthState {
  status: AuthStatus;
  /** True until the initial silent-login attempt finished (gate shows a splash). */
  bootstrapping: boolean;
  user: User | null;
  /** Kept in memory only — never persisted. */
  accessToken: string | null;
  apiUrl: string;
  /** Loads persisted settings + tries a silent refresh. Call once on startup. */
  bootstrap: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  setApiUrl: (url: string) => Promise<void>;
  /** Re-fetches /me (e.g. to poll the pending → approved transition). */
  reloadUser: () => Promise<void>;
}

async function getDeviceMeta(): Promise<DeviceMeta> {
  try {
    return await invoke<DeviceMeta>("get_device_info");
  } catch {
    return { name: "Unbekanntes Gerät", platform: "windows", appVersion: "0.0.0" };
  }
}

export const useAuthStore = create<AuthState>((set, get) => {
  configureApiClient({
    getApiUrl: () => get().apiUrl,
    getAccessToken: () => get().accessToken,
    getRefreshToken,
    onTokensRotated: async (tokens: TokenResponse) => {
      await setRefreshToken(tokens.refreshToken);
      set({ accessToken: tokens.accessToken, user: tokens.user ?? get().user });
    },
    onSessionExpired: async () => {
      await setRefreshToken(null);
      set({ status: "loggedOut", user: null, accessToken: null });
    },
  });

  return {
    status: "loggedOut",
    bootstrapping: true,
    user: null,
    accessToken: null,
    apiUrl: DEFAULT_API_URL,

    bootstrap: async () => {
      try {
        const apiUrl = await loadApiUrl();
        set({ apiUrl });
      } catch {
        // store plugin unavailable (plain browser dev) — keep default
      }
      try {
        const tokens = await refreshSession();
        if (tokens) {
          set({ status: "loggedIn", user: tokens.user, accessToken: tokens.accessToken });
          // Pick up role/status changes that happened while we were offline.
          const me = await fetchMe().catch(() => null);
          if (me) set({ user: me.user });
        }
      } catch {
        // Backend unreachable — stay logged out, user can retry manually.
      } finally {
        set({ bootstrapping: false });
      }
    },

    login: async () => {
      if (get().status === "loggingIn") return;
      set({ status: "loggingIn" });

      let port: number | null = null;
      const cleanups: Array<() => void> = [];
      try {
        port = await startOauthServer({ response: oauthResponseHtml(get().apiUrl) });
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        const code = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Zeitüberschreitung bei der Anmeldung")),
            LOGIN_TIMEOUT_MS,
          );
          cleanups.push(() => clearTimeout(timeout));

          onOauthUrl((url) => {
            try {
              const parsed = new URL(url);
              const code = parsed.searchParams.get("code");
              if (code) {
                resolve(code);
              } else {
                reject(new Error(parsed.searchParams.get("error") ?? "Kein Code erhalten"));
              }
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          }).then((unlisten) => cleanups.push(unlisten));

          onOauthInvalidUrl((err) => reject(new Error(err))).then((unlisten) =>
            cleanups.push(unlisten),
          );

          openInBrowser(discordStartUrl(get().apiUrl, redirectUri)).catch(reject);
        });

        const device = await getDeviceMeta();
        const tokens = await exchangeDeviceCode({ code, redirectUri, device });
        await setRefreshToken(tokens.refreshToken);
        set({ status: "loggedIn", user: tokens.user, accessToken: tokens.accessToken });
      } catch (e) {
        set({ status: "loggedOut" });
        throw e;
      } finally {
        cleanups.forEach((fn) => fn());
        if (port !== null) {
          cancelOauthServer(port).catch(() => {});
        }
      }
    },

    logout: async () => {
      // Best effort: go offline + revoke the device while the token still works.
      await clearPresence().catch(() => {});
      await logoutDevice().catch(() => {});
      await setRefreshToken(null);
      set({ status: "loggedOut", user: null, accessToken: null });
    },

    setApiUrl: async (url: string) => {
      const normalized = url.trim().replace(/\/+$/, "") || DEFAULT_API_URL;
      await persistApiUrl(normalized);
      set({ apiUrl: normalized });
    },

    reloadUser: async () => {
      if (get().status !== "loggedIn") return;
      const me = await fetchMe().catch(() => null);
      if (me) set({ user: me.user });
    },
  };
});
