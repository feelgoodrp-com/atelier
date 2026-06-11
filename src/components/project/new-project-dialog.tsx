import { useMemo, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
import { joinPath } from "@/lib/project/io";
import { createAndOpenProject } from "@/lib/project/session";

/** Turns a project name into a safe Windows folder name. */
function sanitizeFolderName(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/[. ]+$/g, "")
      .trim() || "atelier-projekt"
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({ open, onOpenChange }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const projectDir = useMemo(
    () => (location ? joinPath(location, sanitizeFolderName(name || "")) : null),
    [location, name],
  );

  const pickLocation = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        title: "Speicherort für das Projekt wählen",
      });
      if (typeof selected === "string") setLocation(selected);
    } catch (e) {
      toast.error("Ordner konnte nicht gewählt werden", {
        description: errorMessage(e),
      });
    }
  };

  const create = async () => {
    if (!name.trim() || !projectDir) return;
    setCreating(true);
    try {
      const project = await createAndOpenProject(projectDir, name.trim());
      toast.success(`Projekt „${project.name}“ erstellt`);
      onOpenChange(false);
      setName("");
      setLocation(null);
    } catch (e) {
      toast.error("Projekt konnte nicht erstellt werden", {
        description: errorMessage(e),
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !creating && onOpenChange(o)}>
      <DialogContent className="liquid-glass border-white/15 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Neues Projekt</DialogTitle>
          <DialogDescription className="text-white/50">
            Erstellt einen Projektordner mit pack.atelier und assets/.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name" className="text-white/70">
              Projektname
            </Label>
            <Input
              id="project-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Feelgood Summer Pack"
              className="border-white/15 bg-white/5 text-white"
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-location" className="text-white/70">
              Speicherort
            </Label>
            <div className="flex gap-2">
              <Input
                id="project-location"
                readOnly
                value={location ?? ""}
                placeholder="Noch kein Ordner gewählt…"
                className="border-white/15 bg-white/5 text-white"
              />
              <Button variant="outline" onClick={() => void pickLocation()}>
                <FolderOpen className="h-4 w-4" />
                Durchsuchen
              </Button>
            </div>
            {projectDir && (
              <p className="break-all text-xs text-white/35">
                Wird erstellt in: {projectDir}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={creating}
            onClick={() => onOpenChange(false)}
          >
            Abbrechen
          </Button>
          <Button
            disabled={creating || !name.trim() || !location}
            onClick={() => void create()}
          >
            <Plus className="h-4 w-4" />
            {creating ? "Erstellen…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
