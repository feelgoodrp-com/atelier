import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSlotById } from "@/lib/gta/components";
import {
  selectDerivedDrawableIds,
  selectDuplicateYddMap,
  useProjectStore,
} from "@/lib/stores/project-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";

interface DuplicatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Groups of drawables that share the exact same ydd hash. */
export function DuplicatesDialog({ open, onOpenChange }: DuplicatesDialogProps) {
  const { t } = useTranslation("workbench");
  const project = useProjectStore((s) => s.project);
  const setSelection = useProjectStore((s) => s.setSelection);
  const removeDrawables = useProjectStore((s) => s.removeDrawables);
  const setViewGender = useWorkbenchStore((s) => s.setViewGender);
  const setCategory = useWorkbenchStore((s) => s.setCategory);
  const setSearch = useWorkbenchStore((s) => s.setSearch);
  const requestScrollTo = useWorkbenchStore((s) => s.requestScrollTo);

  const groups = useMemo(() => {
    if (!project) return [];
    const duplicateMap = selectDuplicateYddMap(project);
    const derivedIds = selectDerivedDrawableIds(project);
    const byId = new Map(project.drawables.map((d) => [d.id, d]));
    return Object.entries(duplicateMap).map(([hash, ids]) => ({
      hash,
      drawables: ids
        .map((id) => byId.get(id))
        .filter((d): d is NonNullable<typeof d> => d !== undefined)
        .map((d) => ({ drawable: d, derivedId: derivedIds[d.id] ?? 0 })),
    }));
  }, [project]);

  const jumpTo = (drawableId: string) => {
    const drawable = project?.drawables.find((d) => d.id === drawableId);
    if (!drawable) return;
    setViewGender(drawable.gender);
    setCategory(drawable.type);
    setSearch("");
    setSelection([drawableId]);
    requestScrollTo(drawableId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="liquid-glass max-h-[80vh] border-white/15 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-white">{t("duplicatesDialog.title")}</DialogTitle>
          <DialogDescription className="text-white/50">
            {t("duplicatesDialog.description")}
          </DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/40">
            {t("duplicatesDialog.noDuplicates")}
          </p>
        ) : (
          <ScrollArea className="max-h-[55vh]">
            <div className="flex flex-col gap-4 pr-3">
              {groups.map((group) => (
                <div
                  key={group.hash}
                  className="glass-border-subtle rounded-[10px] p-3"
                >
                  <p className="mb-2 font-mono text-[10px] text-white/35">
                    sha256: {group.hash.slice(0, 16)}… ·{" "}
                    {t("duplicatesDialog.drawablesCount", {
                      count: group.drawables.length,
                    })}
                  </p>
                  <div className="flex flex-col gap-1">
                    {group.drawables.map(({ drawable, derivedId }) => (
                      <div
                        key={drawable.id}
                        className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 hover:bg-white/5"
                      >
                        <span className="font-mono text-xs text-[#7289DA]">
                          {String(derivedId).padStart(3, "0")}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-white/85">
                          {drawable.label}
                        </span>
                        <Badge
                          variant="outline"
                          className="border-white/15 font-mono text-[10px] text-white/50"
                        >
                          {drawable.gender === "male" ? "mp_m" : "mp_f"} ·{" "}
                          {getSlotById(drawable.type)
                            ? t(`slot.${drawable.type}`)
                            : drawable.type}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-white/40 hover:text-white"
                          title={t("duplicatesDialog.showInWorkbench")}
                          onClick={() => jumpTo(drawable.id)}
                        >
                          <Crosshair className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-white/40 hover:text-red-400"
                          title={t("duplicatesDialog.deleteDrawable")}
                          onClick={() => removeDrawables([drawable.id])}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
