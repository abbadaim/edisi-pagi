/**
 * Registry pemilik media (rencana 017).
 *
 * Satu entri per domain. Entri tanpa `diverifikasi_pada` dianggap **tidak
 * diketahui**: label pemilik tidak dipakai, dan hitungan kembali ke domain.
 * Registry yang hilang atau rusak tidak boleh menghentikan penerbitan.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface OutletEntry {
  outlet: string;
  pemilik: string;
  afiliasi?: string;
  catatan?: string;
  diverifikasi_pada?: string | null;
}

export interface Registry {
  entries: OutletEntry[];
  /** outlet → pemilik, hanya untuk entri terverifikasi. */
  owners: Map<string, string>;
  /** outlet → entri, termasuk yang belum terverifikasi. */
  all: Map<string, OutletEntry>;
}

export type OwnerLookup = (outlet: string) => string | null;

const configPath = join(new URL("../..", import.meta.url).pathname, "config", "outlets.yaml");

function isVerified(entry: OutletEntry): boolean {
  return typeof entry.diverifikasi_pada === "string" && entry.diverifikasi_pada.length >= 10;
}

export function parseRegistry(raw: unknown): Registry {
  const doc = raw as { outlets?: OutletEntry[] } | null;
  const entries = Array.isArray(doc?.outlets) ? doc!.outlets : [];
  const owners = new Map<string, string>();
  const all = new Map<string, OutletEntry>();

  for (const entry of entries) {
    if (!entry?.outlet || !entry?.pemilik) continue;
    all.set(entry.outlet, entry);
    if (isVerified(entry)) owners.set(entry.outlet, entry.pemilik);
  }
  return { entries, owners, all };
}

export function loadRegistry(path = configPath): Registry {
  try {
    if (!existsSync(path)) return parseRegistry(null);
    return parseRegistry(parse(readFileSync(path, "utf8")));
  } catch {
    return parseRegistry(null);
  }
}

let cache: Registry | null = null;

/** Dipakai pipeline; dibaca sekali, gagal = registry kosong. */
export function registry(): Registry {
  if (!cache) cache = loadRegistry();
  return cache;
}

export function ownerOfOutlet(outlet: string): string | null {
  return registry().owners.get(outlet) ?? null;
}

/** Nama pemilik untuk label UI: hanya bila entri terverifikasi. */
export function ownerLabel(outlet: string): string | null {
  return ownerOfOutlet(outlet);
}
