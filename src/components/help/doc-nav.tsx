/**
 * In-app navigation for the documentation primitives. The docs were written for
 * a multi-page website (next/link, URL anchors); inside the desktop Help tab
 * there is no router, so links resolve to one of three things:
 *   - external `http(s)` URLs  → open in the system browser
 *   - in-page `#section` links → smooth-scroll within the Help scroll area
 *   - `/docs/<slug>` page links → switch the active doc page
 *
 * The Help screen provides the implementation; the primitives consume it.
 */

import { createContext, useContext } from "react";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";

export interface DocNav {
  /** Switch the active doc page (accepts a `/docs/...` href or a bare slug). */
  navigate: (hrefOrSlug: string) => void;
  /** Smooth-scroll to a section id within the Help scroll container. */
  scrollToId: (id: string) => void;
}

const noop: DocNav = { navigate: () => {}, scrollToId: () => {} };

export const DocNavContext = createContext<DocNav>(noop);

export function useDocNav(): DocNav {
  return useContext(DocNavContext);
}

/** Open an external link in the system browser (no-op without the Tauri bridge). */
export function openExternal(url: string): void {
  void openInBrowser(url).catch(() => {});
}
