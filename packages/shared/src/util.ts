import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";

export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

export const nowIso = (): string => new Date().toISOString();

export const addSeconds = (iso: string, seconds: number): string =>
  new Date(new Date(iso).getTime() + seconds * 1000).toISOString();

export const addMinutes = (iso: string, minutes: number): string =>
  addSeconds(iso, minutes * 60);

export const addDays = (iso: string, days: number): string =>
  addSeconds(iso, days * 86400);

export const isPast = (iso: string, ref: string = nowIso()): boolean =>
  new Date(iso).getTime() <= new Date(ref).getTime();

/**
 * Restrict a sensitive file/dir to the current user only. POSIX: chmod. Windows:
 * strip inheritance and grant only the current user (chmod alone is a no-op on
 * Windows, leaving inherited ACLs that other local users may read). Best-effort.
 */
export function secureLocalFile(path: string, mode = 0o600): void {
  try {
    chmodSync(path, mode);
  } catch {
    /* non-POSIX */
  }
  if (process.platform === "win32") {
    const user = process.env.USERNAME;
    if (!user) return;
    try {
      execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${user}:F`], {
        stdio: "ignore",
      });
    } catch {
      /* icacls unavailable or path locked — leave POSIX-mode attempt in place */
    }
  }
}
