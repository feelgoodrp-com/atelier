import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import i18n from "@/lib/i18n";
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
  getAppMode,
  getRefreshToken,
  setApiUrl as persistApiUrl,
  setAppMode as persistAppMode,
  setRefreshToken,
  type AppMode,
} from "@/lib/settings";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Loopback success page (shown in the browser after Discord login) — same look
 * as the app login + the API pages: hero video backdrop under a gradient veil,
 * big atelier branding left, glass card right. Video + logo are loaded from the
 * API (hidden when unreachable). apiUrl is trusted (our own configured origin).
 */
function oauthResponseHtml(apiUrl: string): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8"><title>atelier by feelgood</title>
<link rel="icon" href="${apiUrl}/logo.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}
body{background:#0b0b0b;color:#fff;font-family:"Sora","Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.veil{position:absolute;inset:0;z-index:0;pointer-events:none;background:linear-gradient(to bottom,rgba(11,11,11,.78),rgba(11,11,11,.62) 45%,rgba(11,11,11,.92))}
.grid{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.5;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:50px 50px}
.stage{position:relative;z-index:1;width:100%;max-width:1080px;padding:0 56px;display:flex;align-items:center;justify-content:space-between;gap:56px}
.brand{display:flex;flex-direction:column;align-items:flex-start;gap:16px;animation:rise .5s ease-out both}
.brand .logo{width:104px;height:104px;user-select:none}
.wm{display:flex;align-items:baseline;gap:12px}
.wm b{font-size:46px;font-weight:600;letter-spacing:-.02em;line-height:1}.wm span{font-size:16px;font-weight:500;color:#7289DA}
.tag{font-size:15px;line-height:1.5;color:rgba(255,255,255,.55);max-width:360px}
.card{position:relative;background:rgba(0,0,0,.55);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:40px 44px;width:380px;flex-shrink:0;text-align:center;animation:rise .5s ease-out .08s both;box-shadow:0 24px 80px rgba(0,0,0,.45)}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
.icon{width:52px;height:52px;margin:0 auto 18px}
.icon svg{width:100%;height:100%;stroke:#4ade80}
.icon circle{stroke-width:2.5;fill:none;stroke-dasharray:160;stroke-dashoffset:160;animation:draw .6s ease-out .15s forwards}
.icon path{stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:60;stroke-dashoffset:60;animation:draw .45s ease-out .55s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
h2{font-size:19px;font-weight:600;margin-bottom:10px}
p{font-size:13.5px;line-height:1.6;color:rgba(255,255,255,.55)}
.foot{margin-top:26px;font-size:10.5px;color:rgba(255,255,255,.25)}
@media (max-width:780px){.stage{flex-direction:column;gap:32px;padding:0 24px;text-align:center}.brand{align-items:center}.tag{display:none}.card{width:100%;max-width:400px}}
@media (prefers-reduced-motion:reduce){.brand,.card{animation:none}}
</style></head>
<body>
<video class="bg" autoplay loop muted playsinline aria-hidden="true" onerror="this.style.display='none'"><source src="${apiUrl}/hero.webm" type="video/webm"></video>
<div class="veil"></div><div class="grid"></div>
<div class="stage">
<div class="brand">
<img class="logo" src="${apiUrl}/logo.png" alt="" onerror="this.style.display='none'">
<div class="wm"><b>atelier</b><span>by feelgood</span></div>
<p class="tag">${i18n.t("sync:oauthPage.tagline")}</p>
</div>
<main class="card">
<div class="icon"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg></div>
<h2>${i18n.t("sync:oauthPage.title")}</h2>
<p>${i18n.t("sync:oauthPage.body")}</p>
<div class="foot">atelier by feelgood</div>
</main>
</div>
<script>setTimeout(function(){ try { window.close(); } catch (e) {} }, 2000);</script>
</body></html>`;
}

export type AuthStatus = "loggedOut" | "loggingIn" | "loggedIn";

/**
 * Sub-phase of an interactive login — drives the login card's progress bar
 * and the success checkmark. "idle" whenever no interactive login is running.
 */
export type LoginPhase =
  | "idle"
  | "connecting"
  | "awaiting"
  | "exchanging"
  | "success";

interface AuthState {
  status: AuthStatus;
  /** Progress sub-phase of {@link login} (loading bar + auth checkmark). */
  loginPhase: LoginPhase;
  /** True until the initial silent-login attempt finished (gate shows a splash). */
  bootstrapping: boolean;
  user: User | null;
  /** Kept in memory only — never persisted. */
  accessToken: string | null;
  apiUrl: string;
  /**
   * "cloud" = Discord login + team backend; "solo" = fully local, no backend.
   * Loaded during {@link bootstrap}; gate + every cloud feature key off this.
   */
  appMode: AppMode;
  /** Loads persisted settings + tries a silent refresh. Call once on startup. */
  bootstrap: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  setApiUrl: (url: string) => Promise<void>;
  /** Persists + applies the app mode (solo ⇄ cloud). Switching is instant. */
  setAppMode: (mode: AppMode) => Promise<void>;
  /** Re-fetches /me (e.g. to poll the pending → approved transition). */
  reloadUser: () => Promise<void>;
}

async function getDeviceMeta(): Promise<DeviceMeta> {
  try {
    return await invoke<DeviceMeta>("get_device_info");
  } catch {
    return {
      name: i18n.t("sync:auth.unknownDevice"),
      platform: "windows",
      appVersion: "0.0.0",
    };
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
    loginPhase: "idle",
    bootstrapping: true,
    user: null,
    accessToken: null,
    apiUrl: DEFAULT_API_URL,
    appMode: "cloud",

    bootstrap: async () => {
      // The mode must be known BEFORE the gate renders, otherwise a solo user
      // briefly sees the login screen. Default "cloud" keeps existing installs.
      let appMode: AppMode = "cloud";
      try {
        appMode = await getAppMode();
      } catch {
        // store plugin unavailable (plain browser dev) — keep default "cloud"
      }
      set({ appMode });

      // Solo mode is fully local: never load the API URL, never call the backend.
      if (appMode === "solo") {
        set({ bootstrapping: false });
        return;
      }

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

    setAppMode: async (mode: AppMode) => {
      await persistAppMode(mode).catch(() => {});
      set({ appMode: mode });
    },

    login: async () => {
      if (get().status === "loggingIn") return;
      set({ status: "loggingIn", loginPhase: "connecting" });

      let port: number | null = null;
      const cleanups: Array<() => void> = [];
      try {
        port = await startOauthServer({ response: oauthResponseHtml(get().apiUrl) });
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        // Browser is about to open — we now wait for the user to authorize.
        set({ loginPhase: "awaiting" });

        const code = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(i18n.t("sync:auth.loginTimeout"))),
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
                reject(
                  new Error(
                    parsed.searchParams.get("error") ??
                      i18n.t("sync:auth.noCodeReceived"),
                  ),
                );
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

        // Code received — exchange it for tokens.
        set({ loginPhase: "exchanging" });
        const device = await getDeviceMeta();
        const tokens = await exchangeDeviceCode({ code, redirectUri, device });
        await setRefreshToken(tokens.refreshToken);
        // Hold on "success" briefly so the checkmark animates before the gate
        // swaps the card (status flip unmounts the login card).
        set({
          loginPhase: "success",
          user: tokens.user,
          accessToken: tokens.accessToken,
        });
        await new Promise((resolve) => setTimeout(resolve, 850));
        set({ status: "loggedIn", loginPhase: "idle" });
      } catch (e) {
        set({ status: "loggedOut", loginPhase: "idle" });
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

/**
 * Single source of truth for "are cloud features available?". Cloud (login,
 * sync, presence, collab, admin) is enabled only in cloud mode; in solo mode
 * every cloud surface hides and no backend call is made. Components use this
 * hook; imperative call sites read `useAuthStore.getState().appMode`.
 */
export const useCloudEnabled = (): boolean =>
  useAuthStore((s) => s.appMode === "cloud");
