import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useUpdateStore } from "@/lib/stores/update-store";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Settings → General: show the current version and check / install updates. */
export function UpdatesCard() {
  const { t } = useTranslation("settings");
  const phase = useUpdateStore((s) => s.phase);
  const available = useUpdateStore((s) => s.available);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const contentLength = useUpdateStore((s) => s.contentLength);
  const error = useUpdateStore((s) => s.error);
  const check = useUpdateStore((s) => s.check);
  const install = useUpdateStore((s) => s.install);

  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  const busy = phase === "checking" || phase === "downloading" || phase === "ready";
  const pct =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null;

  return (
    <Card className="glass-border-subtle border-white/10 bg-transparent">
      <CardHeader>
        <CardTitle className="text-white">{t("updates.title")}</CardTitle>
        <CardDescription className="text-white/50">
          {t("updates.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 text-sm">
            <p className="text-white/70">
              {t("updates.currentVersion")}{" "}
              <span className="font-medium text-white">
                v{version ?? "—"}
              </span>
            </p>
            {phase === "upToDate" && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("updates.upToDate")}
              </p>
            )}
            {phase === "error" && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-red-300">
                <AlertCircle className="h-3.5 w-3.5" />
                {error ?? t("updates.checkFailed")}
              </p>
            )}
          </div>

          {phase !== "available" && phase !== "downloading" && phase !== "ready" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void check()}
            >
              <RefreshCw
                className={phase === "checking" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              />
              {phase === "checking" ? t("updates.checking") : t("updates.check")}
            </Button>
          )}
        </div>

        {phase === "available" && available && (
          <div className="flex flex-col gap-3 rounded-[10px] border border-[#5865F2]/30 bg-[#5865F2]/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-white">
              <Sparkles className="h-4 w-4 text-[#7289DA]" />
              <span className="font-medium">
                {t("updates.available", { version: available.version })}
              </span>
            </div>
            {available.notes && (
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs text-white/60">
                {available.notes}
              </pre>
            )}
            <Button className="self-start" onClick={() => void install()}>
              <Download className="h-4 w-4" />
              {t("updates.install")}
            </Button>
          </div>
        )}

        {(phase === "downloading" || phase === "ready") && (
          <div className="flex flex-col gap-2">
            <Progress value={pct ?? undefined} className="h-2" />
            <p className="text-xs text-white/50">
              {phase === "ready"
                ? t("updates.restarting")
                : pct !== null
                  ? t("updates.downloading", {
                      pct,
                      downloaded: formatBytes(downloaded),
                      total: formatBytes(contentLength ?? 0),
                    })
                  : t("updates.preparing")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
