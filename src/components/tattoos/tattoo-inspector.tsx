/**
 * Right panel of the tattoos screen: edits the selected tattoo(s). Single
 * selection shows everything (incl. derived build identity + an experimental
 * placement block); a multi-selection only exposes the safe bulk setters.
 * Tattoos are fixed-UV decals, so there is no placement canvas — just metadata.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  TATTOO_TYPES,
  TATTOO_ZONES,
  getTattooZone,
  type TattooGenderId,
} from "@/lib/gta/tattoos";
import type { ProjectTattoo, TattooPlacement } from "@/lib/project/schema";
import {
  selectDerivedTattooBuild,
  selectTattoosByZone,
  useProjectStore,
} from "@/lib/stores/project-store";
import { useTattooWorkbenchStore } from "@/lib/stores/tattoo-workbench-store";
import { ZoneFigure } from "./zone-figure";
import { TattooThumb } from "./tattoo-thumb";

const FACINGS = [
  "TATTOO_BACK",
  "TATTOO_CHEST",
  "TATTOO_FRONT",
  "TATTOO_FRONT_LEFT",
  "TATTOO_FRONT_RIGHT",
  "TATTOO_LEFT",
  "TATTOO_RIGHT",
  "TATTOO_STOMACH",
];

const DEFAULT_PLACEMENT: TattooPlacement = {
  uvPosX: 0,
  uvPosY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-white/55">{label}</Label>
      {children}
    </div>
  );
}

const triggerClass = "h-8 border-white/10 bg-white/5 text-xs text-white";
const inputClass = "h-8 border-white/10 bg-white/5 text-xs text-white";

function SingleInspector({ tattoo }: { tattoo: ProjectTattoo }) {
  const { t } = useTranslation("tattoos");
  const project = useProjectStore((s) => s.project)!;
  const updateTattoo = useProjectStore((s) => s.updateTattoo);
  const removeTattoos = useProjectStore((s) => s.removeTattoos);
  const reorderTattoo = useProjectStore((s) => s.reorderTattoo);
  const setSelection = useTattooWorkbenchStore((s) => s.setSelection);

  const derived = useMemo(() => selectDerivedTattooBuild(project), [project]);
  const build = derived[tattoo.id];

  const zoneBucket = selectTattoosByZone(project, tattoo.zone);
  const indexInZone = zoneBucket.findIndex((tt) => tt.id === tattoo.id);

  const wantsMale = tattoo.gender === "both" || tattoo.gender === "male";
  const wantsFemale = tattoo.gender === "both" || tattoo.gender === "female";

  const patch = (p: Partial<Omit<ProjectTattoo, "id">>) => updateTattoo(tattoo.id, p);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Preview row: decal + zone figure */}
      <div className="flex gap-3">
        <TattooThumb image={tattoo.image} className="h-28 w-28 shrink-0" />
        <div className="h-28 flex-1">
          <ZoneFigure
            activeZone={tattoo.zone}
            onSelectZone={(zone) => patch({ zone })}
          />
        </div>
      </div>

      <Field label={t("inspector.label")}>
        <Input
          value={tattoo.label}
          onChange={(e) => patch({ label: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label={t("inspector.zone")}>
        <Select value={tattoo.zone} onValueChange={(v) => patch({ zone: v as ProjectTattoo["zone"] })}>
          <SelectTrigger className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TATTOO_ZONES.map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label={t("inspector.gender")}>
        <Select
          value={tattoo.gender}
          onValueChange={(v) => patch({ gender: v as TattooGenderId })}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">{t("gender.both")}</SelectItem>
            <SelectItem value="male">{t("gender.male")}</SelectItem>
            <SelectItem value="female">{t("gender.female")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label={t("inspector.type")}>
        <Select value={tattoo.type} onValueChange={(v) => patch({ type: v as ProjectTattoo["type"] })}>
          <SelectTrigger className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TATTOO_TYPES.map((ty) => (
              <SelectItem key={ty.id} value={ty.id}>
                {ty.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {wantsMale && (
        <Field label={t("inspector.nameMale")}>
          <Input
            value={tattoo.nameMale ?? ""}
            placeholder={build?.nameMale ?? ""}
            onChange={(e) => patch({ nameMale: e.target.value.trim() === "" ? null : e.target.value })}
            className={cn(inputClass, "font-mono")}
          />
        </Field>
      )}
      {wantsFemale && (
        <Field label={t("inspector.nameFemale")}>
          <Input
            value={tattoo.nameFemale ?? ""}
            placeholder={build?.nameFemale ?? ""}
            onChange={(e) => patch({ nameFemale: e.target.value.trim() === "" ? null : e.target.value })}
            className={cn(inputClass, "font-mono")}
          />
        </Field>
      )}

      <Field label={t("inspector.garment")}>
        <Input
          value={tattoo.garment}
          onChange={(e) => patch({ garment: e.target.value })}
          className={inputClass}
        />
      </Field>

      {/* Draw order within zone */}
      <Field label={t("inspector.drawOrder")}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-white/45">
            {indexInZone + 1} / {zoneBucket.length}
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              disabled={indexInZone <= 0}
              onClick={() => reorderTattoo(tattoo.id, indexInZone - 1)}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              disabled={indexInZone >= zoneBucket.length - 1}
              onClick={() => reorderTattoo(tattoo.id, indexInZone + 1)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Field>

      <Separator className="bg-white/8" />

      {/* Shop section */}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
        {t("inspector.shopSection")}
      </p>
      <Field label={t("inspector.cost")}>
        <Input
          type="number"
          min={0}
          value={tattoo.cost}
          onChange={(e) => patch({ cost: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          className={inputClass}
        />
      </Field>
      <Field label={t("inspector.textLabel")}>
        <Input
          value={tattoo.textLabel}
          onChange={(e) => patch({ textLabel: e.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label={t("inspector.facing")}>
        <Select
          value={tattoo.eFacing ?? "__default__"}
          onValueChange={(v) => patch({ eFacing: v === "__default__" ? null : v })}
        >
          <SelectTrigger className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">
              {t("inspector.facingDefault", { facing: getTattooZone(tattoo.zone)?.defaultFacing ?? "" })}
            </SelectItem>
            {FACINGS.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Separator className="bg-white/8" />

      {/* Derived build identity (read-only) */}
      <div className="rounded-[8px] bg-white/[0.03] p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
          {t("inspector.buildSection")}
        </p>
        <dl className="mt-1.5 space-y-1 font-mono text-[10px] text-white/45">
          <div className="flex justify-between gap-2">
            <dt className="text-white/30">YTD</dt>
            <dd className="truncate">{build?.ytdFileName}.ytd</dd>
          </div>
          {build?.nameMale && (
            <div className="flex justify-between gap-2">
              <dt className="text-white/30">M</dt>
              <dd className="truncate">{build.nameMale}</dd>
            </div>
          )}
          {build?.nameFemale && (
            <div className="flex justify-between gap-2">
              <dt className="text-white/30">F</dt>
              <dd className="truncate">{build.nameFemale}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Experimental placement */}
      <PlacementBlock tattoo={tattoo} onChange={(placement) => patch({ placement })} />

      <Separator className="bg-white/8" />

      <Button
        variant="outline"
        size="sm"
        className="border-red-500/30 text-red-300 hover:bg-red-500/10"
        onClick={() => {
          removeTattoos([tattoo.id]);
          setSelection([]);
        }}
      >
        <Trash2 className="h-4 w-4" />
        {t("inspector.delete")}
      </Button>
    </div>
  );
}

function PlacementBlock({
  tattoo,
  onChange,
}: {
  tattoo: ProjectTattoo;
  onChange: (placement: TattooPlacement | null) => void;
}) {
  const { t } = useTranslation("tattoos");
  const p = tattoo.placement;
  const set = (key: keyof TattooPlacement, value: number) =>
    onChange({ ...(p ?? DEFAULT_PLACEMENT), [key]: value });

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35 hover:text-white/55">
        <ChevronDown className="h-3 w-3" />
        {t("inspector.placementSection")}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="flex items-center justify-between gap-2 rounded-[8px] bg-white/[0.03] px-2.5 py-2">
          <span className="text-xs text-white/55">{t("inspector.placementEnable")}</span>
          <Switch
            checked={p !== null}
            onCheckedChange={(on) => onChange(on ? DEFAULT_PLACEMENT : null)}
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-amber-300/70">
          {t("inspector.placementWarning")}
        </p>
        {p && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ["uvPosX", "UV X"],
                ["uvPosY", "UV Y"],
                ["scaleX", "Scale X"],
                ["scaleY", "Scale Y"],
                ["rotation", "Rotation"],
              ] as Array<[keyof TattooPlacement, string]>
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  type="number"
                  step="0.01"
                  value={p[key]}
                  onChange={(e) => set(key, Number(e.target.value) || 0)}
                  className={inputClass}
                />
              </Field>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function MultiInspector({ ids }: { ids: string[] }) {
  const { t } = useTranslation("tattoos");
  const updateTattoo = useProjectStore((s) => s.updateTattoo);
  const removeTattoos = useProjectStore((s) => s.removeTattoos);
  const setSelection = useTattooWorkbenchStore((s) => s.setSelection);

  const patchAll = (p: Partial<Omit<ProjectTattoo, "id">>) => {
    for (const id of ids) updateTattoo(id, p);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm text-white/70">{t("inspector.multi", { count: ids.length })}</p>

      <Field label={t("inspector.zone")}>
        <Select onValueChange={(v) => patchAll({ zone: v as ProjectTattoo["zone"] })}>
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={t("inspector.bulkPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {TATTOO_ZONES.map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label={t("inspector.gender")}>
        <Select onValueChange={(v) => patchAll({ gender: v as TattooGenderId })}>
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={t("inspector.bulkPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">{t("gender.both")}</SelectItem>
            <SelectItem value="male">{t("gender.male")}</SelectItem>
            <SelectItem value="female">{t("gender.female")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label={t("inspector.type")}>
        <Select onValueChange={(v) => patchAll({ type: v as ProjectTattoo["type"] })}>
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={t("inspector.bulkPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {TATTOO_TYPES.map((ty) => (
              <SelectItem key={ty.id} value={ty.id}>
                {ty.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Separator className="bg-white/8" />

      <Button
        variant="outline"
        size="sm"
        className="border-red-500/30 text-red-300 hover:bg-red-500/10"
        onClick={() => {
          removeTattoos(ids);
          setSelection([]);
        }}
      >
        <Trash2 className="h-4 w-4" />
        {t("inspector.deleteMany", { count: ids.length })}
      </Button>
    </div>
  );
}

export function TattooInspector() {
  const { t } = useTranslation("tattoos");
  const project = useProjectStore((s) => s.project);
  const selection = useTattooWorkbenchStore((s) => s.selection);

  // Only keep ids that still exist (selection may outlive a delete).
  const present = useMemo(() => {
    const set = new Set(project?.tattoos.map((tt) => tt.id) ?? []);
    return selection.filter((id) => set.has(id));
  }, [project, selection]);

  const single = present.length === 1 ? project?.tattoos.find((tt) => tt.id === present[0]) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-white/8 px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
          {t("inspector.title")}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {single ? (
          <SingleInspector tattoo={single} />
        ) : present.length > 1 ? (
          <MultiInspector ids={present} />
        ) : (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="h-24 w-16 opacity-40">
              <ZoneFigure activeZone={null} />
            </div>
            <p className="mt-3 text-xs text-white/40">{t("inspector.noSelection")}</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
