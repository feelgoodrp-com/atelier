/**
 * Decal thumbnail. Raster sources (png/jpg/webp) render directly via a webview
 * blob URL (no sidecar needed); dds/ytd sources show a placeholder until the
 * sidecar thumbnail path lands (P5). Alpha shows over a checkerboard so
 * transparent decals read correctly.
 */

import { useEffect, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { Stamp } from "lucide-react";
import { cn } from "@/lib/utils";
import { joinPath } from "@/lib/project/io";
import type { AssetRef } from "@/lib/project/schema";
import { useProjectStore } from "@/lib/stores/project-store";

const RASTER_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const CHECKER =
  "repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, transparent 0% 50%) 50% / 12px 12px";

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export function TattooThumb({
  image,
  className,
}: {
  image: AssetRef | null;
  className?: string;
}) {
  const projectDir = useProjectStore((s) => s.projectDir);
  const [url, setUrl] = useState<string | null>(null);

  const mime = image ? RASTER_MIME[extOf(image.path)] : undefined;

  useEffect(() => {
    if (!image || !projectDir || !mime) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    void readFile(joinPath(projectDir, image.path))
      .then((bytes) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image, projectDir, mime]);

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-[8px]",
        className,
      )}
      style={{ background: CHECKER }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-contain" draggable={false} />
      ) : (
        <Stamp className="h-1/3 w-1/3 text-white/25" />
      )}
    </div>
  );
}
