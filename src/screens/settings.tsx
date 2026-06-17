import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import i18n, { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { changeLanguage } from "@/lib/i18n/language";
import { useAuthStore, useCloudEnabled } from "@/lib/stores/auth-store";
import { useUiStore } from "@/lib/stores/ui-store";
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

/** UI language selector. Switches the app language and persists the choice. */
function LanguageCard() {
  const { t } = useTranslation("settings");
  // Re-render on language switch so the highlighted button stays in sync.
  const [current, setCurrent] = useState(i18n.language);

  return (
    <Card className="glass-border-subtle border-white/10 bg-transparent">
      <CardHeader>
        <CardTitle className="text-white">{t("general.language.title")}</CardTitle>
        <CardDescription className="text-white/50">
          {t("general.language.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = current === lang.code;
            return (
              <Button
                key={lang.code}
                variant="outline"
                size="sm"
                aria-pressed={active}
                className={cn(
                  active &&
                    "border-[#5865F2] bg-[#5865F2]/15 text-white hover:bg-[#5865F2]/20",
                )}
                onClick={() => {
                  void changeLanguage(lang.code).then(() => setCurrent(lang.code));
                }}
              >
                {lang.label}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function GeneralTab() {
  const { t } = useTranslation("settings");
  const cloudEnabled = useCloudEnabled();
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
        title: t("general.gta.pickerTitle"),
      });
      if (typeof selected === "string") {
        await setGtaPath(selected);
        setGtaPathState(selected);
        // Push immediately — the sidecar keeps the path in memory only.
        const ready = await pushGtaPathToSidecar(selected);
        if (ready) {
          toast.success(t("general.gta.pathSaved"), {
            description: t("general.gta.pathSavedReady"),
          });
        } else {
          toast.warning(t("general.gta.pathSaved"), {
            description: t("general.gta.pathSavedUnverified"),
          });
        }
      }
    } catch (e) {
      toast.error(t("general.gta.pickFailed"), {
        description: errorMessage(e),
      });
    }
  }, [t]);

  const saveApiUrl = useCallback(async () => {
    try {
      await setApiUrl(apiUrlDraft);
      toast.success(t("general.backend.apiUrlSaved"));
    } catch (e) {
      toast.error(t("general.backend.apiUrlSaveFailed"), {
        description: errorMessage(e),
      });
    }
  }, [apiUrlDraft, setApiUrl, t]);

  const sidecarDot =
    sidecarInfo.status === "ready"
      ? "bg-emerald-400"
      : sidecarInfo.status === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-red-500";

  return (
    <div className="flex flex-col gap-4">
      <LanguageCard />

      <ModeCard />

      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">{t("general.gta.title")}</CardTitle>
          <CardDescription className="text-white/50">
            {t("general.gta.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="gta-path" className="text-white/70">
            {t("general.gta.installFolder")}
          </Label>
          <div className="flex gap-2">
            <Input
              id="gta-path"
              readOnly
              value={gtaPath ?? ""}
              placeholder={t("general.gta.noPathYet")}
              className="border-white/15 bg-white/5 text-white"
            />
            <Button variant="outline" onClick={() => void pickGtaPath()}>
              <FolderOpen className="h-4 w-4" />
              {t("general.gta.browse")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {cloudEnabled && (
        <Card className="glass-border-subtle border-white/10 bg-transparent">
          <CardHeader>
            <CardTitle className="text-white">{t("general.backend.title")}</CardTitle>
            <CardDescription className="text-white/50">
              {t("general.backend.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="api-url" className="text-white/70">
              {t("general.backend.apiUrlLabel")}
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
                {t("common:save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">{t("general.sidecar.title")}</CardTitle>
          <CardDescription className="text-white/50">
            {t("general.sidecar.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-white/70">
            <span className={cn("h-2 w-2 rounded-full", sidecarDot)} />
            <span>{sidecarInfo.detail ?? t("general.sidecar.statusUnknown")}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={restarting}
            onClick={() => {
              setRestarting(true);
              restartSidecar()
                .then(() => toast.success(t("general.sidecar.restarting")))
                .catch((e: unknown) =>
                  toast.error(t("general.sidecar.restartFailed"), {
                    description: errorMessage(e),
                  }),
                )
                .finally(() => setRestarting(false));
            }}
          >
            <RotateCcw className="h-4 w-4" />
            {t("general.sidecar.restart")}
          </Button>
        </CardContent>
      </Card>

      <LogsCard />
      <SetupCard />
    </div>
  );
}

/** Choose between offline solo mode and the team cloud. */
function ModeCard() {
  const { t } = useTranslation("settings");
  const cloudEnabled = useCloudEnabled();
  const setAppMode = useAuthStore((s) => s.setAppMode);

  return (
    <Card className="glass-border-subtle border-white/10 bg-transparent">
      <CardHeader>
        <CardTitle className="text-white">{t("general.mode.title")}</CardTitle>
        <CardDescription className="text-white/50">
          {cloudEnabled
            ? t("general.mode.descriptionCloud")
            : t("general.mode.descriptionSolo")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <Badge
          variant="outline"
          className={cn(
            "border-white/15 text-white/60",
            cloudEnabled && "border-[#5865F2]/50 text-[#7289DA]",
          )}
        >
          {cloudEnabled ? t("general.mode.cloud") : t("general.mode.solo")}
        </Badge>
        {cloudEnabled ? (
          <Button variant="outline" onClick={() => void setAppMode("solo")}>
            {t("general.mode.switchToSolo")}
          </Button>
        ) : (
          <Button onClick={() => void setAppMode("cloud")}>
            {t("general.mode.switchToCloud")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Re-run the first-run setup wizard (server address, GTA path, logs). */
function SetupCard() {
  const { t } = useTranslation("settings");
  const setRerunOnboarding = useUiStore((s) => s.setRerunOnboarding);
  return (
    <Card className="glass-border-subtle border-white/10 bg-transparent">
      <CardHeader>
        <CardTitle className="text-white">{t("general.setup.title")}</CardTitle>
        <CardDescription className="text-white/50">
          {t("general.setup.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => setRerunOnboarding(true)}>
          <RotateCcw className="h-4 w-4" />
          {t("general.setup.rerun")}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Where the rotating tracing log files live (Rust + sidecar + webview logs). */
function LogsCard() {
  const { t } = useTranslation("settings");
  const [logDir, setLogDir] = useState<string | null>(null);
  const consoleEnabled = useLogConsoleStore((s) => s.enabled);
  const setConsoleEnabled = useLogConsoleStore((s) => s.setEnabled);

  useEffect(() => {
    void getLogDir().then(setLogDir);
  }, []);

  return (
    <Card className="glass-border-subtle border-white/10 bg-transparent">
      <CardHeader>
        <CardTitle className="text-white">{t("general.logs.title")}</CardTitle>
        <CardDescription className="text-white/50">
          {t("general.logs.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={logDir ?? t("general.logs.dirUnavailable")}
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
            {t("common:open")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-[10px] bg-white/5 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm text-white/85">{t("general.logs.consoleTitle")}</p>
            <p className="text-xs text-white/45">
              {t("general.logs.consoleDescription")}
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
  const { t } = useTranslation("settings");
  const cloudEnabled = useCloudEnabled();
  const setAppMode = useAuthStore((s) => s.setAppMode);
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const [devices, setDevices] = useState<Device[] | null>(null);

  const loadDevices = useCallback(() => {
    if (useAuthStore.getState().appMode !== "cloud") return;
    if (useAuthStore.getState().status !== "loggedIn") return;
    listDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    if (!cloudEnabled) return;
    loadDevices();
  }, [cloudEnabled, loadDevices, status]);

  if (!cloudEnabled) {
    return (
      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">{t("account.soloTitle")}</CardTitle>
          <CardDescription className="text-white/50">
            {t("account.soloDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void setAppMode("cloud")}>
            {t("account.soloEnableCloud")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status !== "loggedIn" || !user) {
    return (
      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">{t("account.notSignedIn")}</CardTitle>
          <CardDescription className="text-white/50">
            {t("account.notSignedInDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            disabled={status === "loggingIn"}
            onClick={() => {
              login().catch((e: unknown) =>
                toast.error(t("account.signInFailed"), {
                  description: errorMessage(e),
                }),
              );
            }}
          >
            {status === "loggingIn"
              ? t("account.signingIn")
              : t("account.signInWithDiscord")}
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
            <span className="font-medium">{t("account.pendingTitle")}</span>{" "}
            {t("account.pendingBody")}
          </div>
        </div>
      )}

      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">{t("account.title")}</CardTitle>
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
            <p className="text-xs text-white/45">
              {t("account.discordId", { id: user.discordId })}
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  "border-white/15 text-white/60",
                  user.role === "admin" && "border-[#5865F2]/50 text-[#7289DA]",
                )}
              >
                {user.role === "admin"
                  ? t("account.roleAdmin")
                  : t("account.roleMember")}
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
                  ? t("account.statusApproved")
                  : user.status === "pending"
                    ? t("account.statusPending")
                    : t("account.statusLocked")}
              </Badge>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void logout().then(() => toast.success(t("account.loggedOut")));
            }}
          >
            <LogOut className="h-4 w-4" />
            {t("account.logout")}
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-border-subtle border-white/10 bg-transparent">
        <CardHeader>
          <CardTitle className="text-white">{t("account.devices.title")}</CardTitle>
          <CardDescription className="text-white/50">
            {t("account.devices.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devices === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full bg-white/5" />
              <Skeleton className="h-10 w-full bg-white/5" />
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-white/40">{t("account.devices.empty")}</p>
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
                            {t("account.devices.thisDevice")}
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
                            toast.success(t("account.devices.revoked"));
                            loadDevices();
                          })
                          .catch((e: unknown) =>
                            toast.error(t("account.devices.revokeFailed"), {
                              description: errorMessage(e),
                            }),
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
  const { t } = useTranslation("settings");
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    setUsers(null);
    adminListUsers(filter === "all" ? undefined : filter)
      .then(setUsers)
      .catch((e: unknown) => {
        setUsers([]);
        toast.error(t("admin.loadFailed"), {
          description: errorMessage(e),
        });
      });
  }, [filter, t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const act = (discordId: string, action: "approve" | "lock") => {
    setBusyId(discordId);
    const call = action === "approve" ? adminApproveUser : adminLockUser;
    call(discordId)
      .then(() => {
        toast.success(
          action === "approve" ? t("admin.userApproved") : t("admin.userLocked"),
        );
        loadUsers();
      })
      .catch((e: unknown) =>
        toast.error(t("admin.actionFailed"), { description: errorMessage(e) }),
      )
      .finally(() => setBusyId(null));
  };

  return (
    <Card className="glass-border-subtle border-white/10 bg-transparent">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-white">{t("admin.title")}</CardTitle>
          <CardDescription className="text-white/50">
            {t("admin.description")}
          </CardDescription>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <SelectTrigger className="w-44 border-white/15 bg-white/5 text-white">
            <SelectValue placeholder={t("admin.statusPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.filter.all")}</SelectItem>
            <SelectItem value="pending">{t("admin.filter.pending")}</SelectItem>
            <SelectItem value="approved">{t("admin.filter.approved")}</SelectItem>
            <SelectItem value="locked">{t("admin.filter.locked")}</SelectItem>
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
            {t("admin.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead className="text-white/50">{t("admin.columns.user")}</TableHead>
                <TableHead className="text-white/50">{t("admin.columns.role")}</TableHead>
                <TableHead className="text-white/50">{t("admin.columns.status")}</TableHead>
                <TableHead className="text-right text-white/50">
                  {t("admin.columns.actions")}
                </TableHead>
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
                    {u.role === "admin" ? t("admin.roleAdmin") : t("admin.roleMember")}
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
                        ? t("admin.statusApproved")
                        : u.status === "pending"
                          ? t("admin.statusPending")
                          : t("admin.statusLocked")}
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
                          {t("admin.approve")}
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
                          {t("admin.lock")}
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
  const { t } = useTranslation("settings");
  const cloudEnabled = useCloudEnabled();
  const user = useAuthStore((s) => s.user);
  const isAdmin = cloudEnabled && user?.role === "admin";

  return (
    <div className="screen-fade-in h-full overflow-y-auto px-10 py-10">
      {/* Narrower content column + a credits/thanks sidebar on the right. */}
      <div className="mx-auto flex w-full max-w-5xl gap-8">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {t("title")}
          </h1>
          <Tabs defaultValue="general" className="mt-6">
            <TabsList className="liquid-glass bg-transparent">
              <TabsTrigger value="general">{t("tabs.general")}</TabsTrigger>
              <TabsTrigger value="account">{t("tabs.account")}</TabsTrigger>
              {isAdmin && <TabsTrigger value="admin">{t("tabs.admin")}</TabsTrigger>}
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
