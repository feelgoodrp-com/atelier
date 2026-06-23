
/**
 * Docs OVERVIEW — the bilingual client body for app/docs/page.tsx.
 *
 * THE DOCS PATTERN (copy this for atelier / atelier-api in phase 2):
 *   - app/docs/<slug>/page.tsx stays a SERVER component: it `export const
 *     metadata` (SEO, default = English) and renders exactly ONE client doc
 *     component like this one.
 *   - This client component is "use client", reads `useLocale()`, and returns
 *     the EN or DE article via a conditional. Both languages live here.
 *   - The doc primitives in components/docs/doc.tsx are presentational and work
 *     fine inside this client component. For their built-in chrome labels
 *     (DocCard "Read", DocPager "Back/Next") pass the localized strings from
 *     DOCS_UI via the new optional props.
 */

import {
  DocH1,
  DocLead,
  DocSection,
  DocP,
  DocUl,
  DocLi,
  DocCard,
  DocCardGrid,
  DocCallout,
  DocLink,
  Code,
} from "./doc";
import { DOCS_UI, t } from "./docs-nav";
import { useLocale } from "./locale";
import { LINKS } from "./links";

export function OverviewDoc() {
  const { locale } = useLocale();
  const cardCta = t(DOCS_UI.cardCta, locale);

  if (locale === "de") {
    return (
      <article>
        <DocH1>Dokumentation</DocH1>
        <DocLead>
          atelier besteht aus zwei Teilen: der <strong className="text-white/80">Desktop-App</strong>,
          mit der du Clothing-Packs baust, und dem <strong className="text-white/80">Backend</strong>,
          das Login und Team-Sync übernimmt. Hier findest du beide.
        </DocLead>

        <DocCardGrid>
          <DocCard
            href="/docs/atelier"
            eyebrow="Desktop-App"
            title="atelier"
            desc="Installieren, einrichten und losbauen: Onboarding, Werkbank, 3D-Vorschau, Build für FiveM & Co., Team-Cloud."
            cta={cardCta}
          />
          <DocCard
            href="/docs/atelier-api"
            eyebrow="Backend"
            title="atelier-api"
            desc="Selbst hosten: Environment-Variablen, Discord-Login, Storage-Volume, Deployment mit Dokploy und die Endpoints."
            cta={cardCta}
          />
        </DocCardGrid>

        <DocSection id="architektur" title="Wie alles zusammenspielt">
          <DocP>
            Du brauchst nicht alles zu verstehen, um loszulegen — aber es hilft zu wissen, welcher
            Teil was macht:
          </DocP>
          <DocUl>
            <DocLi>
              <strong className="text-white/80">atelier (Desktop-App)</strong> — die App, die du
              startest. Hier verwaltest du Drawables, siehst die 3D-Vorschau und baust das fertige
              Pack. Läuft unter Windows.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Sidecar (.NET)</strong> — ein kleiner Helfer, der
              zusammen mit der App startet. Er liest <Code>.ydd</Code>/<Code>.ytd</Code>-Dateien,
              rendert die Vorschau und schreibt die echten binären YMTs. Darum musst du dich nicht
              kümmern — er ist im Download enthalten.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">atelier-api (Backend)</strong> — der Server für
              Login, Team-Cloud und das gemeinsame Bauen. Nur nötig, wenn ihr im Team arbeitet oder
              Packs in der Cloud teilen wollt. Eine Instanz fürs ganze Team genügt.
            </DocLi>
          </DocUl>
          <DocCallout kind="tip" title="Nur ausprobieren?">
            Für den ersten Blick reicht die Desktop-App allein. Backend-Login und Cloud kannst du
            jederzeit später dazuschalten.
          </DocCallout>
        </DocSection>

        <DocSection id="schnellstart" title="Schnellstart">
          <DocUl>
            <DocLi>
              <DocLink href={LINKS.DOWNLOAD}>Neueste Version herunterladen</DocLink> (Installer oder
              Portable-ZIP) und starten.
            </DocLi>
            <DocLi>
              Dem Onboarding folgen — siehe{" "}
              <DocLink href="/docs/atelier">atelier · Erste Schritte</DocLink>.
            </DocLi>
            <DocLi>
              Quellcode &amp; Issues:{" "}
              <DocLink href={LINKS.REPO}>atelier auf GitHub</DocLink> ·{" "}
              <DocLink href={LINKS.API_REPO}>atelier-api auf GitHub</DocLink>.
            </DocLi>
          </DocUl>
        </DocSection>
      </article>
    );
  }

  // English (default)
  return (
    <article>
      <DocH1>Documentation</DocH1>
      <DocLead>
        atelier comes in two parts: the <strong className="text-white/80">desktop app</strong>, which
        you use to build clothing packs, and the <strong className="text-white/80">backend</strong>,
        which handles login and team sync. You&apos;ll find both here.
      </DocLead>

      <DocCardGrid>
        <DocCard
          href="/docs/atelier"
          eyebrow="Desktop app"
          title="atelier"
          desc="Install, set up and start building: onboarding, workbench, 3D preview, build for FiveM & co., team cloud."
          cta={cardCta}
        />
        <DocCard
          href="/docs/atelier-api"
          eyebrow="Backend"
          title="atelier-api"
          desc="Self-host it: environment variables, Discord login, storage volume, deployment with Dokploy and the endpoints."
          cta={cardCta}
        />
      </DocCardGrid>

      <DocSection id="architektur" title="How it all fits together">
        <DocP>
          You don&apos;t need to understand everything to get going — but it helps to know which part
          does what:
        </DocP>
        <DocUl>
          <DocLi>
            <strong className="text-white/80">atelier (desktop app)</strong> — the app you launch.
            Here you manage drawables, see the 3D preview and build the finished pack. Runs on
            Windows.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Sidecar (.NET)</strong> — a small helper that starts
            alongside the app. It reads <Code>.ydd</Code>/<Code>.ytd</Code> files, renders the
            preview and writes the real binary YMTs. You don&apos;t have to worry about it — it ships
            with the download.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">atelier-api (backend)</strong> — the server for login,
            team cloud and building together. Only needed if you work as a team or want to share
            packs in the cloud. One instance for the whole team is enough.
          </DocLi>
        </DocUl>
        <DocCallout kind="tip" title="Just trying it out?">
          For a first look, the desktop app alone is enough. You can wire up backend login and the
          cloud whenever you like later.
        </DocCallout>
      </DocSection>

      <DocSection id="schnellstart" title="Quick start">
        <DocUl>
          <DocLi>
            <DocLink href={LINKS.DOWNLOAD}>Download the latest version</DocLink> (installer or
            portable ZIP) and launch it.
          </DocLi>
          <DocLi>
            Follow the onboarding — see{" "}
            <DocLink href="/docs/atelier">atelier · Getting started</DocLink>.
          </DocLi>
          <DocLi>
            Source &amp; issues:{" "}
            <DocLink href={LINKS.REPO}>atelier on GitHub</DocLink> ·{" "}
            <DocLink href={LINKS.API_REPO}>atelier-api on GitHub</DocLink>.
          </DocLi>
        </DocUl>
      </DocSection>
    </article>
  );
}
