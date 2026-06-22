/**
 * Right-click menu for tattoo cards. Acts on the current grid selection when
 * the right-clicked card is part of a multi-selection, otherwise on just that
 * card (mirrors the clothing drawable-list pattern). Targets are resolved from
 * the live store at click time so the on-open selection fix is always applied.
 */

import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Copy, MapPin, Trash2, Users } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  TATTOO_ZONES,
  type TattooGenderId,
  type TattooZoneId,
} from "@/lib/gta/tattoos";
import { createTattoo, type ProjectTattoo } from "@/lib/project/schema";
import { useProjectStore } from "@/lib/stores/project-store";
import { useTattooWorkbenchStore } from "@/lib/stores/tattoo-workbench-store";

export function TattooContextMenu({
  tattoo,
  children,
}: {
  tattoo: ProjectTattoo;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("tattoos");
  const project = useProjectStore((s) => s.project);
  const addTattoo = useProjectStore((s) => s.addTattoo);
  const updateTattoo = useProjectStore((s) => s.updateTattoo);
  const removeTattoos = useProjectStore((s) => s.removeTattoos);
  const assignTattooGroup = useProjectStore((s) => s.assignTattooGroup);
  const setSelection = useTattooWorkbenchStore((s) => s.setSelection);

  /** Selection if this card is part of a multi-selection, else just this card. */
  const resolveTargets = (): string[] => {
    const sel = useTattooWorkbenchStore.getState().selection;
    return sel.includes(tattoo.id) && sel.length > 1 ? sel : [tattoo.id];
  };

  const onOpenChange = (open: boolean) => {
    if (!open) return;
    const sel = useTattooWorkbenchStore.getState().selection;
    if (!sel.includes(tattoo.id)) setSelection([tattoo.id]);
  };

  const duplicate = () => {
    const byId = new Map((project?.tattoos ?? []).map((tt) => [tt.id, tt]));
    const copies: string[] = [];
    for (const id of resolveTargets()) {
      const src = byId.get(id);
      if (!src) continue;
      const copy = createTattoo({
        label: `${src.label} ${t("context.copySuffix")}`.trim(),
        zone: src.zone,
        gender: src.gender,
        type: src.type,
        garment: src.garment,
        textLabel: src.textLabel,
        eFacing: src.eFacing,
        cost: src.cost,
        image: src.image,
        // names left null on purpose → re-derived to fresh unique overlay names.
      });
      addTattoo(copy);
      copies.push(copy.id);
    }
    if (copies.length > 0) setSelection(copies);
  };

  const setZone = (zone: TattooZoneId) =>
    resolveTargets().forEach((id) => updateTattoo(id, { zone }));
  const setGender = (gender: TattooGenderId) =>
    resolveTargets().forEach((id) => updateTattoo(id, { gender }));
  const assign = (groupId: string | null) =>
    assignTattooGroup(resolveTargets(), groupId);
  const remove = () => {
    removeTattoos(resolveTargets());
    setSelection([]);
  };

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={duplicate}>
          <Copy className="h-4 w-4" />
          {t("context.duplicate")}
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <MapPin className="mr-2 h-4 w-4" />
            {t("context.setZone")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {TATTOO_ZONES.map((z) => (
              <ContextMenuItem key={z.id} onClick={() => setZone(z.id)}>
                {z.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            {t("context.setGender")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            <ContextMenuItem onClick={() => setGender("both")}>
              {t("gender.both")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setGender("male")}>
              {t("gender.male")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setGender("female")}>
              {t("gender.female")}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {(project?.groups.length ?? 0) > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Users className="mr-2 h-4 w-4" />
              {t("context.assignGroup")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              {(project?.groups ?? []).map((g) => (
                <ContextMenuItem key={g.id} onClick={() => assign(g.id)}>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: g.color }}
                  />
                  {g.name}
                </ContextMenuItem>
              ))}
              <ContextMenuItem onClick={() => assign(null)}>
                {t("context.noGroup")}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={remove}>
          <Trash2 className="h-4 w-4" />
          {t("context.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
