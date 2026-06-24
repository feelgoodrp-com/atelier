/**
 * Dockable 3D preview panel (bottom of the workbench center column).
 *
 * Renders every selected drawable with a YDD mesh (outfit preview, cap 8) via
 * the sidecar's /preview/glb endpoint. The header hosts camera presets,
 * Fokus/autorotate and the ped-body switch; overlay chips show poly/vertex
 * totals, LOD/texture warnings and per-drawable fetch errors.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Focus,
  Loader2,
  Orbit,
  Pause,
  PersonStanding,
  Play,
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
import i18n from "@/lib/i18n";
import {
  fetchPreviewAnimations,
  fetchPreviewPoses,
  fetchSidecarServerInfo,
  restartSidecar,
} from "@/lib/sidecar/client";
import type { PreviewAnyRequest } from "@/lib/stores/preview-3d-store";
import {
  CAMERA_PRESETS,
  PREVIEW_MAX_MODELS,
  appearanceKey,
  clampTextureIndex,
  drawableHairScale,
  drawableHasHeelLift,
  glbCacheKey,
  outfitCacheKey,
  pedModelFor,
  selectPreviewedDrawables,
  usePreview3dStore,
  type CameraPreset,
} from "@/lib/stores/preview-3d-store";
import { HEEL_LIFT_M } from "@/lib/preview/appearance";
import { CharacterPopover } from "./character-popover";
import { useProjectStore } from "@/lib/stores/project-store";
import { useSidecarStore } from "@/lib/stores/sidecar-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import type { ProjectDrawable } from "@/lib/project/schema";
import { Viewer3D, type ViewerModel } from "./viewer-3d";

/** Counts use the app language's grouping (e.g. EN "1,234" vs DE "1.234"). */
const formatCount = (n: number): string => n.toLocaleString(i18n.language);

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
  const { t } = useTranslation("preview");
  const [restarting, setRestarting] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="rounded-[10px] border border-red-500/25 bg-red-500/10 px-5 py-4">
        <p className="text-sm font-medium text-red-300">
          {t("pane.sidecarUnavailable.heading")}
        </p>
        <p className="mt-1 max-w-72 text-xs text-red-200/70">
          {t("pane.sidecarUnavailable.body")}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={restarting}
          className="mt-3 h-7 border-red-500/30 text-xs text-red-200 hover:bg-red-500/10"
          onClick={() => {
            setRestarting(true);
            restartSidecar()
              .then(() => toast.success(t("pane.sidecarUnavailable.restarting")))
              .catch((e: unknown) =>
                toast.error(t("pane.sidecarUnavailable.restartFailed"), {
                  description: e instanceof Error ? e.message : String(e),
                }),
              )
              .finally(() => setRestarting(false));
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("pane.sidecarUnavailable.restart")}
        </Button>
      </div>
    </div>
  );
}

function EmptySelectionHint({ withoutYdd }: { withoutYdd: number }) {
  const { t } = useTranslation("preview");
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="glass-border-subtle flex h-12 w-12 items-center justify-center rounded-[10px]">
        <Rotate3d className="h-5 w-5 text-white/30" />
      </div>
      <p className="mt-3 text-sm font-medium text-white/60">
        {withoutYdd > 0 ? t("pane.empty.noYdd") : t("pane.empty.nothing")}
      </p>
      <p className="mt-1 max-w-64 text-xs text-white/35">
        {withoutYdd > 0
          ? t("pane.empty.noYddHint")
          : t("pane.empty.nothingHint")}
      </p>
    </div>
  );
}

export function PreviewPane() {
  const { t } = useTranslation("preview");
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
  const animation = usePreview3dStore((s) => s.animation);
  const animations = usePreview3dStore((s) => s.animations);
  const animationsLoaded = usePreview3dStore((s) => s.animationsLoaded);
  const playing = usePreview3dStore((s) => s.playing);
  const playbackSpeed = usePreview3dStore((s) => s.playbackSpeed);
  const appearance = usePreview3dStore((s) => s.appearance);
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
  const setAnimation = usePreview3dStore((s) => s.setAnimation);
  const setAnimations = usePreview3dStore((s) => s.setAnimations);
  const setPlaying = usePreview3dStore((s) => s.setPlaying);
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

  // GET /preview/animations — fetched once when the sidecar is ready.
  useEffect(() => {
    if (!sidecarReady || animationsLoaded) return;
    let disposed = false;
    fetchPreviewAnimations()
      .then((live) => {
        if (!disposed) setAnimations(live);
      })
      .catch(() => {
        /* no animations available — the select stays empty/disabled */
      });
    return () => {
      disposed = true;
    };
  }, [sidecarReady, animationsLoaded, setAnimations]);

  const { rendered, overCap, withoutYdd } = useMemo(
    () => selectPreviewedDrawables(project, selection),
    [project, selection],
  );

  // Cap hint — toast once when the selection first exceeds the limit.
  const lastOverCap = useRef(0);
  useEffect(() => {
    if (overCap > 0 && lastOverCap.current === 0) {
      toast.info(t("pane.capToast.title", { count: PREVIEW_MAX_MODELS }), {
        description: t("pane.capToast.description", { count: overCap }),
      });
    }
    lastOverCap.current = overCap;
  }, [overCap]);

  const pedBodyActive = includePedBody && gtaPathReady === true;
  // Poses are baked from game clips — only effective with a ready gtaPath
  // (the toolbar select is disabled otherwise, this guards stale state).
  const poseActive = gtaPathReady === true ? pose : null;
  // The active looping animation (skinned GLB the viewer plays); same gating as
  // poses, and mutually exclusive with pose (the store enforces it).
  const animActive = gtaPathReady === true ? animation : null;

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
      // heelLift is GLOBAL: any rendered feet item with highHeels raises the
      // whole scene. Derived once from the rendered set (not per item).
      const heelLift = rendered.some(drawableHasHeelLift);
      const parts: Array<{
        yddHash: string;
        textureHash: string | null;
        hairScale?: number | null;
      }> = [];
      const items = rendered.flatMap((drawable) => {
        const ydd = drawable.ydd;
        if (!ydd) return [];
        const textureIndex = clampTextureIndex(
          drawable,
          textureIndexByDrawable[drawable.id],
        );
        // Per-item hairScale (hair/p_head only) — both the key part AND the
        // request item must carry it, or prefetch/render keys diverge.
        const hairScale = drawableHairScale(drawable);
        parts.push({
          yddHash: ydd.hash,
          textureHash: drawable.textures[textureIndex]?.hash ?? null,
          ...(hairScale != null ? { hairScale } : {}),
        });
        return [
          {
            yddPath: joinPath(projectDir, ydd.path),
            ytdPaths: drawable.textures.map((t) => joinPath(projectDir, t.path)),
            textureIndex,
            slot: drawable.type,
            ...(hairScale != null ? { hairScale } : {}),
          },
        ];
      });
      if (items.length === 0) return [];
      return [
        {
          drawable: rendered[0],
          key: outfitCacheKey(
            parts,
            pedModel,
            poseActive,
            appearanceKey(appearance),
            heelLift,
            animActive,
          ),
          request: {
            items,
            pedModel,
            includePedBody: true,
            pose: poseActive,
            // Appearance only matters when the ped body is merged — the
            // garment-only branch below stays appearance-free on purpose.
            ...(appearance ? { appearance } : {}),
            // Global scene lift — numeric meters, only when a feet heel item is
            // in the scene (client.ts drops the field otherwise).
            ...(heelLift ? { heelLift: HEEL_LIFT_M } : {}),
            // Animated mode: skinned GLB the viewer plays (overrides pose).
            ...(animActive ? { animation: animActive } : {}),
          },
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
      // A pose/animation binds against a GENDER-specific skeleton + clip —
      // without the pedModel a female garment would silently get the male one.
      const poseSkeleton = poseActive || animActive ? pedModelFor(drawable) : null;
      // Single garment: hairScale applies to this whole ydd; heelLift lifts
      // this (single) scene — both derived from THIS drawable's type+flags.
      const hairScale = drawableHairScale(drawable);
      const heelLift = drawableHasHeelLift(drawable);
      return [
        {
          drawable,
          key: glbCacheKey(
            ydd.hash,
            textureHash,
            null,
            poseActive,
            poseSkeleton,
            "default",
            hairScale,
            heelLift,
            animActive,
          ),
          request: {
            yddPath: joinPath(projectDir, ydd.path),
            ytdPaths: drawable.textures.map((t) => joinPath(projectDir, t.path)),
            textureIndex,
            includePedBody: false,
            pose: poseActive,
            ...(poseSkeleton ? { pedModel: poseSkeleton } : {}),
            // Preview-only mesh transforms — dropped from the body by client.ts
            // when inactive, so heel-/hair-free garments stay byte-identical.
            ...(hairScale != null ? { hairScale } : {}),
            ...(heelLift ? { heelLift: HEEL_LIFT_M } : {}),
            // Animated mode: skinned GLB the viewer plays (overrides pose).
            ...(animActive ? { animation: animActive } : {}),
          },
        },
      ];
    });
  }, [
    // `rendered` is a fresh array whenever the project changes (the inspector's
    // updateDrawable replaces the drawable + project ref), so editing the hair
    // slider / high-heels switch re-runs this memo and the preview updates live
    // — the derived hairScale/heelLift come straight from each drawable.flags.
    projectDir,
    rendered,
    textureIndexByDrawable,
    pedBodyActive,
    poseActive,
    animActive,
    appearance,
  ]);

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

  /**
   * Appearance fallback slots of the CURRENTLY RENDERED entries — per-entry
   * state, so cache hits keep their warnings and prefetch responses for other
   * genders/appearances never leak into the popover. With ped body there is
   * exactly one outfit request; without it appearance is not applied.
   */
  const appearanceFallbacks = useMemo(() => {
    if (!pedBodyActive) return [];
    const slots = new Set<string>();
    for (const { key } of requests) {
      for (const slot of entries[key]?.appearanceFallbacks ?? []) {
        slots.add(slot);
      }
    }
    return [...slots].sort();
  }, [pedBodyActive, requests, entries]);

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
          label: drawable.label || t("pane.noName"),
          message: entry.error ?? t("pane.unknownError"),
          retry: () => retryGlb(key, request),
        });
        continue;
      }
      const parseError = entry?.url ? parseErrors[entry.url] : undefined;
      if (parseError) {
        chips.push({
          id: drawable.id,
          label: drawable.label || t("pane.noName"),
          message: parseError,
          retry: () => retryGlb(key, request),
        });
      }
    }
    return chips;
  }, [requests, entries, parseErrors, retryGlb, t]);

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
      if (meta.drawables.some((info) => !info.lods.med))
        missing.push(t("lod.med"));
      if (meta.drawables.some((info) => !info.lods.low))
        missing.push(t("lod.low"));
      if (missing.length > 0) {
        warnings.push({ label: drawable.label || t("pane.noName"), missing });
      }
    }
    return warnings;
  }, [rendered, yddMeta, t]);

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
          {t("pane.title")}
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
                  {t(`camera.${preset.id}`)}
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
                    aria-label={t("pane.pose.ariaLabel")}
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
                    <SelectItem value="none">{t("pane.pose.bind")}</SelectItem>
                    {poses.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {t(`pose.${p.id}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {gtaPathReady === true
                ? t("pane.pose.tooltipActive")
                : t("pane.pose.tooltipDisabled")}
            </TooltipContent>
          </Tooltip>

          {/* Animation: looping clips the viewer plays (skinned GLB). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Select
                  value={animation ?? "none"}
                  disabled={gtaPathReady !== true || animations.length === 0}
                  onValueChange={(v) => setAnimation(v === "none" ? null : v)}
                >
                  <SelectTrigger
                    aria-label={t("pane.anim.ariaLabel")}
                    className="h-7 w-36 border-white/15 bg-white/5 text-xs text-white"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Play className="h-3.5 w-3.5 shrink-0 text-white/45" />
                      <span className="truncate">
                        <SelectValue />
                      </span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("pane.anim.none")}</SelectItem>
                    {animations.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {t(`anim.${a.id}`, { defaultValue: a.label })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {gtaPathReady === true
                ? t("pane.anim.tooltipActive")
                : t("pane.anim.tooltipDisabled")}
            </TooltipContent>
          </Tooltip>

          {animActive && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(iconButton, !playing && "text-[#7289DA]")}
                  onClick={() => setPlaying(!playing)}
                  aria-label={playing ? t("pane.anim.pause") : t("pane.anim.play")}
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {playing ? t("pane.anim.pause") : t("pane.anim.play")}
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={iconButton}
                onClick={requestFrame}
                aria-label={t("pane.centerCamera")}
              >
                <Focus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("pane.centerCameraTooltip")}
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
                aria-label={t("pane.autoRotate")}
              >
                <Orbit className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {autoRotate ? t("pane.autoRotateOff") : t("pane.autoRotateOn")}
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
                  aria-label={t("pane.pedBodyAria")}
                />
                <span
                  className={cn(
                    "text-xs",
                    gtaPathReady === true ? "text-white/55" : "text-white/30",
                  )}
                >
                  {t("pane.pedBody")}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {gtaPathReady === true
                ? t("pane.pedBodyTooltipActive")
                : t("pane.pedBodyTooltipDisabled")}
            </TooltipContent>
          </Tooltip>

          <CharacterPopover
            disabled={!pedBodyActive}
            pedModel={rendered.length > 0 ? pedModelFor(rendered[0]) : null}
            fallbackSlots={appearanceFallbacks}
          />

          <div className="mx-1 h-5 w-px bg-white/10" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={iconButton}
                onClick={() => setPreviewOpen(false)}
                aria-label={t("pane.collapse")}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("pane.collapse")}</TooltipContent>
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
              playing={playing}
              playbackSpeed={playbackSpeed}
              onModelError={handleModelError}
            />

            {/* Stats + warning chips (top left) */}
            <div className="pointer-events-none absolute left-2 top-2 flex max-w-[65%] flex-wrap gap-1.5">
              {stats && (
                <OverlayChip
                  title={t("pane.statsTitle", { count: rendered.length })}
                >
                  {t("pane.stats", {
                    polys: formatCount(stats.polys),
                    verts: formatCount(stats.verts),
                  })}
                </OverlayChip>
              )}
              {lodWarnings.length > 0 && (
                <OverlayChip
                  tone="warn"
                  title={lodWarnings
                    .map((w) =>
                      t("pane.lodMissing", {
                        label: w.label,
                        missing: w.missing.join("/"),
                      }),
                    )
                    .join("\n")}
                >
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  {t("pane.lodWarning", { count: lodWarnings.length })}
                </OverlayChip>
              )}
              {untextured.length > 0 && (
                <OverlayChip
                  tone="warn"
                  title={untextured
                    .map((d) => d.label || t("pane.noName"))
                    .join("\n")}
                >
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  {t("pane.untextured", { count: untextured.length })}
                </OverlayChip>
              )}
            </div>

            {/* Loading + error chips (top right) */}
            <div className="pointer-events-none absolute right-2 top-2 flex max-w-[35%] flex-col items-end gap-1.5">
              {loadingCount > 0 && (
                <OverlayChip>
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  {t("pane.loadingModels", { count: loadingCount })}
                </OverlayChip>
              )}
              {errorChips.map((chip) => (
                <OverlayChip
                  key={chip.id}
                  tone="error"
                  title={
                    chip.retry
                      ? `${chip.message}\n${t("pane.retryHint")}`
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
