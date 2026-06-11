/**
 * GTA V ped component + prop slots.
 *
 * componentId mapping follows the native order also used in
 * creative/lib/server/cloth-shop-meta.ts (PV_COMP_*):
 *   0 head, 1 berd, 2 hair, 3 uppr, 4 lowr, 5 hand,
 *   6 feet, 7 teef, 8 accs, 9 task, 10 decl, 11 jbib
 * Prop anchors: 0 p_head, 1 p_eyes, 2 p_ears, 6 p_lwrist, 7 p_rwrist, 8 p_hip.
 */

export type SlotKind = "component" | "prop";

/** Internal slot ids — single source of truth for pack.atelier "type" values. */
export const COMPONENT_SLOT_IDS = [
  "head",
  "berd",
  "hair",
  "uppr",
  "lowr",
  "hand",
  "feet",
  "teef",
  "accs",
  "task",
  "decl",
  "jbib",
] as const;

export const PROP_SLOT_IDS = [
  "p_head",
  "p_eyes",
  "p_ears",
  "p_lwrist",
  "p_rwrist",
  "p_hip",
] as const;

export const ALL_SLOT_IDS = [...COMPONENT_SLOT_IDS, ...PROP_SLOT_IDS] as const;

export type ComponentSlotId = (typeof COMPONENT_SLOT_IDS)[number];
export type PropSlotId = (typeof PROP_SLOT_IDS)[number];
export type SlotId = ComponentSlotId | PropSlotId;

export function isComponentSlotId(id: string): id is ComponentSlotId {
  return (COMPONENT_SLOT_IDS as readonly string[]).includes(id);
}

export function isPropSlotId(id: string): id is PropSlotId {
  return (PROP_SLOT_IDS as readonly string[]).includes(id);
}

export interface GtaSlot {
  /** Internal slot id, e.g. "uppr" or "p_head". */
  id: SlotId;
  kind: SlotKind;
  /** Native componentId (components) or anchor id (props). */
  componentId: number;
  /** PV_COMP_* / ANCHOR_* native name. */
  nativeName: string;
  /** German UI label. */
  label: string;
  /** lucide-react icon name (see icon map in the UI layer). */
  icon: string;
}

export const GTA_COMPONENTS: GtaSlot[] = [
  { id: "head", kind: "component", componentId: 0, nativeName: "PV_COMP_HEAD", label: "Kopf", icon: "ScanFace" },
  { id: "berd", kind: "component", componentId: 1, nativeName: "PV_COMP_BERD", label: "Masken / Bärte", icon: "VenetianMask" },
  { id: "hair", kind: "component", componentId: 2, nativeName: "PV_COMP_HAIR", label: "Haare", icon: "Scissors" },
  { id: "uppr", kind: "component", componentId: 3, nativeName: "PV_COMP_UPPR", label: "Oberkörper / Arme", icon: "PersonStanding" },
  { id: "lowr", kind: "component", componentId: 4, nativeName: "PV_COMP_LOWR", label: "Hosen", icon: "RectangleVertical" },
  { id: "hand", kind: "component", componentId: 5, nativeName: "PV_COMP_HAND", label: "Taschen / Fallschirme", icon: "Backpack" },
  { id: "feet", kind: "component", componentId: 6, nativeName: "PV_COMP_FEET", label: "Schuhe", icon: "Footprints" },
  { id: "teef", kind: "component", componentId: 7, nativeName: "PV_COMP_TEEF", label: "Ketten / Schals", icon: "Link" },
  { id: "accs", kind: "component", componentId: 8, nativeName: "PV_COMP_ACCS", label: "Unterhemden", icon: "Shirt" },
  { id: "task", kind: "component", componentId: 9, nativeName: "PV_COMP_TASK", label: "Westen", icon: "Shield" },
  { id: "decl", kind: "component", componentId: 10, nativeName: "PV_COMP_DECL", label: "Sticker / Abzeichen", icon: "Sticker" },
  { id: "jbib", kind: "component", componentId: 11, nativeName: "PV_COMP_JBIB", label: "Jacken / Oberteile", icon: "Layers" },
];

export const GTA_PROPS: GtaSlot[] = [
  { id: "p_head", kind: "prop", componentId: 0, nativeName: "ANCHOR_HEAD", label: "Hüte / Helme", icon: "HardHat" },
  { id: "p_eyes", kind: "prop", componentId: 1, nativeName: "ANCHOR_EYES", label: "Brillen", icon: "Glasses" },
  { id: "p_ears", kind: "prop", componentId: 2, nativeName: "ANCHOR_EARS", label: "Ohrringe", icon: "Ear" },
  { id: "p_lwrist", kind: "prop", componentId: 6, nativeName: "ANCHOR_LEFT_WRIST", label: "Uhren", icon: "Watch" },
  { id: "p_rwrist", kind: "prop", componentId: 7, nativeName: "ANCHOR_RIGHT_WRIST", label: "Armbänder", icon: "Gem" },
  { id: "p_hip", kind: "prop", componentId: 8, nativeName: "ANCHOR_HIP", label: "Hüft-Accessoires", icon: "Anchor" },
];

export const ALL_SLOTS: GtaSlot[] = [...GTA_COMPONENTS, ...GTA_PROPS];

export function getSlotById(id: string): GtaSlot | undefined {
  return ALL_SLOTS.find((slot) => slot.id === id);
}
