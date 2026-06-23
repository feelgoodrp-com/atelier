
/**
 * atelier-api (Backend) docs — the bilingual client body for
 * app/docs/atelier-api/page.tsx.
 *
 * THE DOCS PATTERN (see app/docs/overview-doc.tsx for the reference):
 *   - app/docs/atelier-api/page.tsx stays a SERVER component: it
 *     `export const metadata` (SEO, default = English) and renders exactly ONE
 *     client doc component — this one.
 *   - This component is "use client", reads `useLocale()`, and returns the EN or
 *     DE article via a conditional. Both languages live inline here.
 *   - Section `id`s and `href`/anchors are language-neutral and must keep
 *     matching lib/docs-nav.ts (ueberblick, voraussetzungen, env, discord,
 *     storage, deployment, admin, endpoints).
 *   - DocPager chrome labels come from DOCS_UI via `t(..., locale)`.
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
  DocCode,
  DocCallout,
  DocTable,
  DocLink,
  DocPager,
  Code,
} from "./doc";
import { DOCS_UI, t } from "./docs-nav";
import { useLocale } from "./locale";
import { LINKS } from "./links";

export function AtelierApiDoc() {
  const { locale } = useLocale();
  const pagerAria = t(DOCS_UI.pagerAria, locale);
  const pagerPrev = t(DOCS_UI.pagerPrev, locale);
  const pagerNext = t(DOCS_UI.pagerNext, locale);

  if (locale === "de") {
    return (
      <article>
        <DocH1>atelier-api — das Backend</DocH1>
        <DocLead>
          atelier-api ist der Server hinter der App: Login, Team-Cloud, Storage und gemeinsames Bauen.
          Eine Instanz reicht fürs ganze Team. Diese Seite zeigt dir, wie du sie selbst hostest.
        </DocLead>

        <DocSection id="ueberblick" title="Überblick">
          <DocP>
            atelier-api ist ein schlanker <DocLink href="https://bun.sh">Bun</DocLink>-Service mit
            MongoDB als Datenbank. Assets liegen in einem Content-Addressed Store auf der Platte (per
            SHA-256 adressiert, dedupliziert). Standardmäßig lauscht der Server auf Port{" "}
            <Code>3095</Code>.
          </DocP>
          <DocUl>
            <DocLi>Discord-Login mit Freigabe-Workflow (pending → approved).</DocLi>
            <DocLi>Versionierte Pack-Revisionen, resumable Uploads, Team-Locks über WebSocket.</DocLi>
            <DocLi>
              Registry-Lane mit Service-Token, damit Webseiten veröffentlichte Packs abfragen können.
            </DocLi>
            <DocLi>
              <DocLink href="#admin">Web-Admin-Dashboard</DocLink> unter <Code>/admin</Code> — Logs,
              Speicher, Build-Downloads und fxmanifest-Overrides.
            </DocLi>
          </DocUl>
          <DocP>
            Quellcode &amp; Issues: <DocLink href={LINKS.API_REPO}>atelier-api auf GitHub</DocLink>.
          </DocP>
        </DocSection>

        <DocSection id="voraussetzungen" title="Voraussetzungen">
          <DocUl>
            <DocLi>
              <strong className="text-white/80">Bun</strong> (1.x) — zum Starten des Servers.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">MongoDB</strong> — eine eigene Instanz oder MongoDB
              Atlas.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Eine Discord-Anwendung</strong> für den Login (kostenlos
              im Discord Developer Portal).
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Persistenter Speicher</strong> für die Assets — siehe{" "}
              <DocLink href="#storage">Storage &amp; Volume</DocLink>.
            </DocLi>
          </DocUl>
          <DocH3>Lokal starten</DocH3>
          <DocCode title="Terminal">{`cd atelier-api
bun install
cp .env.example .env.local   # Werte ausfüllen
bun run dev                  # mit Auto-Reload

# Läuft? Health-Check:
curl http://127.0.0.1:3095/health`}</DocCode>
        </DocSection>

        <DocSection id="env" title="Environment-Variablen">
          <DocP>
            Konfiguriert wird über <Code>.env.local</Code> (lokal) bzw. die Umgebung des Hosters. Die
            wichtigsten Variablen:
          </DocP>
          <DocTable
            head={["Variable", "Beschreibung"]}
            rows={[
              ["MONGODB_URI", "Pflicht — Connection-String zu MongoDB (z. B. mongodb+srv://…)."],
              ["MONGODB_DB_NAME", "Datenbankname (frei wählbar), Standard atelier."],
              ["ATELIER_JWT_SECRET", "Pflicht — Secret zum Signieren der Tokens (lang & zufällig)."],
              ["ATELIER_SERVICE_TOKEN", "Pflicht — Token für die Service-Lane (Registry für Webseiten)."],
              ["ATELIER_PUBLIC_ORIGIN", "Öffentliche Basis-URL des Servers (in Produktion https://…)."],
              ["ATELIER_DISCORD_CLIENT_ID", "Client-ID deiner Discord-Anwendung."],
              ["ATELIER_DISCORD_CLIENT_SECRET", "Client-Secret deiner Discord-Anwendung."],
              ["ATELIER_ADMIN_DISCORD_IDS", "Komma-Liste von Discord-IDs, die automatisch Admin sind."],
              ["ATELIER_STORAGE_ROOT", "Pfad für die Assets — muss persistent sein (Default ./data)."],
              ["PORT", "HTTP-Port, Standard 3095."],
              ["HOST", "Bind-Adresse — in Produktion 0.0.0.0."],
              ["ATELIER_BUILD_CONCURRENCY", "Parallele Server-Builds, Standard 2."],
            ]}
          />
          <DocCallout kind="warn" title="Secrets nie committen">
            <Code>ATELIER_JWT_SECRET</Code> und <Code>ATELIER_SERVICE_TOKEN</Code> sollten lang und
            zufällig sein (z. B. <Code>openssl rand -hex 32</Code>) und gehören nur in die Umgebung —
            niemals ins Repo. Die vollständige Liste inkl. Defaults steht in <Code>.env.example</Code>.
          </DocCallout>
        </DocSection>

        <DocSection id="discord" title="Discord-OAuth & Freigabe">
          <DocH3>Discord-Anwendung anlegen</DocH3>
          <DocSteps>
            <DocStep n={1}>
              Im <DocLink href="https://discord.com/developers/applications">Discord Developer Portal</DocLink>{" "}
              eine neue Application erstellen (Name z. B. „atelier").
            </DocStep>
            <DocStep n={2}>
              Unter <strong className="text-white/80">OAuth2</strong> Client-ID und Client-Secret in
              deine Env übernehmen (<Code>ATELIER_DISCORD_CLIENT_ID</Code> /{" "}
              <Code>ATELIER_DISCORD_CLIENT_SECRET</Code>).
            </DocStep>
            <DocStep n={3}>
              Als <strong className="text-white/80">Redirects</strong> beide exakt eintragen — einen für
              die Desktop-App, einen fürs Web-Admin-Dashboard:
              <div className="mt-3">
                <DocCode>{`{ATELIER_PUBLIC_ORIGIN}/api/v1/auth/discord/callback
{ATELIER_PUBLIC_ORIGIN}/admin/callback`}</DocCode>
              </div>
              Lokal also <Code>http://127.0.0.1:3095/api/v1/auth/discord/callback</Code> bzw.{" "}
              <Code>http://127.0.0.1:3095/admin/callback</Code>. Der Scope <Code>identify</Code> wird
              automatisch angefragt.
            </DocStep>
          </DocSteps>
          <DocH3>Freigabe-Workflow</DocH3>
          <DocP>
            Neue Mitglieder landen als <Code>pending</Code> und müssen einmalig freigeschaltet werden.
            Discord-IDs in <Code>ATELIER_ADMIN_DISCORD_IDS</Code> sind automatisch Admin und freigegeben
            — diese Admins schalten dann alle weiteren direkt in der App frei.
          </DocP>
          <DocUl>
            <DocLi>
              <Code>pending</Code> — angemeldet, aber für Cloud-Aktionen gesperrt.
            </DocLi>
            <DocLi>
              <Code>approved</Code> — voller Zugriff auf Packs, Sync und Builds.
            </DocLi>
            <DocLi>
              <Code>locked</Code> — gesperrt, alle Geräte-Anmeldungen werden widerrufen.
            </DocLi>
          </DocUl>
        </DocSection>

        <DocSection id="storage" title="Storage & Volume">
          <DocP>
            Alle hochgeladenen Dateien liegen unter <Code>ATELIER_STORAGE_ROOT</Code> in einem Content-
            Addressed Store. Die MongoDB speichert nur die Metadaten und Verweise (per SHA-256).
          </DocP>
          <DocCode title="ATELIER_STORAGE_ROOT/">{`cas/      finalisierte Assets (unveränderlich, per Hash)
tmp/      laufende Uploads
builds/   zwischengespeicherte Build-Artefakte`}</DocCode>
          <DocCallout kind="warn" title="Das Volume MUSS persistent sein">
            Wird dieses Verzeichnis bei einem Redeploy gelöscht (z. B. Container ohne Volume), bleiben
            die MongoDB-Verweise zwar bestehen, die Dateien sind aber weg — Downloads scheitern dann mit{" "}
            <Code>asset_not_found</Code>. Lege <Code>ATELIER_STORAGE_ROOT</Code> immer auf ein
            persistentes Volume und sichere es regelmäßig. Nach einem Wipe müssen Besitzer ihre Packs
            neu hochladen.
          </DocCallout>
        </DocSection>

        <DocSection id="deployment" title="Deployment (Dokploy)">
          <DocP>
            atelier-api bringt ein <Code>Dockerfile</Code> mit (<Code>oven/bun</Code>) und lässt sich so
            überall als Container betreiben. Mit Dokploy in Kürze:
          </DocP>
          <DocSteps>
            <DocStep n={1}>
              In Dokploy eine neue <strong className="text-white/80">Application</strong> aus dem
              atelier-api-Repository (oder dem Docker-Image) anlegen.
            </DocStep>
            <DocStep n={2}>
              Die <DocLink href="#env">Environment-Variablen</DocLink> setzen — insbesondere{" "}
              <Code>MONGODB_URI</Code>, <Code>ATELIER_JWT_SECRET</Code>,{" "}
              <Code>ATELIER_SERVICE_TOKEN</Code>, die beiden Discord-Werte und{" "}
              <Code>HOST=0.0.0.0</Code>.
            </DocStep>
            <DocStep n={3}>
              Ein <strong className="text-white/80">persistentes Volume</strong> an{" "}
              <Code>ATELIER_STORAGE_ROOT</Code> mounten (z. B. <Code>/data</Code>). Das ist der
              wichtigste Schritt — ohne ihn verlierst du beim nächsten Deploy alle Assets.
            </DocStep>
            <DocStep n={4}>
              Eine Domain zuweisen und Port <Code>3095</Code> freigeben. Trage dieselbe öffentliche
              <span className="whitespace-nowrap"> HTTPS-URL</span> als <Code>ATELIER_PUBLIC_ORIGIN</Code>{" "}
              ein und hinterlege sie als Discord-Redirect.
            </DocStep>
            <DocStep n={5}>Deployen und mit <Code>GET /health</Code> prüfen.</DocStep>
          </DocSteps>
          <DocCode title="Alternativ: pur per Docker">{`docker run -d --name atelier-api \\
  -p 3095:3095 \\
  -v atelier-data:/data \\
  --env-file .env \\
  atelier-api`}</DocCode>
        </DocSection>

        <DocSection id="admin" title="Admin-Dashboard (Web)">
          <DocP>
            Der Server bringt unter <Code>/admin</Code> ein eigenes Web-Dashboard mit — Login nur für
            die Discord-IDs aus <Code>ATELIER_ADMIN_DISCORD_IDS</Code>. Die Anmeldung läuft über einen
            eigenen Discord-Web-Flow (getrennt von der Desktop-App), die Session steckt in einem
            HttpOnly-Cookie, und der Admin-Status wird bei jedem Request neu geprüft.
          </DocP>
          <DocUl>
            <DocLi>
              <strong className="text-white/80">Übersicht</strong> — Speichergröße (CAS/Builds/tmp) und
              Kennzahlen (Assets, Packs, Revisionen, Builds, Nutzer).
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Logs</strong> — Server-Logs live (SSE) plus
              Aktivitäts-Protokoll.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Packs &amp; Builds</strong> — Server-Builds pro Revision
              erzeugen oder neu bauen und die fertigen Pakete als ZIP herunterladen.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">fxmanifest</strong> — pro Pack den Resource-Namen und ein{" "}
              <Code>fxmanifest.lua</Code>-Template überschreiben. Greift beim nächsten Server-Build; ohne
              Override bleibt alles byte-identisch zum Desktop-Build.
            </DocLi>
            <DocLi>
              <strong className="text-white/80">Nutzer</strong> — freischalten und sperren.
            </DocLi>
          </DocUl>
          <DocCallout kind="info" title="Voraussetzung">
            Echte Discord-Credentials und die zweite Redirect-URI{" "}
            <Code>{`{ATELIER_PUBLIC_ORIGIN}/admin/callback`}</Code> (siehe{" "}
            <DocLink href="#discord">Discord-OAuth</DocLink>). Danach erreichbar unter{" "}
            <Code>{`{ATELIER_PUBLIC_ORIGIN}/admin`}</Code>.
          </DocCallout>
        </DocSection>

        <DocSection id="endpoints" title="Endpoint-Übersicht">
          <DocP>
            Alle Endpoints liegen unter <Code>/api/v1</Code>. Nutzer-Endpoints brauchen einen Bearer-
            Token (aus dem Login), die Registry-Lane einen Service-Token. Die wichtigsten Gruppen:
          </DocP>
          <DocTable
            head={["Gruppe", "Zweck"]}
            rows={[
              ["auth / device", "Discord-Login, Token-Tausch und -Erneuerung, Logout."],
              ["me / devices", "Eigenes Profil und angemeldete Geräte verwalten."],
              ["admin", "Mitglieder auflisten, freischalten, sperren, Rollen setzen."],
              ["/admin (Web)", "Browser-Dashboard: Übersicht, Logs, Build-Downloads, fxmanifest — Cookie-Login, nur Admins."],
              ["uploads / assets", "Resumable Chunk-Uploads und Asset-Download (mit Range/ETag)."],
              ["packs / revisions", "Packs, Mitglieder und versionierte Revisionen."],
              ["locks", "Advisory-Locks pro Drawable (TTL, Heartbeat)."],
              ["builds", "Server-Builds in die Queue stellen und Artefakte abrufen."],
              ["registry", "Service-Lane: veröffentlichte Packs für Webseiten (Service-Token)."],
              ["ws", "WebSocket für Presence, Locks und Live-Status."],
            ]}
          />
          <DocCallout kind="info" title="Health & Service-Token">
            Ein schneller Lebenszeichen-Check geht ohne Token über <Code>GET /health</Code>. Webseiten
            sprechen die Registry per Header <Code>x-fg-service-token</Code> an. Server-Builds enthalten
            keine binären YMTs (die entstehen im Desktop-Build) — sie dienen Vorschau und Verteilung.
          </DocCallout>
        </DocSection>

        <DocPager
          prev={{ href: "/docs/atelier", title: "atelier — Desktop-App" }}
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
      <DocH1>atelier-api — the backend</DocH1>
      <DocLead>
        atelier-api is the server behind the app: login, team cloud, storage and building together.
        One instance is enough for the whole team. This page shows you how to self-host it.
      </DocLead>

      <DocSection id="ueberblick" title="Overview">
        <DocP>
          atelier-api is a lean <DocLink href="https://bun.sh">Bun</DocLink> service with MongoDB as
          its database. Assets live in a content-addressed store on disk (addressed by SHA-256,
          deduplicated). By default the server listens on port <Code>3095</Code>.
        </DocP>
        <DocUl>
          <DocLi>Discord login with an approval workflow (pending → approved).</DocLi>
          <DocLi>Versioned pack revisions, resumable uploads, team locks over WebSocket.</DocLi>
          <DocLi>
            A registry lane with a service token so websites can query published packs.
          </DocLi>
          <DocLi>
            <DocLink href="#admin">Web admin dashboard</DocLink> at <Code>/admin</Code> — logs,
            storage, build downloads and fxmanifest overrides.
          </DocLi>
        </DocUl>
        <DocP>
          Source &amp; issues: <DocLink href={LINKS.API_REPO}>atelier-api on GitHub</DocLink>.
        </DocP>
      </DocSection>

      <DocSection id="voraussetzungen" title="Requirements">
        <DocUl>
          <DocLi>
            <strong className="text-white/80">Bun</strong> (1.x) — to run the server.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">MongoDB</strong> — your own instance or MongoDB Atlas.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">A Discord application</strong> for login (free in the
            Discord Developer Portal).
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Persistent storage</strong> for the assets — see{" "}
            <DocLink href="#storage">Storage &amp; volume</DocLink>.
          </DocLi>
        </DocUl>
        <DocH3>Run it locally</DocH3>
        <DocCode title="Terminal">{`cd atelier-api
bun install
cp .env.example .env.local   # fill in the values
bun run dev                  # with auto-reload

# Running? Health check:
curl http://127.0.0.1:3095/health`}</DocCode>
      </DocSection>

      <DocSection id="env" title="Environment variables">
        <DocP>
          Configuration goes through <Code>.env.local</Code> (locally) or your host&apos;s environment.
          The most important variables:
        </DocP>
        <DocTable
          head={["Variable", "Description"]}
          rows={[
            ["MONGODB_URI", "Required — connection string to MongoDB (e.g. mongodb+srv://…)."],
            ["MONGODB_DB_NAME", "Database name (your choice), defaults to atelier."],
            ["ATELIER_JWT_SECRET", "Required — secret for signing tokens (long & random)."],
            ["ATELIER_SERVICE_TOKEN", "Required — token for the service lane (registry for websites)."],
            ["ATELIER_PUBLIC_ORIGIN", "Public base URL of the server (https://… in production)."],
            ["ATELIER_DISCORD_CLIENT_ID", "Client ID of your Discord application."],
            ["ATELIER_DISCORD_CLIENT_SECRET", "Client secret of your Discord application."],
            ["ATELIER_ADMIN_DISCORD_IDS", "Comma-separated list of Discord IDs that are admins automatically."],
            ["ATELIER_STORAGE_ROOT", "Path for the assets — must be persistent (default ./data)."],
            ["PORT", "HTTP port, defaults to 3095."],
            ["HOST", "Bind address — 0.0.0.0 in production."],
            ["ATELIER_BUILD_CONCURRENCY", "Parallel server builds, defaults to 2."],
          ]}
        />
        <DocCallout kind="warn" title="Never commit secrets">
          <Code>ATELIER_JWT_SECRET</Code> and <Code>ATELIER_SERVICE_TOKEN</Code> should be long and
          random (e.g. <Code>openssl rand -hex 32</Code>) and belong only in the environment — never
          in the repo. The full list including defaults lives in <Code>.env.example</Code>.
        </DocCallout>
      </DocSection>

      <DocSection id="discord" title="Discord OAuth & access">
        <DocH3>Create a Discord application</DocH3>
        <DocSteps>
          <DocStep n={1}>
            In the{" "}
            <DocLink href="https://discord.com/developers/applications">Discord Developer Portal</DocLink>{" "}
            create a new application (name it e.g. &quot;atelier&quot;).
          </DocStep>
          <DocStep n={2}>
            Under <strong className="text-white/80">OAuth2</strong> copy the client ID and client
            secret into your env (<Code>ATELIER_DISCORD_CLIENT_ID</Code> /{" "}
            <Code>ATELIER_DISCORD_CLIENT_SECRET</Code>).
          </DocStep>
          <DocStep n={3}>
            Add both <strong className="text-white/80">redirects</strong> exactly — one for the
            desktop app, one for the web admin dashboard:
            <div className="mt-3">
              <DocCode>{`{ATELIER_PUBLIC_ORIGIN}/api/v1/auth/discord/callback
{ATELIER_PUBLIC_ORIGIN}/admin/callback`}</DocCode>
            </div>
            Locally that&apos;s <Code>http://127.0.0.1:3095/api/v1/auth/discord/callback</Code> and{" "}
            <Code>http://127.0.0.1:3095/admin/callback</Code>. The <Code>identify</Code> scope is
            requested automatically.
          </DocStep>
        </DocSteps>
        <DocH3>Approval workflow</DocH3>
        <DocP>
          New members start out as <Code>pending</Code> and have to be approved once. Discord IDs in{" "}
          <Code>ATELIER_ADMIN_DISCORD_IDS</Code> are admins and approved automatically — those admins
          then approve everyone else directly in the app.
        </DocP>
        <DocUl>
          <DocLi>
            <Code>pending</Code> — signed in, but blocked from cloud actions.
          </DocLi>
          <DocLi>
            <Code>approved</Code> — full access to packs, sync and builds.
          </DocLi>
          <DocLi>
            <Code>locked</Code> — blocked, all device sessions are revoked.
          </DocLi>
        </DocUl>
      </DocSection>

      <DocSection id="storage" title="Storage & volume">
        <DocP>
          Every uploaded file lives under <Code>ATELIER_STORAGE_ROOT</Code> in a content-addressed
          store. MongoDB only holds the metadata and references (by SHA-256).
        </DocP>
        <DocCode title="ATELIER_STORAGE_ROOT/">{`cas/      finalized assets (immutable, by hash)
tmp/      uploads in progress
builds/   cached build artifacts`}</DocCode>
        <DocCallout kind="warn" title="The volume MUST be persistent">
          If this directory is wiped on a redeploy (e.g. a container without a volume), the MongoDB
          references remain but the files are gone — downloads then fail with{" "}
          <Code>asset_not_found</Code>. Always put <Code>ATELIER_STORAGE_ROOT</Code> on a persistent
          volume and back it up regularly. After a wipe, owners have to re-upload their packs.
        </DocCallout>
      </DocSection>

      <DocSection id="deployment" title="Deployment (Dokploy)">
        <DocP>
          atelier-api ships with a <Code>Dockerfile</Code> (<Code>oven/bun</Code>) so it runs as a
          container anywhere. With Dokploy, in short:
        </DocP>
        <DocSteps>
          <DocStep n={1}>
            In Dokploy, create a new <strong className="text-white/80">application</strong> from the
            atelier-api repository (or the Docker image).
          </DocStep>
          <DocStep n={2}>
            Set the <DocLink href="#env">environment variables</DocLink> — in particular{" "}
            <Code>MONGODB_URI</Code>, <Code>ATELIER_JWT_SECRET</Code>,{" "}
            <Code>ATELIER_SERVICE_TOKEN</Code>, the two Discord values and{" "}
            <Code>HOST=0.0.0.0</Code>.
          </DocStep>
          <DocStep n={3}>
            Mount a <strong className="text-white/80">persistent volume</strong> at{" "}
            <Code>ATELIER_STORAGE_ROOT</Code> (e.g. <Code>/data</Code>). This is the most important
            step — without it you lose all assets on the next deploy.
          </DocStep>
          <DocStep n={4}>
            Assign a domain and expose port <Code>3095</Code>. Set the same public
            <span className="whitespace-nowrap"> HTTPS URL</span> as <Code>ATELIER_PUBLIC_ORIGIN</Code>{" "}
            and register it as a Discord redirect.
          </DocStep>
          <DocStep n={5}>Deploy and verify with <Code>GET /health</Code>.</DocStep>
        </DocSteps>
        <DocCode title="Alternatively: plain Docker">{`docker run -d --name atelier-api \\
  -p 3095:3095 \\
  -v atelier-data:/data \\
  --env-file .env \\
  atelier-api`}</DocCode>
      </DocSection>

      <DocSection id="admin" title="Admin dashboard (web)">
        <DocP>
          The server ships its own web dashboard at <Code>/admin</Code> — sign-in is limited to the
          Discord IDs in <Code>ATELIER_ADMIN_DISCORD_IDS</Code>. Sign-in runs through a dedicated
          Discord web flow (separate from the desktop app), the session lives in an HttpOnly cookie,
          and admin status is re-checked on every request.
        </DocP>
        <DocUl>
          <DocLi>
            <strong className="text-white/80">Overview</strong> — storage size (CAS/builds/tmp) and
            key figures (assets, packs, revisions, builds, users).
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Logs</strong> — server logs live (SSE) plus an activity
            log.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Packs &amp; builds</strong> — generate or rebuild server
            builds per revision and download the finished packages as ZIP.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">fxmanifest</strong> — override the resource name and an{" "}
            <Code>fxmanifest.lua</Code> template per pack. It takes effect on the next server build;
            without an override everything stays byte-identical to the desktop build.
          </DocLi>
          <DocLi>
            <strong className="text-white/80">Users</strong> — approve and lock.
          </DocLi>
        </DocUl>
        <DocCallout kind="info" title="Prerequisite">
          Real Discord credentials and the second redirect URI{" "}
          <Code>{`{ATELIER_PUBLIC_ORIGIN}/admin/callback`}</Code> (see{" "}
          <DocLink href="#discord">Discord OAuth</DocLink>). After that it&apos;s reachable at{" "}
          <Code>{`{ATELIER_PUBLIC_ORIGIN}/admin`}</Code>.
        </DocCallout>
      </DocSection>

      <DocSection id="endpoints" title="Endpoint overview">
        <DocP>
          All endpoints live under <Code>/api/v1</Code>. User endpoints need a bearer token (from
          login), the registry lane needs a service token. The main groups:
        </DocP>
        <DocTable
          head={["Group", "Purpose"]}
          rows={[
            ["auth / device", "Discord login, token exchange and renewal, logout."],
            ["me / devices", "Manage your own profile and signed-in devices."],
            ["admin", "List members, approve, lock, set roles."],
            ["/admin (web)", "Browser dashboard: overview, logs, build downloads, fxmanifest — cookie login, admins only."],
            ["uploads / assets", "Resumable chunk uploads and asset download (with Range/ETag)."],
            ["packs / revisions", "Packs, members and versioned revisions."],
            ["locks", "Advisory locks per drawable (TTL, heartbeat)."],
            ["builds", "Queue server builds and fetch artifacts."],
            ["registry", "Service lane: published packs for websites (service token)."],
            ["ws", "WebSocket for presence, locks and live status."],
          ]}
        />
        <DocCallout kind="info" title="Health & service token">
          A quick liveness check works without a token via <Code>GET /health</Code>. Websites talk to
          the registry via the <Code>x-fg-service-token</Code> header. Server builds contain no binary
          YMTs (those are produced in the desktop build) — they serve preview and distribution.
        </DocCallout>
      </DocSection>

      <DocPager
        prev={{ href: "/docs/atelier", title: "atelier — the desktop app" }}
        ariaLabel={pagerAria}
        prevLabel={pagerPrev}
        nextLabel={pagerNext}
      />
    </article>
  );
}
