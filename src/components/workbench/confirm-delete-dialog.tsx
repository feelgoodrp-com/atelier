import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of drawables about to be deleted. */
  count: number;
  onConfirm: () => void;
}

/** Destructive confirmation before removing drawables from the project. */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  count,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const { t } = useTranslation("workbench");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="liquid-glass border-white/15 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">
            {count === 1
              ? t("confirmDelete.titleOne")
              : t("confirmDelete.titleMany", { count })}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {count === 1
              ? t("confirmDelete.descriptionOne")
              : t("confirmDelete.descriptionMany")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            <Trash2 className="h-4 w-4" />
            {t("common:delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
