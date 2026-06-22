/**
 * Tattoo image import: copies a decal image into `<projectDir>/assets/tattoos/`,
 * hashes it in the webview (crypto.subtle — NO sidecar needed, so tattoo import
 * works without a configured GTA path) and returns ProjectTattoo drafts.
 *
 * Accepts raster sources (png/jpg/webp) and game textures (dds/ytd); the build
 * step (P2) converts whatever it gets into a DXT5 YTD. Unlike clothing imports
 * there is no filename classification — a tattoo is just one image + metadata.
 */

import { copyFile, exists, mkdir, readFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import i18n from "@/lib/i18n";
import type { TattooGenderId, TattooZoneId } from "@/lib/gta/tattoos";
import { ASSETS_DIR_NAME, joinPath } from "./io";
import { createTattoo, type AssetRef, type ProjectTattoo } from "./schema";

/** Asset subfolder for tattoo decal images. */
export const TATTOO_ASSETS_DIR = "tattoos";

/** Accepted source extensions (raster + game texture). */
export const TATTOO_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "dds",
  "ytd",
] as const;

export interface ImportTattoosOptions {
  /** Zone every imported tattoo starts in (user can change it later). */
  zone: TattooZoneId;
  /** Gender model for the imported tattoos. */
  gender: TattooGenderId;
}

export interface ImportTattoosResult {
  tattoos: ProjectTattoo[];
  skipped: Array<{ path: string; reason: string }>;
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

/** sha256 + size of a local file, hashed in the webview. */
async function sha256OfFile(
  path: string,
): Promise<{ hash: string; size: number }> {
  const bytes = await readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { hash, size: bytes.byteLength };
}

/**
 * Copies `srcPath` into `<projectDir>/assets/tattoos/` and returns the
 * project-relative forward-slash path. Name collisions get a numeric suffix.
 */
async function copyImageIntoAssets(
  projectDir: string,
  srcPath: string,
): Promise<string> {
  const destDir = joinPath(projectDir, ASSETS_DIR_NAME, TATTOO_ASSETS_DIR);
  await mkdir(destDir, { recursive: true });

  const originalName = fileNameOf(srcPath);
  const dot = originalName.lastIndexOf(".");
  const stem = dot === -1 ? originalName : originalName.slice(0, dot);
  const ext = dot === -1 ? "" : originalName.slice(dot);

  let destName = originalName;
  for (let i = 1; await exists(joinPath(destDir, destName)); i++) {
    destName = `${stem}_${i}${ext}`;
  }

  await copyFile(srcPath, joinPath(destDir, destName));
  return `${ASSETS_DIR_NAME}/${TATTOO_ASSETS_DIR}/${destName}`;
}

/** Copies + hashes each image and builds a ProjectTattoo draft per file. */
export async function importTattooImages(
  projectDir: string,
  filePaths: string[],
  options: ImportTattoosOptions,
): Promise<ImportTattoosResult> {
  const tattoos: ProjectTattoo[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const path of filePaths) {
    try {
      const { hash, size } = await sha256OfFile(path);
      const relPath = await copyImageIntoAssets(projectDir, path);
      const image: AssetRef = { path: relPath, hash, size };
      tattoos.push(
        createTattoo({
          label: stripExtension(fileNameOf(path)),
          zone: options.zone,
          gender: options.gender,
          image,
        }),
      );
    } catch (e) {
      skipped.push({
        path,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { tattoos, skipped };
}

/**
 * Opens a multi-file picker (raster + dds/ytd) and imports the chosen images.
 * Returns null when the dialog is cancelled.
 */
export async function pickAndImportTattoos(
  projectDir: string,
  options: ImportTattoosOptions,
): Promise<ImportTattoosResult | null> {
  const selected = await openDialog({
    multiple: true,
    filters: [
      {
        name: i18n.t("tattoos:filePicker.filterName"),
        extensions: [...TATTOO_IMAGE_EXTENSIONS],
      },
    ],
  });
  if (selected === null) return null;
  const paths = Array.isArray(selected) ? selected : [selected];
  if (paths.length === 0) return null;
  return importTattooImages(projectDir, paths, options);
}
