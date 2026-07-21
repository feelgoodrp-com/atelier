import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Readable text for anything thrown (Error, string, sidecar rejection…). */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
