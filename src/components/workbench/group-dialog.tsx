import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/lib/stores/project-store";

/** Feelgood-friendly default palette for group colors. */
const GROUP_COLORS = [
  "#5865F2",
  "#7289DA",
  "#34D399",
  "#FBBF24",
  "#F87171",
  "#F472B6",
  "#A78BFA",
  "#38BDF8",
  "#FB923C",
  "#A3A3A3",
];

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new group id (e.g. to assign it to the selection). */
  onCreated?: (groupId: string) => void;
}

/** Creates a new drawable group (name + color). */
export function GroupDialog({ open, onOpenChange, onCreated }: GroupDialogProps) {
  const addGroup = useProjectStore((s) => s.addGroup);
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_COLORS[0]);

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = addGroup(trimmed, color);
    onCreated?.(id);
    onOpenChange(false);
    setName("");
    setColor(GROUP_COLORS[0]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="liquid-glass border-white/15 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">Neue Gruppe</DialogTitle>
          <DialogDescription className="text-white/50">
            Gruppen markieren zusammengehörige Drawables farblich.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-name" className="text-white/70">
              Name
            </Label>
            <Input
              id="group-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Polizei-Uniformen"
              className="border-white/15 bg-white/5 text-white"
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-white/70">Farbe</Label>
            <div className="flex flex-wrap gap-2">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Farbe ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                    color === c ? "border-white" : "border-transparent",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button disabled={!name.trim()} onClick={create}>
            <Plus className="h-4 w-4" />
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
