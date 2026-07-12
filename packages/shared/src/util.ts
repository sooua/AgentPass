import { randomUUID } from "node:crypto";

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
