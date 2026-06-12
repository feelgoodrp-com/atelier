import { useCallback, useEffect, useState } from "react";
import {
  CircleUser,
  FolderOpen,
  Hourglass,
  Laptop,
  LogOut,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { getLogDir } from "@/lib/log";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CreditsPanel } from "@/components/settings/credits-panel";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useSidecarStore } from "@/lib/stores/sidecar-store";
import { restartSidecar } from "@/lib/sidecar/client";
import { pushGtaPathToSidecar } from "@/lib/sidecar/gta-path";
import { getGtaPath, setGtaPath, setLogConsoleEnabled } from "@/lib/settings";
import { openLogWindow, useLogConsoleStore } from "@/lib/stores/log-console-store";
import {
  adminApproveUser,
  adminListUsers,
  adminLockUser,
  listDevices,
  revokeDevice,
  type AdminUser,
  type Device,
  type UserStatus,
} from "@/lib/sync/api-client";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Allgemein
// ---------------------------------------------------------------------------

function GeneralTab() {
  const [gtaPath, setGtaPathState] = useState<string | null>(null);
  const apiUrl = useAuthStore((s) => s.apiUrl);
  const setApiUrl = useAuthStore((s) => s.setApiUrl);
  const [apiUrlDraft, setApiUrlDraft] = useState(apiUrl);
  const sidecarInfo = useSidecarStore((s) => s.info);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    getGtaPath()
      .then(setGtaPathState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setApiUrlDraft(apiUrl);
  }, [apiUrl]);

  const pickGtaPath = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        title: "GTA V Installationsordner wählen",
      });
      if (typeof selected === "string") {
        await setGtaPath(selected);
        setGtaPathState(selected);
        // Push immediately — the sidecar keeps the path in memory only.
        const ready = await pushGtaPathToSidecar(selected);
        if (ready) {
          toast.success("GTA V Pfad gespeichert", {
            description: "Ped-Vorschau ist jetzt verfügbar.",
          });
        } else {
          toast.warning("GTA V Pfad gespeichert", {
            description:
              "Der Sidecar konnte den Pfad nicht verifizieren — stimmt der Installationsordner (enthält GTA5.exe und .rpf-Archive)?",
          });
        }
      }
    } catch (e) {
      toast.error("Pfad konnte nicht gewählt werden", {
        description: errorMessage(e),
      });
    }
  }, []);

  const saveApiUrl = useCallback(async () => {
    try {
      await setApiUrl(apiUrlDraft);
      toast.success("API-URL gespeichert");
    } catch (e) {
      toast.error("API-URL konnte nicht gespeichert werden", {
        description: errorMessage(e),
      });
    }
  }, [apiUrlDraft, setApiUrl]);

  const sidecarDot =
    sidecarInfo.status === "ready"
      ? "bg-emerald-400"
      : sidecarInfo.status === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-red-500";

  return (
    <div className="flex flex-col gap-4">
      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">GTA V</CardTitle>
          <CardDescription className="text-white/50">
            Wird für Vorschau-Modelle und Pack-Export benötigt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="gta-path" className="text-white/70">
            Installationsordner
          </Label>
          <div className="flex gap-2">
            <Input
              id="gta-path"
              readOnly
              value={gtaPath ?? ""}
              placeholder="Noch kein Pfad gewählt…"
              className="border-white/15 bg-white/5 text-white"
            />
            <Button variant="outline" onClick={() => void pickGtaPath()}>
              <FolderOpen className="h-4 w-4" />
              Durchsuchen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">Backend</CardTitle>
          <CardDescription className="text-white/50">
            Adresse des atelier-Sync-Servers.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="api-url" className="text-white/70">
            API-URL
          </Label>
          <div className="flex gap-2">
            <Input
              id="api-url"
              value={apiUrlDraft}
              onChange={(e) => setApiUrlDraft(e.target.value)}
              placeholder="http://127.0.0.1:3095"
              className="border-white/15 bg-white/5 text-white"
            />
            <Button
              variant="outline"
              disabled={apiUrlDraft === apiUrl}
              onClick={() => void saveApiUrl()}
            >
              Speichern
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">Sidecar</CardTitle>
          <CardDescription className="text-white/50">
            Lokaler Hilfsprozess für YDD/YTD-Verarbeitung.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-white/70">
            <span className={cn("h-2 w-2 rounded-full", sidecarDot)} />
            <span>{sidecarInfo.detail ?? "Status unbekannt"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={restarting}
            onClick={() => {
              setRestarting(true);
              restartSidecar()
                .then(() => toast.success("Sidecar wird neu gestartet"))
                .catch((e: unknown) =>
                  toast.error("Neustart fehlgeschlagen", {
                    description: errorMessage(e),
                  }),
                )
                .finally(() => setRestarting(false));
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Neu starten
          </Button>
        </CardContent>
      </Card>

      <LogsCard />
    </div>
  );
}

/** Where the rotating tracing log files live (Rust + sidecar + webview logs). */
function LogsCard() {
  const [logDir, setLogDir] = useState<string | null>(null);
  const consoleEnabled = useLogConsoleStore((s) => s.enabled);
  const setConsoleEnabled = useLogConsoleStore((s) => s.setEnabled);

  useEffect(() => {
    void getLogDir().then(setLogDir);
  }, []);

  return (
    <Card className="glass-border-subtle border-white/10 bg-transparent">
      <CardHeader>
        <CardTitle className="text-white">Logs</CardTitle>
        <CardDescription className="text-white/50">
          Täglich rotierende Log-Dateien (App, Sidecar, Oberfläche) — hilfreich für Fehlerberichte.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={logDir ?? "Log-Verzeichnis nicht verfügbar"}
            className="border-white/15 bg-white/5 text-white"
          />
          <Button
            variant="outline"
            disabled={!logDir}
            onClick={() => {
              if (logDir) void openInBrowser(logDir).catch(() => {});
            }}
          >
            <FolderOpen className="h-4 w-4" />
            Öffnen
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-[10px] bg-white/5 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm text-white/85">Echtzeit-Log-Fenster</p>
            <p className="text-xs text-white/45">
              Eigenes Fenster mit Live-Stream aller Logs (Terminal-Button oben rechts,
              Strg+Shift+L).
            </p>
          </div>
          <Switch
            checked={consoleEnabled}
            onCheckedChange={(checked) => {
              setConsoleEnabled(checked);
              void setLogConsoleEnabled(checked).catch(() => {});
              if (checked) openLogWindow();
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Konto
// ---------------------------------------------------------------------------

function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const [devices, setDevices] = useState<Device[] | null>(null);

  const loadDevices = useCallback(() => {
    if (useAuthStore.getState().status !== "loggedIn") return;
    listDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices, status]);

  if (status !== "loggedIn" || !user) {
    return (
      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">Nicht angemeldet</CardTitle>
          <CardDescription className="text-white/50">
            Melde dich mit Discord an, um Projekte zu synchronisieren.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            disabled={status === "loggingIn"}
            onClick={() => {
              login().catch((e: unknown) =>
                toast.error("Anmeldung fehlgeschlagen", {
                  description: errorMessage(e),
                }),
              );
            }}
          >
            {status === "loggingIn" ? "Anmeldung läuft…" : "Mit Discord anmelden"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const name = user.username;

  return (
    <div className="flex flex-col gap-4">
      {user.status === "pending" && (
        <div className="flex items-center gap-3 rounded-[10px] border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <Hourglass className="h-4 w-4 shrink-0 text-amber-300" />
          <div className="text-sm text-amber-200">
            <span className="font-medium">Warte auf Freigabe.</span>{" "}
            Ein Admin muss dein Konto freischalten, bevor du synchronisieren kannst.
          </div>
        </div>
      )}

      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">Konto</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={name}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <CircleUser className="h-12 w-12 text-white/40" />
          )}
          <div className="flex-1">
            <p className="font-medium text-white">{name}</p>
            <p className="text-xs text-white/45">Discord-ID: {user.discordId}</p>
            <div className="mt-1.5 flex gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  "border-white/15 text-white/60",
                  user.role === "admin" && "border-[#5865F2]/50 text-[#7289DA]",
                )}
              >
                {user.role === "admin" ? "Admin" : "Mitglied"}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "border-white/15 text-white/60",
                  user.status === "approved" && "border-emerald-500/40 text-emerald-300",
                  user.status === "pending" && "border-amber-500/40 text-amber-300",
                  user.status === "locked" && "border-red-500/40 text-red-300",
                )}
              >
                {user.status === "approved"
                  ? "Freigegeben"
                  : user.status === "pending"
                    ? "Ausstehend"
                    : "Gesperrt"}
              </Badge>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void logout().then(() => toast.success("Abgemeldet"));
            }}
          >
            <LogOut className="h-4 w-4" />
            Abmelden
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">Geräte</CardTitle>
          <CardDescription className="text-white/50">
            Angemeldete Geräte deines Kontos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devices === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full bg-white/5" />
              <Skeleton className="h-10 w-full bg-white/5" />
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-white/40">Keine Geräte gefunden.</p>
          ) : (
            <div className="flex flex-col">
              {devices.map((device, i) => (
                <div key={device.deviceId}>
                  {i > 0 && <Separator className="bg-white/8" />}
                  <div className="flex items-center gap-3 py-2.5">
                    <Laptop className="h-4 w-4 text-white/40" />
                    <div className="flex-1">
                      <p className="text-sm text-white/85">
                        {device.name}
                        {device.current && (
                          <span className="ml-2 text-xs text-[#7289DA]">
                            Dieses Gerät
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-white/40">
                        {device.platform}
                        {device.appVersion && device.appVersion !== "0.0.0"
                          ? ` · v${device.appVersion}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white/40 hover:text-red-400"
                      onClick={() => {
                        revokeDevice(device.deviceId)
                          .then(() => {
                            toast.success("Gerät abgemeldet");
                            loadDevices();
                          })
                          .catch((e: unknown) =>
                            toast.error("Fehler", { description: errorMessage(e) }),
                          );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

type StatusFilter = UserStatus | "all";

function AdminTab() {
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    setUsers(null);
    adminListUsers(filter === "all" ? undefined : filter)
      .then(setUsers)
      .catch((e: unknown) => {
        setUsers([]);
        toast.error("Nutzer konnten nicht geladen werden", {
          description: errorMessage(e),
        });
      });
  }, [filter]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const act = (discordId: string, action: "approve" | "lock") => {
    setBusyId(discordId);
    const call = action === "approve" ? adminApproveUser : adminLockUser;
    call(discordId)
      .then(() => {
        toast.success(action === "approve" ? "Nutzer freigegeben" : "Nutzer gesperrt");
        loadUsers();
      })
      .catch((e: unknown) =>
        toast.error("Aktion fehlgeschlagen", { description: errorMessage(e) }),
      )
      .finally(() => setBusyId(null));
  };

  return (
    <Card className="glass-border-subtle border-white/10 bg-transparent">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-white">Nutzerverwaltung</CardTitle>
          <CardDescription className="text-white/50">
            Freigaben und Sperren für atelier-Konten.
          </CardDescription>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <SelectTrigger className="w-44 border-white/15 bg-white/5 text-white">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="pending">Ausstehend</SelectItem>
            <SelectItem value="approved">Freigegeben</SelectItem>
            <SelectItem value="locked">Gesperrt</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {users === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full bg-white/5" />
            <Skeleton className="h-10 w-full bg-white/5" />
            <Skeleton className="h-10 w-full bg-white/5" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/40">
            Keine Nutzer für diesen Filter.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead className="text-white/50">Nutzer</TableHead>
                <TableHead className="text-white/50">Rolle</TableHead>
                <TableHead className="text-white/50">Status</TableHead>
                <TableHead className="text-right text-white/50">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.discordId} className="border-white/8 hover:bg-white/5">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {u.avatar ? (
                        <img
                          src={u.avatar}
                          alt=""
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <CircleUser className="h-6 w-6 text-white/40" />
                      )}
                      <span className="text-white/85">{u.username}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-white/60">
                    {u.role === "admin" ? "Admin" : "Mitglied"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-white/15 text-white/60",
                        u.status === "approved" &&
                          "border-emerald-500/40 text-emerald-300",
                        u.status === "pending" && "border-amber-500/40 text-amber-300",
                        u.status === "locked" && "border-red-500/40 text-red-300",
                      )}
                    >
                      {u.status === "approved"
                        ? "Freigegeben"
                        : u.status === "pending"
                          ? "Ausstehend"
                          : "Gesperrt"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {u.status !== "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === u.discordId}
                          className="h-7 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                          onClick={() => act(u.discordId, "approve")}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Freigeben
                        </Button>
                      )}
                      {u.status !== "locked" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === u.discordId}
                          className="h-7 border-red-500/30 text-red-300 hover:bg-red-500/10"
                          onClick={() => act(u.discordId, "lock")}
                        >
                          <ShieldX className="h-3.5 w-3.5" />
                          Sperren
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  return (
    <div className="screen-fade-in h-full overflow-y-auto px-10 py-10">
      {/* Narrower content column + a credits/thanks sidebar on the right. */}
      <div className="mx-auto flex w-full max-w-5xl gap-8">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Einstellungen
          </h1>
          <Tabs defaultValue="general" className="mt-6">
            <TabsList className="liquid-glass bg-transparent">
              <TabsTrigger value="general">Allgemein</TabsTrigger>
              <TabsTrigger value="account">Konto</TabsTrigger>
              {isAdmin && <TabsTrigger value="admin">Admin</TabsTrigger>}
            </TabsList>
            <TabsContent value="general" className="mt-4">
              <GeneralTab />
            </TabsContent>
            <TabsContent value="account" className="mt-4">
              <AccountTab />
            </TabsContent>
            {isAdmin && (
              <TabsContent value="admin" className="mt-4">
                <AdminTab />
              </TabsContent>
            )}
          </Tabs>
        </div>
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-0">
            <CreditsPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
