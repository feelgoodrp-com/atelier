
/**
 * atelier (desktop app) docs — the bilingual client body for
 * app/docs/atelier/page.tsx.
 *
 * THE DOCS PATTERN (see app/docs/overview-doc.tsx for the verbatim reference):
 *   - app/docs/atelier/page.tsx stays a SERVER component that `export const
 *     metadata` (SEO, default = English) and renders exactly ONE client doc
 *     component — this one.
 *   - This component is "use client", reads `useLocale()`, and returns the EN
 *     (default) or DE article via `if (locale === "de") return <DE/>;`.
 *   - The doc primitives in components/docs/doc.tsx are presentational and work
 *     fine inside this client component. Built-in chrome (DocCard "Read",
 *     DocPager "Back/Next") gets the localized strings from DOCS_UI via props.
 *   - Section `id`s here MUST stay in sync with lib/docs-nav.ts (sidebar +
 *     on-this-page anchors): einstieg, installation, erste-schritte, login,
 *     werkbank, vorschau, bauen, cloud, einstellungen.
 */

import {
  DocH1,
  DocLead,
  DocSection,
  DocH3,
  DocP,
  DocUl,
  DocLi,
  DocSteps,
  DocStep,
  DocCallout,
  DocTable,
  DocLink,
  DocPager,
  Code,
} from "./doc";
import { DOCS_UI, t } from "./docs-nav";
import { useLocale } from "./locale";
import { LINKS } from "./links";

export function AtelierDoc() {
  const { locale } = useLocale();
  const pagerAria = t(DOCS_UI.pagerAria, locale);
  const pagerPrev = t(DOCS_UI.pagerPrev, locale);
  const pagerNext = t(DOCS_UI.pagerNext, locale);

  if (locale === "de") {
    return (
      <article>
        <DocH1>atelier — die Desktop-App</DocH1>
        <DocLead>
          atelier ist das kostenlose Desktop-Tool der feelgood-Community, mit dem du GTA-V-Addon-
          Kleidung und Tattoos baust, prüfst und veröffentlichst. Diese Seite führt dich von der
          Installation bis zum fertigen Pack.
        </DocLead>

        <DocSection id="einstieg" title="Was ist atelier?">
          <DocP>
            atelier verwaltet deine Drawables, zeigt sie in Echtzeit-3D und baut daraus fertige, in-
            game-taugliche Addons — im Geiste von grzyClothTool, eigenständig neu gebaut. Du
            arbeitest in einer Werkbank, prüfst alles in der Vorschau und exportierst mit einem Klick.
          </DocP>
          <DocUl>
            <DocLi>
              <strong className="text-white/80">Solo-Modus:</strong> komplett lokal, ohne Konto oder
              Server — voll offline nutzbar.
            </DocLi>
            <DocLi>Ziele: FiveM, Singleplayer, RageMP und alt:V.</DocLi>
            <DocLi>Echte binäre YMTs, automatischer 128er-Split, Textur-Optimierung.</DocLi>
            <DocLi>Optional: Team-Cloud zum gemeinsamen Bauen am selben Pack.</DocLi>
          </DocUl>
          <DocCallout kind="info" title="Plattform">
            atelier läuft unter Windows 10/11 (64-Bit). Der .NET-Sidecar für Parsing &amp; Vorschau
            ist im Download enthalten — du musst nichts extra installieren.
          </DocCallout>
        </DocSection>

        <DocSection id="installation" title="Installation">
          <DocP>
            Lade die neueste Version aus den{" "}
            <DocLink href={LINKS.DOWNLOAD}>GitHub-Releases</DocLink> und wähle eine der Varianten:
          </DocP>
          <DocUl>
            <DocLi>
              <strong className="text-white/80">Installer (.exe)</strong> — der Standardweg.
              Doppelklick, installieren, fertig.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">MSI</strong> — die Alternative, z. B. für verwaltete
              Umgebungen.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Portable-ZIP</strong> — keine Installation: entpacken
              und <Code>atelier.exe</Code> starten. App und Sidecar sind enthalten.
            </DocLi>
          </DocUl>
          <DocCallout kind="tip" title="Update">
            Eine neue Version installierst du einfach über die alte — deine Projekte und
            Einstellungen bleiben erhalten.
          </DocCallout>
        </DocSection>

        <DocSection id="erste-schritte" title="Erste Schritte">
          <DocP>
            Beim ersten Start führt dich ein kurzer Onboarding-Assistent durch die Einrichtung. Du
            kannst ihn später jederzeit in den Einstellungen erneut starten.
          </DocP>
          <DocSteps>
            <DocStep n={1}>
              <strong className="text-white/80">Modus.</strong> Wähle, wie du atelier nutzt:{" "}
              <strong className="text-white/80">Solo</strong> — komplett lokal, ohne Konto und ohne
              Server (alles läuft offline) — oder <strong className="text-white/80">Team</strong>, um
              dich anzumelden und Packs über die Cloud zu teilen. Den Modus kannst du später jederzeit
              in den Einstellungen wechseln.
            </DocStep>
            <DocStep n={2}>
              <strong className="text-white/80">Server-Adresse (nur Team).</strong> Im Team-Modus
              trägst du die Adresse deiner atelier-api ein. atelier prüft sie live und zeigt grün, wenn
              dort eine atelier-api läuft. Standard für lokale Tests ist{" "}
              <Code>http://127.0.0.1:3095</Code>. Im Solo-Modus wird dieser Schritt übersprungen.
            </DocStep>
            <DocStep n={3}>
              <strong className="text-white/80">GTA-V-Verzeichnis.</strong> Wähle den Ordner deiner
              GTA-V-Installation. Damit kann die 3D-Vorschau den echten Ped-Body anzeigen. Optional —
              ohne GTA-Pfad funktioniert alles andere trotzdem.
            </DocStep>
            <DocStep n={4}>
              <strong className="text-white/80">Logs.</strong> Optional kannst du eine
              Live-Log-Konsole aktivieren, die App- und Sidecar-Ereignisse anzeigt. Praktisch bei
              Problemen, sonst kannst du es ausgelassen lassen.
            </DocStep>
          </DocSteps>
          <DocCallout kind="info">
            Im Solo-Modus brauchst du weder Server noch Konto — du kannst sofort lokal Packs bauen. Die
            Server-Adresse ist nur für Login und Team-Cloud nötig.
          </DocCallout>
        </DocSection>

        <DocSection id="login" title="Login & Freigabe">
          <DocCallout kind="info" title="Nur im Team-Modus">
            Im Solo-Modus brauchst du kein Konto — du kannst diesen Abschnitt überspringen. Auf dem
            Login-Screen gibt es dafür auch „Ohne Konto nutzen (Solo)".
          </DocCallout>
          <DocP>
            Login läuft über Discord. atelier öffnet kurz deinen Browser, du bestätigst bei Discord,
            und die App ist angemeldet — Passwörter gibt es keine.
          </DocP>
          <DocSteps>
            <DocStep n={1}>In atelier auf „Anmelden" klicken.</DocStep>
            <DocStep n={2}>
              Im Browser bei Discord bestätigen. Danach kehrt der Login automatisch zur App zurück.
            </DocStep>
            <DocStep n={3}>
              Fertig — die App merkt sich die Anmeldung und verlängert sie im Hintergrund.
            </DocStep>
          </DocSteps>
          <DocCallout kind="warn" title="Warten auf Freigabe">
            Neue Accounts starten als <Code>pending</Code>: du bist angemeldet, aber für
            Cloud-Aktionen muss dich ein Admin einmalig freischalten. Bis dahin siehst du einen
            „Warte auf Freigabe"-Hinweis. Admins schalten neue Mitglieder in den Einstellungen unter
            <span className="whitespace-nowrap"> „Admin"</span> frei.
          </DocCallout>
        </DocSection>

        <DocSection id="werkbank" title="Die Werkbank">
          <DocP>
            Die Werkbank ist dein Arbeitsplatz — drei Spalten plus eine andockbare Vorschau:
          </DocP>
          <DocH3>Kategoriebaum (links)</DocH3>
          <DocP>
            Alle Component- und Prop-Slots mit Live-Zählern. Warn-Badges weisen dich früh auf
            Probleme hin — etwa fehlende LODs, zu viele oder zu große Texturen.
          </DocP>
          <DocH3>Drawable-Liste (Mitte)</DocH3>
          <DocUl>
            <DocLi>Suchen und filtern in Echtzeit, Mehrfachauswahl per Strg/Shift-Klick.</DocLi>
            <DocLi>
              Per Drag &amp; Drop umsortieren — die Reihenfolge bestimmt die Build-Reihenfolge.
            </DocLi>
            <DocLi>
              Kontextmenü zum Duplizieren, Löschen und Gruppieren; gleiche YDD-Hashes werden als
              Duplikate erkannt.
            </DocLi>
          </DocUl>
          <DocH3>Inspector (rechts)</DocH3>
          <DocP>
            Details zum ausgewählten Drawable: Label, Geschlecht, Slot, Addon- oder Replace-Modus,
            Gruppen und Flags wie High-Heels und Hair-Scale. Darunter das Texturen-Panel mit den
            a–z-Varianten samt Thumbnails.
          </DocP>
        </DocSection>

        <DocSection id="vorschau" title="3D-Vorschau">
          <DocP>
            Die andockbare Vorschau zeigt deine Drawables in Echtzeit — im dunklen feelgood-Look mit
            frei drehbarer Kamera.
          </DocP>
          <DocUl>
            <DocLi>
              <strong className="text-white/80">Mehrere Drawables gleichzeitig</strong> als
              komplettes Outfit, inklusive Textur-Varianten zum Durchschalten.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Kamera-Presets</strong> für Gesamt, Kopf, Torso,
              Beine und Füße.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Hair-Shrink &amp; Heel-Height</strong> live
              verstellbar — so siehst du sofort, wie stark Haare schrumpfen oder wie hoch Absätze den
              Ped anheben.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Ped-Body</strong> einblenden (mp_m/mp_f), sobald ein
              GTA-V-Pfad gesetzt ist. Overlays zeigen Poly-/Vertex-Zahlen und LOD-Warnungen.
            </DocLi>
          </DocUl>
          <DocCallout kind="info">
            Ohne gesetzten GTA-Pfad bleibt der Ped-Body deaktiviert — die Drawables selbst kannst du
            trotzdem vorschauen.
          </DocCallout>
        </DocSection>

        <DocSection id="tattoos" title="Tattoos">
          <DocP>
            Neben Kleidung baust du in atelier auch <strong className="text-white/80">Tattoos</strong>{" "}
            — in einem eigenen Tattoo-Bereich (Icon oben in der Navigation). Tattoos sind
            Fixed-UV-Decals: du importierst ein Bild und legst Zone, Geschlecht und Typ fest, die
            genaue Platzierung steckt in der Textur.
          </DocP>
          <DocUl>
            <DocLi>
              <strong className="text-white/80">Importieren</strong> — PNG, DDS oder YTD per Button;
              läuft komplett offline (kein GTA-Pfad nötig).
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Organisieren</strong> — nach den sechs Körperzonen
              (Torso, Kopf, linker/rechter Arm, linkes/rechtes Bein), mit Suche, Grid und Inspector.
              Rechtsklick zum Duplizieren, Zone/Geschlecht ändern, Gruppieren und Löschen.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Geschlecht</strong> — ein Decal kann beide
              Freemode-Peds bedienen (M/W); pro Geschlecht entsteht ein Overlay-Name.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Bauen</strong> — ergibt ein streambares FiveM-Pack:
              ein YTD je Decal, eine geteilte Overlay-Collection, optional eine{" "}
              <Code>shop_tattoo.meta</Code> und ein <Code>tattoos.json</Code>-Manifest, das dein
              Server zur Laufzeit liest.
            </DocLi>
          </DocUl>
          <DocCallout kind="info" title="Anwendung im Spiel">
            Das Pack liefert die Assets samt <Code>tattoos.json</Code>; angewendet werden Tattoos
            serverseitig zur Laufzeit (<Code>AddPedDecorationFromHashes</Code>) — das ist nicht Teil
            von atelier.
          </DocCallout>
        </DocSection>

        <DocSection id="bauen" title="Bauen & Export">
          <DocP>
            Über „Bauen" exportierst du dein Projekt als fertige Ressource. Der Dialog führt in drei
            Schritten durch Setup, Validierung und Build.
          </DocP>
          <DocSteps>
            <DocStep n={1}>
              <strong className="text-white/80">Setup.</strong> Ziel wählen, DLC-Namen festlegen (nur
              Kleinbuchstaben, Ziffern, Unterstrich) und Ausgabeordner bestimmen.
            </DocStep>
            <DocStep n={2}>
              <strong className="text-white/80">Validierung.</strong> atelier prüft das Projekt und
              listet Fehler, Warnungen und Hinweise — jeweils mit Sprung zum betroffenen Drawable.
              Fehler blockieren den Build, Warnungen nicht.
            </DocStep>
            <DocStep n={3}>
              <strong className="text-white/80">Build.</strong> Der Fortschritt läuft live durch die
              Phasen (Dateien → YMT → Paketierung). Am Ende öffnest du den Ausgabeordner direkt.
            </DocStep>
          </DocSteps>
          <DocH3>Die Ziele im Überblick</DocH3>
          <DocTable
            head={["Ziel", "Ausgabe", "Status"]}
            rows={[
              ["FiveM", "fxmanifest.lua + stream/ mit echten binären YMTs", "Empfohlen"],
              ["Singleplayer", "dlc.rpf für den GTA-V-Einzelspieler", "Stabil"],
              ["RageMP", "dlc.rpf im Client-Format", "Experimentell"],
              ["alt:V", "Ordner-Struktur als DLC-Ressource", "Experimentell"],
            ]}
          />
          <DocCallout kind="tip" title="Über 128 Drawables? Kein Problem.">
            atelier teilt automatisch in mehrere Addons auf (128er-Split pro Geschlecht). Die
            Datei-Nummerierung startet dabei in jedem Teil sauber bei <Code>000</Code> — genau so,
            wie GTA es erwartet.
          </DocCallout>
        </DocSection>

        <DocSection id="cloud" title="Team-Cloud">
          <DocP>
            Mit einer angebundenen atelier-api baut ihr gemeinsam am selben Pack. Im Cloud-Bereich
            der Werkbank verknüpfst du dein Projekt mit einem Cloud-Pack und synchronisierst Stände.
          </DocP>
          <DocUl>
            <DocLi>
              <strong className="text-white/80">Hochladen (Push).</strong> Lädt nur die wirklich
              neuen Dateien hoch (Dedupe per Hash) und committet eine neue Revision.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Laden (Pull).</strong> Holt den aktuellen Stand;
              lokale Änderungen werden vorher abgesichert.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Cloud-Projekte.</strong> Team-Packs erscheinen auf
              der Startseite und lassen sich lokal klonen.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Presence &amp; Locks.</strong> Avatare zeigen, wer
              online ist; sanfte Locks verhindern, dass ihr euch beim selben Drawable in die Quere
              kommt.
            </DocLi>
          </DocUl>
          <DocCallout kind="info">
            Bei einem Versionskonflikt bietet atelier dir die Wahl: den Remote-Stand laden oder
            erneut auf dessen Basis hochladen. Nichts wird stillschweigend überschrieben.
          </DocCallout>
        </DocSection>

        <DocSection id="einstellungen" title="Einstellungen & Hilfe">
          <DocH3>Einstellungen</DocH3>
          <DocUl>
            <DocLi>Server-Adresse, GTA-V-Pfad und Sidecar-Status verwalten.</DocLi>
            <DocLi>Live-Logs ein- oder ausschalten.</DocLi>
            <DocLi>
              Den Onboarding-Assistenten erneut ausführen, um die Ersteinrichtung neu durchzugehen.
            </DocLi>
            <DocLi>
              Admins finden hier den <strong className="text-white/80">Admin-Tab</strong> mit der
              Liste wartender Mitglieder und Freischalten/Sperren.
            </DocLi>
          </DocUl>
          <DocH3>Der Sidecar-Status (oben rechts)</DocH3>
          <DocP>
            Die kleine Pille zeigt den Zustand des .NET-Sidecars: grün = bereit, orange = startet,
            rot = nicht erreichbar. Parsing, Vorschau und Build brauchen einen grünen Sidecar.
          </DocP>
          <DocCallout kind="warn" title="Sidecar bleibt rot?">
            Starte atelier neu — der Sidecar wird beim Start automatisch mitgestartet und überwacht.
            Hilft das nicht, aktiviere die Logs und schau dir die Sidecar-Meldungen an. Prüfe
            außerdem, ob eine Firewall die lokale Verbindung blockiert.
          </DocCallout>
        </DocSection>

        <DocPager
          prev={{ href: "/docs", title: "Übersicht" }}
          next={{ href: "/docs/atelier-api", title: "atelier-api — das Backend" }}
          ariaLabel={pagerAria}
          prevLabel={pagerPrev}
          nextLabel={pagerNext}
        />
      </article>
    );
  }

  // English (default)
  return (
    <article>
      <DocH1>atelier — the desktop app</DocH1>
      <DocLead>
        atelier is the feelgood community&apos;s free desktop tool for building, checking and
        publishing GTA V add-on clothing and tattoos. This page takes you all the way from
        installation to a finished pack.
      </DocLead>

      <DocSection id="einstieg" title="What is atelier?">
        <DocP>
          atelier manages your drawables, shows them in real-time 3D and turns them into finished,
          in-game-ready add-ons — in the spirit of grzyClothTool, rebuilt from scratch as its own
          thing. You work in a workbench, check everything in the preview and export with a single
          click.
        </DocP>
        <DocUl>
          <DocLi>
            <strong className="text-white/80">Solo mode:</strong> fully local, no account or server —
            works completely offline.
          </DocLi>
          <DocLi>Targets: FiveM, singleplayer, RageMP and alt:V.</DocLi>
          <DocLi>Real binary YMTs, automatic 128-drawable splitting, texture optimization.</DocLi>
          <DocLi>Optional: a team cloud for building the same pack together.</DocLi>
        </DocUl>
        <DocCallout kind="info" title="Platform">
          atelier runs on Windows 10/11 (64-bit). The .NET sidecar for parsing &amp; preview is
          included in the download — there&apos;s nothing extra to install.
        </DocCallout>
      </DocSection>

      <DocSection id="installation" title="Installation">
        <DocP>
          Grab the latest version from the{" "}
          <DocLink href={LINKS.DOWNLOAD}>GitHub releases</DocLink> and pick one of the builds:
        </DocP>
        <DocUl>
          <DocLi>
            <strong className="text-white/80">Installer (.exe)</strong> — the standard route. Double-
            click, install, done.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">MSI</strong> — the alternative, e.g. for managed
            environments.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Portable ZIP</strong> — no installation: unzip and
            launch <Code>atelier.exe</Code>. The app and sidecar are both included.
          </DocLi>
        </DocUl>
        <DocCallout kind="tip" title="Updating">
          To update, just install the new version over the old one — your projects and settings stay
          intact.
        </DocCallout>
      </DocSection>

      <DocSection id="erste-schritte" title="Getting started">
        <DocP>
          On first launch a short onboarding wizard walks you through setup. You can rerun it any
          time later from the settings.
        </DocP>
        <DocSteps>
          <DocStep n={1}>
            <strong className="text-white/80">Mode.</strong> Choose how you use atelier:{" "}
            <strong className="text-white/80">Solo</strong> — fully local, no account and no server
            (everything runs offline) — or <strong className="text-white/80">Team</strong>, to sign in
            and share packs via the cloud. You can switch the mode any time later in the settings.
          </DocStep>
          <DocStep n={2}>
            <strong className="text-white/80">Server address (team only).</strong> In team mode you
            enter the address of your atelier-api. atelier checks it live and turns green when an
            atelier-api is running there. The default for local testing is{" "}
            <Code>http://127.0.0.1:3095</Code>. In solo mode this step is skipped.
          </DocStep>
          <DocStep n={3}>
            <strong className="text-white/80">GTA V directory.</strong> Choose the folder of your
            GTA V installation. This lets the 3D preview show the real ped body. Optional — without a
            GTA path everything else still works.
          </DocStep>
          <DocStep n={4}>
            <strong className="text-white/80">Logs.</strong> Optionally enable a live log console
            that shows app and sidecar events. Handy when something goes wrong; otherwise you can
            leave it off.
          </DocStep>
        </DocSteps>
        <DocCallout kind="info">
          In solo mode you need neither a server nor an account — you can build packs locally right
          away. The server address is only needed for login and the team cloud.
        </DocCallout>
      </DocSection>

      <DocSection id="login" title="Login & access">
        <DocCallout kind="info" title="Team mode only">
          In solo mode you don&apos;t need an account — you can skip this section. The login screen
          also has a &ldquo;use without an account (solo)&rdquo; option.
        </DocCallout>
        <DocP>
          Login goes through Discord. atelier briefly opens your browser, you confirm on Discord, and
          the app is signed in — there are no passwords.
        </DocP>
        <DocSteps>
          <DocStep n={1}>Click &ldquo;Sign in&rdquo; in atelier.</DocStep>
          <DocStep n={2}>
            Confirm with Discord in your browser. The login then returns to the app automatically.
          </DocStep>
          <DocStep n={3}>
            Done — the app remembers your login and refreshes it in the background.
          </DocStep>
        </DocSteps>
        <DocCallout kind="warn" title="Waiting for approval">
          New accounts start out as <Code>pending</Code>: you&apos;re signed in, but an admin has to
          approve you once for cloud actions. Until then you&apos;ll see a &ldquo;waiting for
          approval&rdquo; notice. Admins approve new members in the settings under
          <span className="whitespace-nowrap"> &ldquo;Admin&rdquo;</span>.
        </DocCallout>
      </DocSection>

      <DocSection id="werkbank" title="The workbench">
        <DocP>
          The workbench is your workspace — three columns plus a dockable preview:
        </DocP>
        <DocH3>Category tree (left)</DocH3>
        <DocP>
          Every component and prop slot with live counters. Warning badges flag problems early — such
          as missing LODs or too many or oversized textures.
        </DocP>
        <DocH3>Drawable list (center)</DocH3>
        <DocUl>
          <DocLi>Search and filter in real time, multi-select with Ctrl/Shift-click.</DocLi>
          <DocLi>
            Reorder via drag &amp; drop — the order determines the build order.
          </DocLi>
          <DocLi>
            Context menu to duplicate, delete and group; identical YDD hashes are detected as
            duplicates.
          </DocLi>
        </DocUl>
        <DocH3>Inspector (right)</DocH3>
        <DocP>
          Details for the selected drawable: label, gender, slot, add-on or replace mode, groups and
          flags like high heels and hair scale. Below it sits the textures panel with the a–z
          variants and their thumbnails.
        </DocP>
      </DocSection>

      <DocSection id="vorschau" title="3D preview">
        <DocP>
          The dockable preview shows your drawables in real time — in the dark feelgood look with a
          freely rotatable camera.
        </DocP>
        <DocUl>
          <DocLi>
            <strong className="text-white/80">Several drawables at once</strong> as a complete outfit,
            including texture variants to cycle through.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Camera presets</strong> for full body, head, torso,
            legs and feet.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Hair shrink &amp; heel height</strong> adjustable live —
            so you can immediately see how much the hair shrinks or how high heels lift the ped.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Ped body</strong> toggle (mp_m/mp_f) as soon as a GTA V
            path is set. Overlays show poly/vertex counts and LOD warnings.
          </DocLi>
        </DocUl>
        <DocCallout kind="info">
          Without a GTA path set, the ped body stays disabled — but you can still preview the
          drawables themselves.
        </DocCallout>
      </DocSection>

      <DocSection id="tattoos" title="Tattoos">
        <DocP>
          Beyond clothing, atelier also builds <strong className="text-white/80">tattoos</strong> — in
          their own Tattoos area (the icon in the top navigation). Tattoos are fixed-UV decals: you
          import an image and set zone, gender and type; the exact placement lives in the texture.
        </DocP>
        <DocUl>
          <DocLi>
            <strong className="text-white/80">Import</strong> — PNG, DDS or YTD via a button; works
            fully offline (no GTA path needed).
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Organize</strong> — by the six body zones (torso, head,
            left/right arm, left/right leg), with search, a grid and an inspector. Right-click to
            duplicate, change zone/gender, group and delete.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Gender</strong> — one decal can serve both freemode peds
            (M/F); each gender gets its own overlay name.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Build</strong> — produces a streamable FiveM pack: a YTD
            per decal, one shared overlay collection, an optional <Code>shop_tattoo.meta</Code> and a{" "}
            <Code>tattoos.json</Code> manifest your server reads at runtime.
          </DocLi>
        </DocUl>
        <DocCallout kind="info" title="Applying in-game">
          The pack ships the assets plus <Code>tattoos.json</Code>; tattoos are applied at runtime on
          the server (<Code>AddPedDecorationFromHashes</Code>) — that part is outside atelier.
        </DocCallout>
      </DocSection>

      <DocSection id="bauen" title="Build & export">
        <DocP>
          &ldquo;Build&rdquo; exports your project as a finished resource. The dialog walks you
          through setup, validation and build in three steps.
        </DocP>
        <DocSteps>
          <DocStep n={1}>
            <strong className="text-white/80">Setup.</strong> Pick a target, set the DLC name
            (lowercase letters, digits and underscore only) and choose an output folder.
          </DocStep>
          <DocStep n={2}>
            <strong className="text-white/80">Validation.</strong> atelier checks the project and
            lists errors, warnings and hints — each with a jump to the affected drawable. Errors
            block the build, warnings don&apos;t.
          </DocStep>
          <DocStep n={3}>
            <strong className="text-white/80">Build.</strong> Progress runs live through the phases
            (files → YMT → packaging). At the end you open the output folder directly.
          </DocStep>
        </DocSteps>
        <DocH3>The targets at a glance</DocH3>
        <DocTable
          head={["Target", "Output", "Status"]}
          rows={[
            ["FiveM", "fxmanifest.lua + stream/ with real binary YMTs", "Recommended"],
            ["Singleplayer", "dlc.rpf for GTA V singleplayer", "Stable"],
            ["RageMP", "dlc.rpf in client format", "Experimental"],
            ["alt:V", "Folder structure as a DLC resource", "Experimental"],
          ]}
        />
        <DocCallout kind="tip" title="More than 128 drawables? No problem.">
          atelier automatically splits across multiple add-ons (128 per gender). The file numbering
          cleanly restarts at <Code>000</Code> in each part — exactly the way GTA expects it.
        </DocCallout>
      </DocSection>

      <DocSection id="cloud" title="Team cloud">
        <DocP>
          With a connected atelier-api you build the same pack together. In the workbench&apos;s cloud
          area you link your project to a cloud pack and sync states.
        </DocP>
        <DocUl>
          <DocLi>
            <strong className="text-white/80">Upload (push).</strong> Uploads only the files that are
            genuinely new (dedupe by hash) and commits a new revision.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Download (pull).</strong> Fetches the current state;
            local changes are safeguarded beforehand.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Cloud projects.</strong> Team packs appear on the home
            screen and can be cloned locally.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Presence &amp; locks.</strong> Avatars show who&apos;s
            online; soft locks keep you from getting in each other&apos;s way on the same drawable.
          </DocLi>
        </DocUl>
        <DocCallout kind="info">
          On a version conflict, atelier gives you the choice: pull the remote state or re-upload on
          top of it. Nothing is silently overwritten.
        </DocCallout>
      </DocSection>

      <DocSection id="einstellungen" title="Settings & help">
        <DocH3>Settings</DocH3>
        <DocUl>
          <DocLi>Manage the server address, GTA V path and sidecar status.</DocLi>
          <DocLi>Turn live logs on or off.</DocLi>
          <DocLi>
            Rerun the onboarding wizard to go through the initial setup again.
          </DocLi>
          <DocLi>
            Admins find the <strong className="text-white/80">Admin tab</strong> here, with the list
            of pending members and approve/lock actions.
          </DocLi>
        </DocUl>
        <DocH3>The sidecar status (top right)</DocH3>
        <DocP>
          The little pill shows the state of the .NET sidecar: green = ready, orange = starting, red
          = unreachable. Parsing, preview and build all need a green sidecar.
        </DocP>
        <DocCallout kind="warn" title="Sidecar stuck on red?">
          Restart atelier — the sidecar is started and supervised automatically on launch. If that
          doesn&apos;t help, enable the logs and look at the sidecar messages. Also check whether a
          firewall is blocking the local connection.
        </DocCallout>
      </DocSection>

      <DocPager
        prev={{ href: "/docs", title: "Overview" }}
        next={{ href: "/docs/atelier-api", title: "atelier-api — the backend" }}
        ariaLabel={pagerAria}
        prevLabel={pagerPrev}
        nextLabel={pagerNext}
      />
    </article>
  );
}
