/**
 * Locale shim for the ported documentation. The docs were written for the
 * landing site, which has its own `useLocale()`; here we map onto the app's
 * react-i18next language so the Help tab follows the global language switch.
 */

import { useTranslation } from "react-i18next";

export type DocLocale = "en" | "de";

export function useLocale(): { locale: DocLocale } {
  const { i18n } = useTranslation();
  return { locale: i18n.language === "de" ? "de" : "en" };
}
