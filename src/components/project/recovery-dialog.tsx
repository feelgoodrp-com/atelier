import { useState } from "react";
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
  const [busy, setBusy] = useState(false);

  const resolve = async (restore: boolean) => {
    if (!recovery) return;
    setBusy(true);
    try {
      await resolveRecovery(recovery, restore);
      if (restore) toast.success("Autosave wiederhergestellt");
      onClose();
    } catch (e) {
      toast.error("Wiederherstellung fehlgeschlagen", {
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
            Nicht gespeicherte Änderungen gefunden
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {recovery
              ? `Für „${recovery.saved.name}“ existiert ein Autosave vom ${recovery.autosave.savedAt.toLocaleString("de-DE")}, das neuer ist als der letzte Speicherstand. Möchtest du es wiederherstellen?`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void resolve(false)}
          >
            Verwerfen
          </Button>
          <Button disabled={busy} onClick={() => void resolve(true)}>
            Wiederherstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
