/**
 * Dockable 3D preview panel (bottom of the workbench center column).
 *
 * Renders every selected drawable with a YDD mesh (outfit preview, cap 8) via
 * the sidecar's /preview/glb endpoint. The header hosts camera presets,
 * Fokus/autorotate and the ped-body switch; overlay chips show poly/vertex
 * totals, LOD/texture warnings and per-drawable fetch errors.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Focus,
  Loader2,
  Orbit,
  PersonStanding,
  Rotate3d,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { joinPath } from "@/lib/project/io";
import {
  fetchPreviewPoses,
  fetchSidecarServerInfo,
  restartSidecar,
} from "@/lib/sidecar/client";
import type { PreviewAnyRequest } from "@/lib/stores/preview-3d-store";
import {
  CAMERA_PRESETS,
  PREVIEW_MAX_MODELS,
  clampTextureIndex,
  glbCacheKey,
  outfitCacheKey,
  pedModelFor,
  selectPreviewedDrawables,
  usePreview3dStore,
  type CameraPreset,
} from "@/lib/stores/preview-3d-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useSidecarStore } from "@/lib/stores/sidecar-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import type { ProjectDrawable } from "@/lib/project/schema";
import { Viewer3D, type ViewerModel } from "./viewer-3d";

const NUMBER_FORMAT = new Intl.NumberFormat("de-DE");

interface PreviewRequest {
  drawable: ProjectDrawable;
  key: string;
  request: PreviewAnyRequest;
}

function OverlayChip({
  tone = "info",
  title,
  onClick,
  children,
}: {
  tone?: "info" | "warn" | "error";
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
      : tone === "error"
        ? "border-red-500/30 bg-red-500/15 text-red-200"
        : "border-white/10 bg-black/55 text-white/70";
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      title={title}
      className={cn(
        "pointer-events-auto inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 font-mono text-[10px] backdrop-blur",
        toneClass,
        onClick && "cursor-pointer transition-colors hover:bg-red-500/25",
      )}
    >
      {children}
    </Tag>
  );
}

function SidecarUnavailableHint() {
  const [restarting, setRestarting] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="rounded-[10px] border border-red-500/25 bg-red-500/10 px-5 py-4">
        <p className="text-sm font-medium text-red-300">
          Sidecar nicht verbunden
        </p>
        <p className="mt-1 max-w-72 text-xs text-red-200/70">
          Die 3D-Vorschau benötigt den lokalen Sidecar-Prozess. Starte ihn neu
          oder prüfe Einstellungen → Sidecar.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={restarting}
          className="mt-3 h-7 border-red-500/30 text-xs text-red-200 hover:bg-red-500/10"
          onClick={() => {
            setRestarting(true);
            restartSidecar()
              .then(() => toast.success("Sidecar wird neu gestartet"))
              .catch((e: unknown) =>
                toast.error("Neustart fehlgeschlagen", {
                  description: e instanceof Error ? e.message : String(e),
                }),
              )
              .finally(() => setRestarting(false));
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Sidecar neu starten
        </Button>
      </div>
    </div>
  );
}

function EmptySelectionHint({ withoutYdd }: { withoutYdd: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="glass-border-subtle flex h-12 w-12 items-center justify-center rounded-[10px]">
        <Rotate3d className="h-5 w-5 text-white/30" />
      </div>
      <p className="mt-3 text-sm font-medium text-white/60">
        {withoutYdd > 0 ? "Kein YDD-Mesh in der Auswahl" : "Nichts ausgewählt"}
      </p>
      <p className="mt-1 max-w-64 text-xs text-white/35">
        {withoutYdd > 0
          ? "Die ausgewählten Drawables haben kein YDD-Mesh — weise zuerst eines zu."
          : "Wähle Drawables in der Liste aus, um sie hier in 3D zu sehen (Mehrfachauswahl = Outfit)."}
      </p>
    </div>
  );
}

export function PreviewPane() {
  const project = useProjectStore((s) => s.project);
  const projectDir = useProjectStore((s) => s.projectDir);
  const selection = useProjectStore((s) => s.selection);
  const sidecarInfo = useSidecarStore((s) => s.info);
  const setPreviewOpen = useWorkbenchStore((s) => s.setPreviewOpen);

  const entries = usePreview3dStore((s) => s.entries);
  const yddMeta = usePreview3dStore((s) => s.yddMeta);
  const textureIndexByDrawable = usePreview3dStore(
    (s) => s.textureIndexByDrawable,
  );
  const cameraPreset = usePreview3dStore((s) => s.cameraPreset);
  const autoRotate = usePreview3dStore((s) => s.autoRotate);
  const includePedBody = usePreview3dStore((s) => s.includePedBody);
  const gtaPathReady = usePreview3dStore((s) => s.gtaPathReady);
  const pose = usePreview3dStore((s) => s.pose);
  const poses = usePreview3dStore((s) => s.poses);
  const posesLoaded = usePreview3dStore((s) => s.posesLoaded);
  const frameNonce = usePreview3dStore((s) => s.frameNonce);
  const ensureGlb = usePreview3dStore((s) => s.ensureGlb);
  const retryGlb = usePreview3dStore((s) => s.retryGlb);
  const ensureYddMeta = usePreview3dStore((s) => s.ensureYddMeta);
  const setCameraPreset = usePreview3dStore((s) => s.setCameraPreset);
  const setAutoRotate = usePreview3dStore((s) => s.setAutoRotate);
  const setIncludePedBody = usePreview3dStore((s) => s.setIncludePedBody);
  const setGtaPathReady = usePreview3dStore((s) => s.setGtaPathReady);
  const setPose = usePreview3dStore((s) => s.setPose);
  const setPoses = usePreview3dStore((s) => s.setPoses);
  const requestFrame = usePreview3dStore((s) => s.requestFrame);

  const sidecarReady = sidecarInfo.status === "ready";

  // GET /info — drives the ped-body switch availability.
  useEffect(() => {
    if (!sidecarReady) {
      setGtaPathReady(null);
      return;
    }
    let disposed = false;
    fetchSidecarServerInfo()
      .then((info) => {
        if (!disposed) setGtaPathReady(info.gtaPathReady);
      })
      .catch(() => {
        if (!disposed) setGtaPathReady(false);
      });
    return () => {
      disposed = true;
    };
  }, [sidecarReady, setGtaPathReady]);

  // GET /preview/poses — fetched once per session when the sidecar is ready;
  // until then (or on failure) the hardcoded contract mirror stays in place.
  useEffect(() => {
    if (!sidecarReady || posesLoaded) return;
    let disposed = false;
    fetchPreviewPoses()
      .then((live) => {
        if (!disposed) setPoses(live);
      })
      .catch(() => {
        /* keep the POSES_FALLBACK list */
      });
    return () => {
      disposed = true;
    };
  }, [sidecarReady, posesLoaded, setPoses]);

  const { rendered, overCap, withoutYdd } = useMemo(
    () => selectPreviewedDrawables(project, selection),
    [project, selection],
  );

  // Cap hint — toast once when the selection first exceeds the limit.
  const lastOverCap = useRef(0);
  useEffect(() => {
    if (overCap > 0 && lastOverCap.current === 0) {
      toast.info(`Vorschau zeigt maximal ${PREVIEW_MAX_MODELS} Drawables`, {
        description: `${overCap} weitere ausgewählte Drawables werden nicht gerendert.`,
      });
    }
    lastOverCap.current = overCap;
  }, [overCap]);

  const pedBodyActive = includePedBody && gtaPathReady === true;
  // Poses are baked from game clips — only effective with a ready gtaPath
  // (the toolbar select is disabled otherwise, this guards stale state).
  const poseActive = gtaPathReady === true ? pose : null;

  /**
   * Request descriptors. Without ped body: one GLB per rendered drawable
   * (composed in the viewer). WITH ped body: ONE outfit GLB — the garments
   * replace the ped's default components in their slots, instead of every
   * drawable bringing its own full ped (stacked bodies + default clothes).
   * The active pose applies to BOTH modes.
   */
  const requests = useMemo<PreviewRequest[]>(() => {
    if (!projectDir) return [];

    if (pedBodyActive && rendered.length > 0) {
      const pedModel = pedModelFor(rendered[0]);
      const parts: Array<{ yddHash: string; textureHash: string | null }> = [];
      const items = rendered.flatMap((drawable) => {
        const ydd = drawable.ydd;
        if (!ydd) return [];
        const textureIndex = clampTextureIndex(
          drawable,
          textureIndexByDrawable[drawable.id],
        );
        parts.push({
          yddHash: ydd.hash,
          textureHash: drawable.textures[textureIndex]?.hash ?? null,
        });
        return [
          {
            yddPath: joinPath(projectDir, ydd.path),
            ytdPaths: drawable.textures.map((t) => joinPath(projectDir, t.path)),
            textureIndex,
            slot: drawable.type,
          },
        ];
      });
      if (items.length === 0) return [];
      return [
        {
          drawable: rendered[0],
          key: outfitCacheKey(parts, pedModel, poseActive),
          request: { items, pedModel, includePedBody: true, pose: poseActive },
        },
      ];
    }

    return rendered.flatMap((drawable) => {
      const ydd = drawable.ydd;
      if (!ydd) return [];
      const textureIndex = clampTextureIndex(
        drawable,
        textureIndexByDrawable[drawable.id],
      );
      const textureHash = drawable.textures[textureIndex]?.hash ?? null;
      // A pose bakes against a GENDER-specific skeleton + clip — without the
      // pedModel a female garment would silently get the male skeleton.
      const poseSkeleton = poseActive ? pedModelFor(drawable) : null;
      return [
        {
          drawable,
          key: glbCacheKey(ydd.hash, textureHash, null, poseActive, poseSkeleton),
          request: {
            yddPath: joinPath(projectDir, ydd.path),
            ytdPaths: drawable.textures.map((t) => joinPath(projectDir, t.path)),
            textureIndex,
            includePedBody: false,
            pose: poseActive,
            ...(poseSkeleton ? { pedModel: poseSkeleton } : {}),
          },
        },
      ];
    });
  }, [projectDir, rendered, textureIndexByDrawable, pedBodyActive, poseActive]);

  // Fetch GLBs + /parse/ydd metadata (LOD chips) for the rendered set.
  // `entries` is a dependency on purpose: ensureGlb early-returns for cached
  // keys (and keeps them warm in the LRU), and re-fetches a rendered key that
  // an eviction removed while it was still on screen.
  useEffect(() => {
    if (!sidecarReady || !projectDir) return;
    for (const { key, request } of requests) ensureGlb(key, request);
    for (const drawable of rendered) {
      if (drawable.ydd) {
        ensureYddMeta(drawable.ydd.hash, joinPath(projectDir, drawable.ydd.path));
      }
    }
  }, [
    sidecarReady,
    projectDir,
    requests,
    rendered,
    entries,
    ensureGlb,
    ensureYddMeta,
  ]);

  const models = useMemo<ViewerModel[]>(
    () =>
      requests.flatMap(({ drawable, key }) => {
        const entry = entries[key];
        return entry?.status === "ready" && entry.url
          ? [{ id: drawable.id, url: entry.url }]
          : [];
      }),
    [requests, entries],
  );

  const loadingCount = requests.filter(
    (r) => entries[r.key]?.status === "loading",
  ).length;

  // GLB parse failures inside the viewer, keyed by blob URL — a re-request
  // creates a fresh URL, so stale errors stop matching automatically.
  const [parseErrors, setParseErrors] = useState<Record<string, string>>({});
  const handleModelError = useCallback((url: string, message: string) => {
    setParseErrors((prev) =>
      prev[url] === message ? prev : { ...prev, [url]: message },
    );
  }, []);

  const errorChips = useMemo(() => {
    const chips: {
      id: string;
      label: string;
      message: string;
      retry: (() => void) | null;
    }[] = [];
    for (const { drawable, key, request } of requests) {
      const entry = entries[key];
      if (entry?.status === "error") {
        chips.push({
          id: drawable.id,
          label: drawable.label || "(ohne Namen)",
          message: entry.error ?? "Unbekannter Fehler",
          retry: () => retryGlb(key, request),
        });
        continue;
      }
      const parseError = entry?.url ? parseErrors[entry.url] : undefined;
      if (parseError) {
        chips.push({
          id: drawable.id,
          label: drawable.label || "(ohne Namen)",
          message: parseError,
          retry: () => retryGlb(key, request),
        });
      }
    }
    return chips;
  }, [requests, entries, parseErrors, retryGlb]);

  /** Poly/vertex totals — GLB headers first, /parse/ydd stats as fallback. */
  const stats = useMemo(() => {
    let verts = 0;
    let polys = 0;
    let known = false;
    for (const { drawable, key } of requests) {
      const entry = entries[key];
      if (
        entry?.status === "ready" &&
        entry.vertexCount !== null &&
        entry.polyCount !== null
      ) {
        verts += entry.vertexCount;
        polys += entry.polyCount;
        known = true;
        continue;
      }
      const meta = drawable.ydd ? yddMeta[drawable.ydd.hash] : undefined;
      if (meta?.status === "ready") {
        for (const info of meta.drawables) {
          verts += info.vertexCount;
          polys += info.polyCount;
        }
        known = true;
      }
    }
    return known ? { verts, polys } : null;
  }, [requests, entries, yddMeta]);

  const lodWarnings = useMemo(() => {
    const warnings: { label: string; missing: string[] }[] = [];
    for (const drawable of rendered) {
      const meta = drawable.ydd ? yddMeta[drawable.ydd.hash] : undefined;
      if (meta?.status !== "ready") continue;
      const missing: string[] = [];
      if (meta.drawables.some((info) => !info.lods.med)) missing.push("Med");
      if (meta.drawables.some((info) => !info.lods.low)) missing.push("Low");
      if (missing.length > 0) {
        warnings.push({ label: drawable.label || "(ohne Namen)", missing });
      }
    }
    return warnings;
  }, [rendered, yddMeta]);

  const untextured = useMemo(
    () => rendered.filter((d) => d.textures.length === 0),
    [rendered],
  );

  const iconButton =
    "h-7 w-7 rounded-[8px] text-white/55 hover:bg-white/10 hover:text-white";

  return (
    <div className="flex h-full flex-col">
      {/* Header: title + viewport controls */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/8 px-3">
        <Rotate3d className="h-3.5 w-3.5 shrink-0 text-white/40" />
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
          3D-Vorschau
        </span>
        {rendered.length > 0 && (
          <span className="font-mono text-[10px] text-white/30">
            {rendered.length}/{PREVIEW_MAX_MODELS}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Select
            value={cameraPreset}
            onValueChange={(v) => setCameraPreset(v as CameraPreset)}
          >
            <SelectTrigger className="h-7 w-28 border-white/15 bg-white/5 text-xs text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAMERA_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              {/* span wrapper: Radix tooltips need an enabled event target,
                  the SelectTrigger is disabled without a GTA path. */}
              <span>
                <Select
                  value={pose ?? "none"}
                  disabled={gtaPathReady !== true}
                  onValueChange={(v) => setPose(v === "none" ? null : v)}
                >
                  <SelectTrigger
                    aria-label="Pose"
                    className="h-7 w-44 border-white/15 bg-white/5 text-xs text-white"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <PersonStanding className="h-3.5 w-3.5 shrink-0 text-white/45" />
                      <span className="truncate">
                        <SelectValue />
                      </span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Bind-Pose</SelectItem>
                    {poses.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {gtaPathReady === true
                ? "Pose der Vorschau (statisch ins Mesh gebacken)"
                : "GTA-Pfad in den Einstellungen setzen"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={iconButton}
                onClick={requestFrame}
                aria-label="Kamera zentrieren"
              >
                <Focus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Kamera auf Auswahl zentrieren
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  iconButton,
                  autoRotate && "bg-white/10 text-[#7289DA]",
                )}
                onClick={() => setAutoRotate(!autoRotate)}
                aria-label="Autorotation"
              >
                <Orbit className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Autorotation {autoRotate ? "aus" : "an"}
            </TooltipContent>
          </Tooltip>

          <div className="mx-1 h-5 w-px bg-white/10" />

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1.5">
                <Switch
                  checked={includePedBody}
                  disabled={gtaPathReady !== true}
                  onCheckedChange={setIncludePedBody}
                  aria-label="Ped-Body anzeigen"
                />
                <span
                  className={cn(
                    "text-xs",
                    gtaPathReady === true ? "text-white/55" : "text-white/30",
                  )}
                >
                  Ped-Body
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {gtaPathReady === true
                ? "Freemode-Körper unter der Kleidung anzeigen"
                : "GTA-Pfad in den Einstellungen setzen"}
            </TooltipContent>
          </Tooltip>

          <div className="mx-1 h-5 w-px bg-white/10" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={iconButton}
                onClick={() => setPreviewOpen(false)}
                aria-label="Vorschau einklappen"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Vorschau einklappen</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Viewport */}
      <div className="relative min-h-0 flex-1">
        {!sidecarReady ? (
          <SidecarUnavailableHint />
        ) : rendered.length === 0 ? (
          <EmptySelectionHint withoutYdd={withoutYdd} />
        ) : (
          <>
            <Viewer3D
              models={models}
              preset={cameraPreset}
              frameNonce={frameNonce}
              autoRotate={autoRotate}
              onModelError={handleModelError}
            />

            {/* Stats + warning chips (top left) */}
            <div className="pointer-events-none absolute left-2 top-2 flex max-w-[65%] flex-wrap gap-1.5">
              {stats && (
                <OverlayChip
                  title={`Summe der ${rendered.length} gerenderten Drawables`}
                >
                  {NUMBER_FORMAT.format(stats.polys)} Polys ·{" "}
                  {NUMBER_FORMAT.format(stats.verts)} Verts
                </OverlayChip>
              )}
              {lodWarnings.length > 0 && (
                <OverlayChip
                  tone="warn"
                  title={lodWarnings
                    .map((w) => `${w.label}: ${w.missing.join("/")}-LOD fehlt`)
                    .join("\n")}
                >
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  {lodWarnings.length} LOD-Warnung
                  {lodWarnings.length === 1 ? "" : "en"}
                </OverlayChip>
              )}
              {untextured.length > 0 && (
                <OverlayChip
                  tone="warn"
                  title={untextured
                    .map((d) => d.label || "(ohne Namen)")
                    .join("\n")}
                >
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  {untextured.length} ohne Textur
                </OverlayChip>
              )}
            </div>

            {/* Loading + error chips (top right) */}
            <div className="pointer-events-none absolute right-2 top-2 flex max-w-[35%] flex-col items-end gap-1.5">
              {loadingCount > 0 && (
                <OverlayChip>
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  Lädt {loadingCount} Modell{loadingCount === 1 ? "" : "e"}…
                </OverlayChip>
              )}
              {errorChips.map((chip) => (
                <OverlayChip
                  key={chip.id}
                  tone="error"
                  title={
                    chip.retry
                      ? `${chip.message}\nKlicken zum erneuten Laden`
                      : chip.message
                  }
                  onClick={chip.retry ?? undefined}
                >
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  <span className="truncate">{chip.label}</span>
                </OverlayChip>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
