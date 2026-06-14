import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
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
import { resolveRecovery, type PendingRecovery } from "@/lib/project/session";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface RecoveryDialogProps {
  recovery: PendingRecovery | null;
  /** Called after the prompt is resolved (or dismissed). */
  onClose: () => void;
}

/**
 * Recovery prompt shown when a project folder contains an autosave snapshot
 * that is newer than the saved pack.atelier (e.g. after a crash).
 */
export function RecoveryDialog({ recovery, onClose }: RecoveryDialogProps) {
  const { t, i18n } = useTranslation("dialogs");
  const [busy, setBusy] = useState(false);

  const resolve = async (restore: boolean) => {
    if (!recovery) return;
    setBusy(true);
    try {
      await resolveRecovery(recovery, restore);
      if (restore) toast.success(t("recovery.restored"));
      onClose();
    } catch (e) {
      toast.error(t("recovery.restoreError"), {
        description: errorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={recovery !== null}
      onOpenChange={(open) => {
        // Closing via Escape/X counts as "Verwerfen" is too destructive —
        // just dismiss the prompt without touching anything.
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="liquid-glass border-white/15 sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-[10px] bg-amber-500/15">
            <History className="h-5 w-5 text-amber-300" />
          </div>
          <DialogTitle className="text-white">
            {t("recovery.title")}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {recovery
              ? t("recovery.description", {
                  name: recovery.saved.name,
                  date: recovery.autosave.savedAt.toLocaleString(i18n.language),
                })
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void resolve(false)}
          >
            {t("recovery.discard")}
          </Button>
          <Button disabled={busy} onClick={() => void resolve(true)}>
            {t("recovery.restore")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
