/**
 * "Charakter"-Panel des 3D-Preview-Headers: Komponenten-Stepper für den
 * Freemode-Body, Menyoo-XML-Import, Presets und Fallback-Warnungen.
 *
 * Built on the raw Radix dialog primitive in NON-modal mode (no overlay, no
 * focus trap) — components/ui has no popover, and a modal dialog would hide
 * the live preview while stepping through drawables. The panel floats at the
 * bottom-right of the window and only closes via the trigger, X or Escape.
 */

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  CircleUser,
  Eraser,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Smile,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  COMPONENT_SLOT_IDS,
  GTA_COMPONENTS,
  type ComponentSlotId,
} from "@/lib/gta/components";
import {
  STANDARD_APPEARANCE_PRESETS,
  hasUnrenderedExtras,
  isStandardPresetName,
  normalizeAppearance,
  type AppearancePreset,
} from "@/lib/preview/appearance";
import { parseMenyooXml, type MenyooParseResult, type MenyooPed } from "@/lib/preview/menyoo";
import { usePreview3dStore } from "@/lib/stores/preview-3d-store";
import type { PedModel } from "@/lib/sidecar/types";

/**
 * Base-game variation counts per slot (EnableDlc=false) from the live asset
 * probe — STEPPER BOUNDS only. Texture counts marked in the probe are exact,
 * undocumented ones use a generous cap. Server-side handling differs:
 * unresolvable DRAWABLE indices fall back to the slot default and are
 * reported via X-FG-Appearance-Fallbacks; out-of-range TEXTURE indices are
 * silently clamped WITHOUT a header notice (no fallback hint in the UI).
 */
const SLOT_RANGES: Record<
  PedModel,
  Record<ComponentSlotId, { drawables: number; textures: number }>
> = {
  mp_m_freemode_01: {
    head: { drawables: 46, textures: 1 },
    berd: { drawables: 8, textures: 8 },
    hair: { drawables: 16, textures: 7 },
    uppr: { drawables: 16, textures: 1 },
    lowr: { drawables: 16, textures: 16 },
    hand: { drawables: 9, textures: 8 },
    feet: { drawables: 16, textures: 16 },
    teef: { drawables: 16, textures: 8 },
    accs: { drawables: 16, textures: 16 },
    task: { drawables: 10, textures: 8 },
    decl: { drawables: 7, textures: 8 },
    jbib: { drawables: 16, textures: 16 },
  },
  mp_f_freemode_01: {
    head: { drawables: 46, textures: 1 },
    berd: { drawables: 8, textures: 8 },
    hair: { drawables: 16, textures: 7 },
    uppr: { drawables: 16, textures: 1 },
    lowr: { drawables: 16, textures: 16 },
    hand: { drawables: 9, textures: 8 },
    feet: { drawables: 16, textures: 16 },
    teef: { drawables: 10, textures: 8 },
    accs: { drawables: 16, textures: 16 },
    task: { drawables: 8, textures: 8 },
    decl: { drawables: 6, textures: 8 },
    jbib: { drawables: 16, textures: 16 },
  },
};

const SLOT_LABELS: Record<ComponentSlotId, string> = Object.fromEntries(
  GTA_COMPONENTS.map((slot) => [slot.id, slot.label]),
) as Record<ComponentSlotId, string>;

/**
 * Highest overlay slot the sidecar actually RENDERS in Stufe 2. Slots 10..12
 * (chest hair / body blemishes) live on the body, not the head diffuse, and
 * are honestly excluded (Dtos.cs PedFaceOverlayDto + FaceCalibration
 * Render=false). The "Gesicht" status must only count/name 0..9 so it does not
 * claim e.g. "Brusthaar" as an active, visible overlay. (The canonical key
 * still carries 10..12 — both sides agree on that — so this is a display-only
 * filter, never a key change.)
 */
const RENDERED_OVERLAY_SLOT_MAX = 9;

/** German labels for the 13 SET_PED_HEAD_OVERLAY slots (status display). */
const OVERLAY_SLOT_LABELS: Record<number, string> = {
  0: "Hautunreinheiten",
  1: "Bart",
  2: "Augenbrauen",
  3: "Alterung",
  4: "Make-up",
  5: "Rouge",
  6: "Teint",
  7: "Sonnenschäden",
  8: "Lippenstift",
  9: "Sommersprossen",
  10: "Brusthaar",
  11: "Körper-Makel",
  12: "Zusatz-Makel",
};

function genderLabel(pedModel: PedModel): string {
  return pedModel === "mp_m_freemode_01" ? "männlich" : "weiblich";
}

/**
 * Maps one X-FG-Appearance-Fallbacks entry to a German hint. Face labels
 * ("skin", "eye", "overlay:<slot>") get a face-specific message; everything
 * else is a garment component slot whose drawable index was not resolvable
 * (DLC). Keep the label set in sync with the sidecar FaceCompositor fallbacks.
 */
function faceFallbackHint(slot: string): string {
  if (slot === "skin") {
    return "Hautton konnte nicht vollständig gerendert werden — eine Eltern-Hauttextur fehlt; Standard-Haut wird verwendet.";
  }
  if (slot === "eye") {
    return "Augenfarbe konnte nicht gerendert werden — die Augen-Textur fehlt; Standard-Augen werden verwendet.";
  }
  const overlayMatch = /^overlay:(\d+)$/.exec(slot);
  if (overlayMatch) {
    const index = Number.parseInt(overlayMatch[1], 10);
    const label = OVERLAY_SLOT_LABELS[index] ?? `Slot ${index}`;
    return `Overlay „${label}“ wurde übersprungen — die gewählte Variante ist nicht verfügbar.`;
  }
  // Component-slot fallback (garment drawable not resolvable, e.g. DLC).
  return `Slot „${slot}“ nutzt den Standard — Drawable-Index nicht verfügbar (DLC-Kleidung?).`;
}

/** Compact -/+ stepper used for drawable + texture indices. */
function Stepper({
  value,
  max,
  onChange,
  ariaLabel,
}: {
  value: number;
  /** Exclusive upper bound (count of variants). */
  max: number;
  onChange: (next: number) => void;
  ariaLabel: string;
}) {
  const stepButton =
    "flex h-5 w-5 items-center justify-center rounded-[6px] text-white/45 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30";
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        className={stepButton}
        disabled={value <= 0}
        aria-label={`${ariaLabel} verringern`}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-7 text-center font-mono text-[11px] text-white/80">
        {value}
      </span>
      <button
        type="button"
        className={stepButton}
        disabled={value >= max - 1}
        aria-label={`${ariaLabel} erhöhen`}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="h-3 w-3" />
      </button>
    </span>
  );
}

interface CharacterPopoverProps {
  /** Disabled unless the ped body is actually rendered (gtaPathReady + switch). */
  disabled: boolean;
  /** Ped model of the current preview (null = nothing rendered yet). */
  pedModel: PedModel | null;
  /**
   * Fallback slots of the CURRENTLY RENDERED GLB entry (derived per cache
   * entry by the pane) — not global store state, so cache hits keep their
   * warnings and prefetch responses for other genders never show up here.
   */
  fallbackSlots: string[];
}

export function CharacterPopover({
  disabled,
  pedModel,
  fallbackSlots,
}: CharacterPopoverProps) {
  const appearance = usePreview3dStore((s) => s.appearance);
  const appearanceExtras = usePreview3dStore((s) => s.appearanceExtras);
  const appearanceWarnings = usePreview3dStore((s) => s.appearanceWarnings);
  const appearancePresets = usePreview3dStore((s) => s.appearancePresets);
  const setAppearance = usePreview3dStore((s) => s.setAppearance);
  const applyImportedAppearance = usePreview3dStore(
    (s) => s.applyImportedAppearance,
  );
  const applyPresetAction = usePreview3dStore((s) => s.applyPreset);
  const removeFace = usePreview3dStore((s) => s.removeFace);
  const resetAppearance = usePreview3dStore((s) => s.resetAppearance);
  const saveAppearancePreset = usePreview3dStore((s) => s.saveAppearancePreset);
  const deleteAppearancePreset = usePreview3dStore(
    (s) => s.deleteAppearancePreset,
  );

  const [open, setOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [importing, setImporting] = useState(false);
  /** Spooner files with several peds: pending candidates for the user pick. */
  const [pendingImport, setPendingImport] = useState<MenyooParseResult | null>(
    null,
  );

  // The panel must not stay open (and seemingly functional) when the
  // ped-body switch goes off — its edits would not be visible anywhere.
  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const ranges = SLOT_RANGES[pedModel ?? "mp_m_freemode_01"];

  const setComponent = (slot: ComponentSlotId, drawable: number, texture: number) => {
    const components = { ...(appearance?.components ?? {}) };
    // Imported entries can carry alt != 0 — that is key-significant and must
    // survive stepper edits (and keeps an all-zero-with-alt entry alive).
    const alt = components[slot]?.alt ?? 0;
    // drawable 0 / texture 0 / alt 0 is the game default — dropping it keeps
    // the canonical key normalized (matches the Menyoo parser + sidecar).
    if (drawable === 0 && texture === 0 && alt === 0) delete components[slot];
    else components[slot] = { drawable, texture, ...(alt !== 0 ? { alt } : {}) };
    // The rendered face (Menyoo face import / preset) and the manual component
    // steppers are SEPARATE features — a stepper edit must not wipe the face.
    setAppearance(
      normalizeAppearance({
        components,
        props: appearance?.props ?? [],
        ...(appearance?.face ? { face: appearance.face } : {}),
      }),
    );
  };

  const applyPed = (ped: MenyooPed, fileWarnings: string[]) => {
    // FACE-ONLY import (hard product rule): the store takes ONLY the head
    // features (extras -> face) and ignores the XML's clothing/hair + props.
    // We deliberately pass NO components — appearance.components/props keep
    // whatever the user set manually. So we surface ONLY the face-relevant
    // warnings (ped.warnings: clamped HeadBlend/overlay/eye values) plus the
    // structural file warnings — ped.clothingWarnings (unknown/oversized
    // component+prop slots, non-freemode ModelHash) are DROPPED, since the
    // clothing/props they refer to are not applied (no DLC/clothing warnings
    // on a face-only import, per the hard product rule).
    applyImportedAppearance(ped.extras, [...fileWarnings, ...ped.warnings]);
    setPendingImport(null);
    if (ped.pedModel && pedModel && ped.pedModel !== pedModel) {
      toast.info("Geschlecht weicht ab", {
        description: `Die XML ist für einen ${genderLabel(ped.pedModel)}en Ped, die Vorschau zeigt gerade einen ${genderLabel(pedModel)}en Body.`,
      });
    }
    toast.success(`Gesicht aus „${ped.name}“ importiert`, {
      description:
        "Nur das Gesicht wird übernommen (Form, Hautton, Augenbrauen/Bart, Augenfarbe). Kleidung und Haare aus der Datei werden ignoriert — die stellst du im Tool selbst ein.",
    });
  };

  const importMenyooXml = async () => {
    setImporting(true);
    try {
      const file = await openDialog({
        title: "Menyoo-XML importieren",
        multiple: false,
        filters: [{ name: "Menyoo XML", extensions: ["xml"] }],
      });
      if (typeof file !== "string") return;
      const result = parseMenyooXml(await readFile(file));
      if (result.peds.length === 0) {
        toast.error("Import fehlgeschlagen", {
          description:
            result.warnings[0] ?? "Die Datei enthält keinen importierbaren Ped.",
        });
        return;
      }
      if (result.peds.length === 1) applyPed(result.peds[0], result.warnings);
      else setPendingImport(result);
    } catch (e) {
      toast.error("Import fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setImporting(false);
    }
  };

  const applyPreset = (preset: AppearancePreset) => {
    // Presets are authored in the tool, so their clothing IS intentional —
    // apply components + face (unlike the face-only Menyoo import).
    applyPresetAction(normalizeAppearance(preset.appearance), preset.extras);
    if (preset.pedModel && pedModel && preset.pedModel !== pedModel) {
      toast.info("Geschlecht weicht ab", {
        description: `Das Preset ist für ${genderLabel(preset.pedModel)} gespeichert, die Vorschau zeigt gerade ${genderLabel(pedModel)}.`,
      });
    }
  };

  // "Face only" imports (no components, face in appearance) are saveable too —
  // the preset then applies default clothing + the head data.
  const canSavePreset =
    appearance !== null || hasUnrenderedExtras(appearanceExtras);

  // Rendered face status (HeadBlend + overlays + eye colour) — what the user
  // actually sees on the body, read from the live appearance.face block.
  const face = appearance?.face ?? null;
  const faceLines: string[] = [];
  if (face) {
    // Shape: dominant parent when the mix collapses to an end, else a blend.
    if (face.shapeMix <= 0.05) {
      faceLines.push(`Form: Elternteil ${face.shapeFirst} (dominant)`);
    } else if (face.shapeMix >= 0.95) {
      faceLines.push(`Form: Elternteil ${face.shapeSecond} (dominant)`);
    } else {
      faceLines.push(
        `Form-Mix: ${face.shapeFirst} ↔ ${face.shapeSecond} (${Math.round(
          face.shapeMix * 100,
        )} %)`,
      );
    }
    faceLines.push(`Hautton-Mix: ${Math.round(face.skinMix * 100)} %`);
    // Only count/name the overlays the sidecar renders (head slots 0..9). Body
    // overlays 10..12 are stored + keyed but not drawn, so claiming them as
    // "active overlays" here would be dishonest.
    const renderedOverlays = (face.overlays ?? []).filter(
      (o) => o.slot <= RENDERED_OVERLAY_SLOT_MAX,
    );
    const overlayCount = renderedOverlays.length;
    if (overlayCount > 0) {
      const names = renderedOverlays
        .map((o) => OVERLAY_SLOT_LABELS[o.slot] ?? `Slot ${o.slot}`)
        .join(", ");
      faceLines.push(
        `${overlayCount} aktive${overlayCount === 1 ? "s" : ""} Overlay${
          overlayCount === 1 ? "" : "s"
        }: ${names}`,
      );
    }
    if (face.eyeColour !== undefined) {
      faceLines.push(`Augenfarbe: ${face.eyeColour}`);
    }
  }
  // FaceFeatures are stored but NOT rendered (honest exclusion) — only flag it
  // when the imported data actually carries non-zero micro-morphs.
  const hasFaceFeatures =
    appearanceExtras?.faceFeatures.some((f) => f !== 0) ?? false;

  const savePreset = () => {
    const name = presetName.trim();
    if (!name || !canSavePreset) return;
    if (isStandardPresetName(name)) {
      toast.error("Name ist reserviert", {
        description: "Bitte einen anderen Preset-Namen wählen.",
      });
      return;
    }
    saveAppearancePreset({
      name,
      pedModel,
      appearance,
      extras: appearanceExtras,
    });
    setPresetName("");
    toast.success(`Preset „${name}“ gespeichert`);
  };

  // Static hints (derived, survive restarts) + import warnings + the
  // fallback slots of the rendered entry (drawable fallbacks only — texture
  // clamps are silent server-side) — rendered as one unobtrusive list. The
  // HeadBlend/overlays/eye-colour are NOW rendered (Stufe 2), so the only
  // honest face caveat left is the micro-morph FaceFeatures.
  const hints: string[] = [
    ...((appearance?.props?.length ?? 0) > 0
      ? [
          "Props (Hüte, Brillen, Uhren …) werden in der Vorschau noch nicht angezeigt.",
        ]
      : []),
    ...(hasFaceFeatures
      ? [
          "Feinregler (FaceFeatures, z. B. Nasenbreite) werden in der Vorschau nicht dargestellt — sie bleiben gespeichert.",
        ]
      : []),
    // The sidecar reports two kinds of fallback in X-FG-Appearance-Fallbacks:
    // component-slot names (a garment drawable index could not be resolved) and
    // FACE labels ("skin", "eye", "overlay:<slot>" — a face source was skipped,
    // e.g. an out-of-range overlay index). Translate each to an honest message.
    ...fallbackSlots.map(faceFallbackHint),
    ...appearanceWarnings,
  ];

  const sectionLabel =
    "text-[10px] font-semibold uppercase tracking-wider text-white/35";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span wrapper: Radix tooltips need an enabled event target. */}
          <span>
            <DialogPrimitive.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label="Charakter anpassen"
                className={cn(
                  "h-7 w-7 rounded-[8px] text-white/55 hover:bg-white/10 hover:text-white",
                  appearance && "text-[#7289DA]",
                  open && "bg-white/10",
                )}
              >
                <CircleUser className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Trigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {disabled
            ? "Ped-Body aktivieren, um den Charakter anzupassen"
            : "Charakter anpassen (Komponenten, Menyoo-Import, Presets)"}
        </TooltipContent>
      </Tooltip>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Keep the panel open while the user orbits the model / clicks
          // around — it only closes via trigger, X or Escape.
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="liquid-glass fixed bottom-4 right-4 z-50 flex w-[22rem] flex-col gap-3 rounded-[12px] border border-white/15 p-4 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <CircleUser className="h-4 w-4 shrink-0 text-white/40" />
            <DialogPrimitive.Title className="text-sm font-semibold text-white">
              Charakter
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Schließen"
              className="ml-auto rounded-[6px] p-1 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </DialogPrimitive.Close>
          </div>

          {pendingImport ? (
            <>
              <p className="text-xs text-white/50">
                Die Datei enthält mehrere Peds — welcher soll importiert
                werden?
              </p>
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {pendingImport.peds.map((ped, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => applyPed(ped, pendingImport.warnings)}
                    className="flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-white/80 transition-colors hover:bg-white/10"
                  >
                    <span className="truncate font-medium">{ped.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-white/40">
                      {ped.pedModel ? genderLabel(ped.pedModel) : "kein Freemode"}
                    </span>
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setPendingImport(null)}
              >
                Abbrechen
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-white/45">
                Komponenten des Freemode-Bodys für die Vorschau — Drawable- und
                Textur-Index je Slot.
              </p>

              <ScrollArea className="h-52 rounded-[8px] border border-white/8 bg-black/20">
                <div className="flex flex-col gap-0.5 p-2">
                  {COMPONENT_SLOT_IDS.map((slot) => {
                    const value = appearance?.components?.[slot] ?? {
                      drawable: 0,
                      texture: 0,
                    };
                    const range = ranges[slot];
                    return (
                      <div
                        key={slot}
                        className="flex items-center gap-2 rounded-[6px] px-1 py-0.5 hover:bg-white/4"
                      >
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] text-white/60"
                          title={`${SLOT_LABELS[slot]} (${slot})`}
                        >
                          {SLOT_LABELS[slot]}
                        </span>
                        <Stepper
                          value={value.drawable}
                          max={range.drawables}
                          ariaLabel={`${SLOT_LABELS[slot]} Drawable`}
                          onChange={(next) =>
                            setComponent(slot, next, value.texture)
                          }
                        />
                        <Stepper
                          value={value.texture}
                          max={range.textures}
                          ariaLabel={`${SLOT_LABELS[slot]} Textur`}
                          onChange={(next) =>
                            setComponent(slot, value.drawable, next)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importing}
                  className="h-7 flex-1 text-xs"
                  onClick={() => void importMenyooXml()}
                >
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Menyoo-XML importieren…
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="sm"
                        variant="ghost"
                        // Face-only imports leave appearance=null but carry
                        // extras/warnings — those must stay resettable too.
                        disabled={
                          !appearance &&
                          !appearanceExtras &&
                          appearanceWarnings.length === 0
                        }
                        aria-label="Charakter zurücksetzen"
                        className="h-7 w-7 p-0 text-white/55 hover:text-white"
                        onClick={resetAppearance}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Zurücksetzen auf Spiel-Standard
                  </TooltipContent>
                </Tooltip>
              </div>

              <p className="text-[10px] leading-snug text-white/40">
                Aus der Menyoo-Datei wird nur das Gesicht übernommen (Form,
                Hautton, Augenbrauen/Bart, Augenfarbe). Kleidung und Haare aus
                der Datei werden ignoriert — die stellst du im Tool selbst ein.
              </p>

              {/* Face status: what the rendered head actually shows. Only when
                  a face block is active (after a Menyoo face import / a preset
                  carrying head data). */}
              {face && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Smile className="h-3 w-3 shrink-0 text-white/40" />
                    <span className={sectionLabel}>Gesicht</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-auto">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Gesicht entfernen"
                            className="h-6 w-6 p-0 text-white/45 hover:text-white"
                            onClick={removeFace}
                          >
                            <Eraser className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Gesicht entfernen (manuell gesetzte Komponenten bleiben)
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <ul className="flex flex-col gap-0.5 rounded-[8px] border border-white/8 bg-black/20 px-2.5 py-1.5">
                    {faceLines.map((line, index) => (
                      <li
                        key={index}
                        className="text-[11px] leading-snug text-white/65"
                      >
                        {line}
                      </li>
                    ))}
                    <li className="mt-0.5 text-[10px] leading-snug text-white/35">
                      Feinregler (FaceFeatures) werden in der Vorschau nicht
                      dargestellt.
                    </li>
                  </ul>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className={sectionLabel}>Presets</span>
                <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                  {[...STANDARD_APPEARANCE_PRESETS, ...appearancePresets].map(
                    (preset) => {
                      const builtin = isStandardPresetName(preset.name);
                      return (
                        <div
                          key={preset.name}
                          className="flex items-center gap-1 rounded-[6px] border border-white/8 bg-white/4 pl-1"
                        >
                          <button
                            type="button"
                            onClick={() => applyPreset(preset)}
                            className="min-w-0 flex-1 truncate rounded-[5px] px-1.5 py-1 text-left text-[11px] text-white/75 transition-colors hover:bg-white/8 hover:text-white"
                            title={`„${preset.name}“ anwenden`}
                          >
                            {preset.name}
                          </button>
                          {!builtin && (
                            <button
                              type="button"
                              aria-label={`Preset „${preset.name}“ löschen`}
                              onClick={() => deleteAppearancePreset(preset.name)}
                              className="mr-1 rounded-[5px] p-1 text-white/35 transition-colors hover:bg-red-500/15 hover:text-red-300"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Preset-Name…"
                    className="h-7 border-white/15 bg-white/5 text-xs text-white"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") savePreset();
                    }}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!presetName.trim() || !canSavePreset}
                          aria-label="Preset speichern"
                          className="h-7 w-7 p-0"
                          onClick={savePreset}
                        >
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {canSavePreset
                        ? "Aktuellen Charakter als Preset speichern"
                        : "Erst Komponenten anpassen oder importieren"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {hints.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className={sectionLabel}>Hinweise</span>
                  <ul className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
                    {hints.map((hint, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-1.5 text-[10px] leading-snug text-white/40"
                      >
                        <TriangleAlert className="mt-px h-3 w-3 shrink-0 text-amber-300/60" />
                        {hint}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
