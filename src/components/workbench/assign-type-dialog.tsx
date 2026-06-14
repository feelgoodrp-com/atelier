import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleHelp, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { baseName } from "@/lib/format";
import { GTA_COMPONENTS, GTA_PROPS, type SlotId } from "@/lib/gta/components";
import { finalizeDraft } from "@/lib/project/import-flow";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import type { Gender } from "@/lib/project/schema";

interface RowState {
  gender: Gender;
  type: SlotId | null;
}

/**
 * Asks for gender + slot of imported drawables whose file name could not be
 * classified. Opens automatically while workbench-store.pendingDrafts is
 * non-empty; canceling discards the drafts (copied files stay in assets/).
 */
export function AssignTypeDialog() {
  const { t } = useTranslation("workbench");
  const pendingDrafts = useWorkbenchStore((s) => s.pendingDrafts);
  const setPendingDrafts = useWorkbenchStore((s) => s.setPendingDrafts);
  const addDrawable = useProjectStore((s) => s.addDrawable);

  const [rows, setRows] = useState<RowState[]>([]);

  useEffect(() => {
    setRows(
      pendingDrafts.map((d) => ({
        gender: d.draft.gender,
        type: d.draft.type,
      })),
    );
  }, [pendingDrafts]);

  if (pendingDrafts.length === 0) return null;

  const allTyped = rows.length > 0 && rows.every((r) => r.type !== null);

  const confirm = () => {
    if (!allTyped) return;
    let added = 0;
    pendingDrafts.forEach((imported, i) => {
      const row = rows[i];
      if (!row?.type) return;
      addDrawable(finalizeDraft(imported.draft, row.type, row.gender));
      added++;
    });
    setPendingDrafts([]);
    toast.success(t("assignType.addedToast", { count: added }));
  };

  const cancel = () => {
    setPendingDrafts([]);
    toast.info(t("assignType.cancelledTitle"), {
      description: t("assignType.cancelledDescription"),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="liquid-glass max-h-[80vh] border-white/15 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <CircleHelp className="h-4 w-4 text-[#7289DA]" />
            {t("assignType.title")}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {pendingDrafts.length === 1
              ? t("assignType.descriptionOne")
              : t("assignType.descriptionMany", {
                  count: pendingDrafts.length,
                })}{" "}
            {t("assignType.descriptionSuffix")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh]">
          <div className="flex flex-col gap-2 pr-3">
            {pendingDrafts.map((imported, i) => (
              <div
                key={imported.draft.id}
                className="glass-border-subtle flex items-center gap-2 rounded-[10px] p-2.5"
              >
                <span
                  className="min-w-0 flex-1 truncate text-sm text-white/85"
                  title={imported.draft.ydd?.path ?? imported.draft.label}
                >
                  {imported.draft.ydd
                    ? baseName(imported.draft.ydd.path)
                    : imported.draft.label}
                </span>
                <Select
                  value={rows[i]?.gender ?? "male"}
                  onValueChange={(v) =>
                    setRows((prev) =>
                      prev.map((r, j) =>
                        j === i ? { ...r, gender: v as Gender } : r,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-24 border-white/15 bg-white/5 font-mono text-xs text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">mp_m</SelectItem>
                    <SelectItem value="female">mp_f</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={rows[i]?.type ?? undefined}
                  onValueChange={(v) =>
                    setRows((prev) =>
                      prev.map((r, j) =>
                        j === i ? { ...r, type: v as SlotId } : r,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-40 border-white/15 bg-white/5 text-xs text-white">
                    <SelectValue placeholder={t("assignType.selectSlot")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{t("assignType.components")}</SelectLabel>
                      {GTA_COMPONENTS.map((slot) => (
                        <SelectItem key={slot.id} value={slot.id}>
                          {t(`slot.${slot.id}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>{t("assignType.props")}</SelectLabel>
                      {GTA_PROPS.map((slot) => (
                        <SelectItem key={slot.id} value={slot.id}>
                          {t(`slot.${slot.id}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            {t("common:cancel")}
          </Button>
          <Button disabled={!allTyped} onClick={confirm}>
            <Plus className="h-4 w-4" />
            {t("assignType.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
