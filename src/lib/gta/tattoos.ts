/**
 * GTA V ped-decoration (tattoo / overlay) zones, types and gender model.
 *
 * Tattoos are NOT clothing slots — they are fixed-UV ped decorations applied at
 * runtime via AddPedDecorationFromHashes(ped, joaat(collection), joaat(name)).
 * This module is the single source of truth for the authorable tattoo enums,
 * mirroring components.ts. The sidecar's TattooZones table (ProjectModel.cs) must
 * stay byte-identical to TATTOO_ZONES below — zone → overlay/shop/facing names.
 *
 * Only the six body zones (numeric enum 0-5) are authorable; ZONE_UNKNOWN=6 and
 * ZONE_NONE=7 are intentionally omitted (no sensible placement / shop facing).
 */

/** Internal tattoo zone ids — single source of truth for pack.atelier "zone" values. */
export const TATTOO_ZONE_IDS = [
  "torso",
  "head",
  "left_arm",
  "right_arm",
  "left_leg",
  "right_leg",
] as const;
export type TattooZoneId = (typeof TATTOO_ZONE_IDS)[number];

export const TATTOO_TYPE_IDS = ["tattoo", "badge"] as const;
export type TattooTypeId = (typeof TATTOO_TYPE_IDS)[number];

/** "both" = shared art applied to both freemode peds (one YTD, two gendered overlay names). */
export const TATTOO_GENDER_IDS = ["both", "male", "female"] as const;
export type TattooGenderId = (typeof TATTOO_GENDER_IDS)[number];

export interface TattooZone {
  /** Internal zone id, e.g. "torso" or "left_arm". */
  id: TattooZoneId;
  /** ZONE_* numeric enum value (build-time int). */
  zoneValue: number;
  /** Overlay XML <zone> name. */
  overlayName: string;
  /** shop_tattoo.meta <zone> name (PDZ_*). */
  shopZone: string;
  /** Default shop_tattoo.meta <eFacing> for this zone — the single source. */
  defaultFacing: string;
  /** German UI label. */
  label: string;
  /** lucide-react icon name (see icon map in the UI layer). */
  icon: string;
}

export const TATTOO_ZONES: TattooZone[] = [
  { id: "torso", zoneValue: 0, overlayName: "ZONE_TORSO", shopZone: "PDZ_TORSO", defaultFacing: "TATTOO_CHEST", label: "Torso", icon: "Shirt" },
  { id: "head", zoneValue: 1, overlayName: "ZONE_HEAD", shopZone: "PDZ_HEAD", defaultFacing: "TATTOO_FRONT", label: "Kopf", icon: "ScanFace" },
  { id: "left_arm", zoneValue: 2, overlayName: "ZONE_LEFT_ARM", shopZone: "PDZ_LEFT_ARM", defaultFacing: "TATTOO_LEFT", label: "Linker Arm", icon: "ArrowLeft" },
  { id: "right_arm", zoneValue: 3, overlayName: "ZONE_RIGHT_ARM", shopZone: "PDZ_RIGHT_ARM", defaultFacing: "TATTOO_RIGHT", label: "Rechter Arm", icon: "ArrowRight" },
  { id: "left_leg", zoneValue: 4, overlayName: "ZONE_LEFT_LEG", shopZone: "PDZ_LEFT_LEG", defaultFacing: "TATTOO_LEFT", label: "Linkes Bein", icon: "MoveDownLeft" },
  { id: "right_leg", zoneValue: 5, overlayName: "ZONE_RIGHT_LEG", shopZone: "PDZ_RIGHT_LEG", defaultFacing: "TATTOO_RIGHT", label: "Rechtes Bein", icon: "MoveDownRight" },
];

export interface TattooType {
  id: TattooTypeId;
  /** Overlay XML <type> name. */
  overlayName: string;
  /** German UI label. */
  label: string;
}

export const TATTOO_TYPES: TattooType[] = [
  { id: "tattoo", overlayName: "TYPE_TATTOO", label: "Tattoo" },
  { id: "badge", overlayName: "TYPE_BADGE", label: "Abzeichen" },
];

export function getTattooZone(id: string): TattooZone | undefined {
  return TATTOO_ZONES.find((z) => z.id === id);
}

export function isTattooZoneId(id: string): id is TattooZoneId {
  return (TATTOO_ZONE_IDS as readonly string[]).includes(id);
}

export function tattooTypeOverlayName(id: TattooTypeId): string {
  return id === "badge" ? "TYPE_BADGE" : "TYPE_TATTOO";
}
