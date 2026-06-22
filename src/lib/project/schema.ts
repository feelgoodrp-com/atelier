/**
 * Zod schema for the `pack.atelier` project file (fgcloth v1).
 *
 * Shape is the shared contract between app, sidecar and atelier-api — keep in
 * sync with the Phase-1 contract documentation. Notably the in-game drawableId
 * is NOT stored: it derives from the array index within the (gender, type,
 * mode) bucket at build time (see lib/stores/project-store.ts selectors).
 */

import { z } from "zod";
import {
  ALL_SLOT_IDS,
  isComponentSlotId,
  isPropSlotId,
  type SlotId,
} from "@/lib/gta/components";
import {
  TATTOO_GENDER_IDS,
  TATTOO_TYPE_IDS,
  TATTOO_ZONE_IDS,
  type TattooGenderId,
  type TattooTypeId,
  type TattooZoneId,
} from "@/lib/gta/tattoos";

// Re-exported so project code can import everything from one place.
export type { ComponentSlotId, PropSlotId, SlotId } from "@/lib/gta/components";
export type {
  TattooGenderId,
  TattooTypeId,
  TattooZoneId,
} from "@/lib/gta/tattoos";

// fgcloth v2 added the tattoo-authoring model (tattooCollection + tattoos[]);
// v1 projects are lifted in migrations.ts (additive: empty tattoos array).
export const PROJECT_FILE_VERSION = 2;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const genderSchema = z.enum(["male", "female"]);
export type Gender = z.infer<typeof genderSchema>;

export const drawableKindSchema = z.enum(["component", "prop"]);
export type DrawableKind = z.infer<typeof drawableKindSchema>;

export const drawableModeSchema = z.enum(["addon", "replace"]);
export type DrawableMode = z.infer<typeof drawableModeSchema>;

export const slotIdSchema = z.enum(ALL_SLOT_IDS);

const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "muss ein SHA-256-Hex-Hash sein");

/** Local file reference inside the project folder (forward-slash relative path). */
export const assetRefSchema = z.object({
  path: z.string().min(1),
  hash: sha256HexSchema,
  size: z.number().int().nonnegative(),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

export const projectGroupSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  color: z.string(),
});
export type ProjectGroup = z.infer<typeof projectGroupSchema>;

// ---------------------------------------------------------------------------
// Drawable
// ---------------------------------------------------------------------------

export const drawableFlagsSchema = z.object({
  highHeels: z.boolean(),
  hairScaleValue: z.number().nullable(),
});
export type DrawableFlags = z.infer<typeof drawableFlagsSchema>;

export const projectDrawableSchema = z
  .object({
    id: z.uuid(),
    gender: genderSchema,
    kind: drawableKindSchema,
    type: slotIdSchema,
    mode: drawableModeSchema,
    replaceTargetId: z.number().int().nonnegative().nullable(),
    label: z.string(),
    groupId: z.uuid().nullable(),
    ydd: assetRefSchema.nullable(),
    textures: z.array(assetRefSchema).max(26),
    physics: assetRefSchema.nullable(),
    firstPerson: assetRefSchema.nullable(),
    flags: drawableFlagsSchema,
  })
  .superRefine((drawable, ctx) => {
    if (drawable.kind === "component" && !isComponentSlotId(drawable.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: `"${drawable.type}" ist kein Komponenten-Slot`,
      });
    }
    if (drawable.kind === "prop" && !isPropSlotId(drawable.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: `"${drawable.type}" ist kein Prop-Slot`,
      });
    }
    if (drawable.mode === "replace" && drawable.replaceTargetId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["replaceTargetId"],
        message: "Replace-Drawables brauchen ein replaceTargetId",
      });
    }
  });
export type ProjectDrawable = z.infer<typeof projectDrawableSchema>;

// ---------------------------------------------------------------------------
// Tattoo (ped decoration / overlay)
// ---------------------------------------------------------------------------
//
// Unlike drawables, a tattoo is a fixed-UV decal: one source image, no ydd, no
// texture variants, no in-game drawableId. Its build identity is the derived
// YTD file name (txdHash == txtHash == file name — a hard engine rule) plus the
// per-gender overlay nameHash. See lib/stores/project-store.ts
// (selectDerivedTattooBuild) for the deterministic naming.

/** Overlay nameHash charset (joaat'd at runtime; must be filename-safe). */
const overlayNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_]+$/, "nur Buchstaben, Ziffern und _");

/** Authoring-time placement hints (uvPos/scale/rotation). Effect unconfirmed. */
export const tattooPlacementSchema = z.object({
  uvPosX: z.number(),
  uvPosY: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  rotation: z.number(),
});
export type TattooPlacement = z.infer<typeof tattooPlacementSchema>;

export const projectTattooSchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    groupId: z.uuid().nullable(),

    zone: z.enum(TATTOO_ZONE_IDS),
    type: z.enum(TATTOO_TYPE_IDS),
    gender: z.enum(TATTOO_GENDER_IDS),

    // Explicit overlay names; null => derive `<ytd>_M` / `<ytd>_F` at build time.
    nameMale: overlayNameSchema.nullable(),
    nameFemale: overlayNameSchema.nullable(),

    // One decal image; no ydd, no texture variants.
    image: assetRefSchema.nullable(),

    // Stored, editable shop/overlay fields (only collection+preset are
    // load-bearing at runtime; the rest are shop cosmetics).
    garment: z.string().default("All"),
    textLabel: z.string().default(""),
    eFacing: z.string().nullable(), // null => derive from zone.defaultFacing
    cost: z.number().int().nonnegative().default(0),

    placement: tattooPlacementSchema.nullable(), // optional; effect unconfirmed
  })
  .superRefine((t, ctx) => {
    if ((t.gender === "both" || t.gender === "male") && !t.nameMale) {
      ctx.addIssue({
        code: "custom",
        path: ["nameMale"],
        message: "Männlicher Overlay-Name erforderlich",
      });
    }
    if ((t.gender === "both" || t.gender === "female") && !t.nameFemale) {
      ctx.addIssue({
        code: "custom",
        path: ["nameFemale"],
        message: "Weiblicher Overlay-Name erforderlich",
      });
    }
  });
export type ProjectTattoo = z.infer<typeof projectTattooSchema>;

/** One shared overlay collection per pack (name derived from dlcName). */
export const tattooCollectionSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/, "nur Kleinbuchstaben, Ziffern und _"),
  label: z.string(),
});
export type TattooCollection = z.infer<typeof tattooCollectionSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const projectSettingsSchema = z.object({
  dlcName: z.string(),
  defaultGender: genderSchema,
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const projectSyncSchema = z.object({
  remoteProjectId: z.string().nullable(),
  baseRevision: z.number().int().nullable(),
  lastSyncedAt: z.iso.datetime().nullable(),
});
export type ProjectSync = z.infer<typeof projectSyncSchema>;

export const atelierProjectSchema = z.object({
  fgcloth: z.literal(PROJECT_FILE_VERSION),
  id: z.uuid(),
  name: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  settings: projectSettingsSchema,
  groups: z.array(projectGroupSchema),
  drawables: z.array(projectDrawableSchema),
  tattooCollection: tattooCollectionSchema,
  tattoos: z.array(projectTattooSchema),
  sync: projectSyncSchema,
});
export type AtelierProject = z.infer<typeof atelierProjectSchema>;

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** Derives a `[a-z0-9_]` DLC name suggestion from the project name. */
export function suggestDlcName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "atelier_pack";
}

export function createEmptyProject(name: string): AtelierProject {
  const now = new Date().toISOString();
  const dlcName = suggestDlcName(name);
  return {
    fgcloth: PROJECT_FILE_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { dlcName, defaultGender: "male" },
    groups: [],
    drawables: [],
    tattooCollection: { name: dlcName, label: "Tattoos" },
    tattoos: [],
    sync: { remoteProjectId: null, baseRevision: null, lastSyncedAt: null },
  };
}

export interface CreateDrawableInput {
  gender: Gender;
  kind: DrawableKind;
  type: SlotId;
  label: string;
  mode?: DrawableMode;
  replaceTargetId?: number | null;
  groupId?: string | null;
  ydd?: AssetRef | null;
  textures?: AssetRef[];
  physics?: AssetRef | null;
  firstPerson?: AssetRef | null;
  flags?: Partial<DrawableFlags>;
}

export function createDrawable(input: CreateDrawableInput): ProjectDrawable {
  return {
    id: crypto.randomUUID(),
    gender: input.gender,
    kind: input.kind,
    type: input.type,
    mode: input.mode ?? "addon",
    replaceTargetId: input.replaceTargetId ?? null,
    label: input.label,
    groupId: input.groupId ?? null,
    ydd: input.ydd ?? null,
    textures: input.textures ?? [],
    physics: input.physics ?? null,
    firstPerson: input.firstPerson ?? null,
    flags: {
      highHeels: input.flags?.highHeels ?? false,
      hairScaleValue: input.flags?.hairScaleValue ?? null,
    },
  };
}

export interface CreateTattooInput {
  label: string;
  zone: TattooZoneId;
  gender?: TattooGenderId;
  type?: TattooTypeId;
  nameMale?: string | null;
  nameFemale?: string | null;
  image?: AssetRef | null;
  groupId?: string | null;
  garment?: string;
  textLabel?: string;
  eFacing?: string | null;
  cost?: number;
}

export function createTattoo(input: CreateTattooInput): ProjectTattoo {
  return {
    id: crypto.randomUUID(),
    label: input.label,
    groupId: input.groupId ?? null,
    zone: input.zone,
    type: input.type ?? "tattoo",
    gender: input.gender ?? "both",
    nameMale: input.nameMale ?? null,
    nameFemale: input.nameFemale ?? null,
    image: input.image ?? null,
    garment: input.garment ?? "All",
    textLabel: input.textLabel ?? "",
    eFacing: input.eFacing ?? null,
    cost: input.cost ?? 0,
    placement: null,
  };
}
