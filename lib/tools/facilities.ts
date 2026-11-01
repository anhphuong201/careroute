/** find_facilities + check_er_waits – read /data/<province>/*.csv|json and sort by distance. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../data/csv";
import { haversineKm } from "../data/geo";
import { PROVINCES, type ProvinceCode } from "../provinces";
import type { ErWaitsFile, ErWaitSite } from "../data/erTypes";
import { bookingFor, type BookingLink } from "../data/pharmacyBooking";

export type FacilityKind = "pharmacy" | "walk_in" | "urgent_care" | "emergency" | "virtual";

export interface Facility {
  id: string;
  kind: FacilityKind | "clinic";
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  phone: string;
  hours: string;
  accepts_walk_in: string;
  languages: string;
  wheelchair_accessible: string;
  website: string;
  source: string;
  source_url: string;
  distance_km?: number;
  /** Virtual care only */
  modes?: ("phone" | "video" | "chat")[];
  how?: string;
  cost?: string;
  limits?: string;
  official?: boolean;
  source_title?: string;
  /** Real online booking page (pharmacies), if one is verified. */
  booking?: BookingLink;
}

interface VirtualFile {
  services: { id: string; name: string; modes: Facility["modes"]; how: string; hours: string; cost: string; phone: string; url: string; official: boolean; limits?: string; source_title: string; source_url: string }[];
}

/** Virtual care services (/data/<prov>/virtual_care.json). No location, so lat/lng are NaN. */
export function loadVirtual(p: ProvinceCode): Facility[] {
  const file = path.join(dataDir(p), "virtual_care.json");
  if (!existsSync(file)) return [];
  const v = JSON.parse(readFileSync(file, "utf8")) as VirtualFile;
  return v.services.map((s) => ({
    id: s.id, kind: "virtual" as const, name: s.name, address: "", city: "", lat: NaN, lng: NaN,
    phone: s.phone, hours: s.hours, accepts_walk_in: "", languages: "", wheelchair_accessible: "",
    website: s.url, source: s.source_title, source_url: s.source_url, modes: s.modes, how: s.how, cost: s.cost,
    limits: s.limits, official: s.official, source_title: s.source_title,
  }));
}

const dataDir = (p: ProvinceCode) => path.join(process.cwd(), "data", PROVINCES[p].dir);
const cache = new Map<string, Facility[]>();

function readCsv(file: string): Record<string, string>[] {
  return existsSync(file) ? parseCsv(readFileSync(file, "utf8")) : [];
}

export function loadFacilities(p: ProvinceCode): Facility[] {
  const hit = cache.get(p);
  if (hit) return hit;
  const fac = readCsv(path.join(dataDir(p), "facilities.csv")).map((r) => ({
    id: r.id,
    kind: r.type as Facility["kind"],
    name: r.name,
    address: r.address,
    city: r.city,
    lat: Number(r.lat),
    lng: Number(r.lng),
    phone: r.phone,
    hours: r.hours,
    accepts_walk_in: r.accepts_walk_in,
    languages: r.languages ?? "",
    wheelchair_accessible: r.wheelchair_accessible ?? "",
    website: r.website,
    source: r.source ?? "",
    source_url: r.source_url,
  }));
  const ph = readCsv(path.join(dataDir(p), "pharmacies.csv")).map((r) => ({
    id: r.id,
    kind: "pharmacy" as const,
    name: r.name,
    address: r.address,
    city: r.city,
    lat: Number(r.lat),
    lng: Number(r.lng),
    phone: r.phone,
    hours: r.hours,
    accepts_walk_in: "yes",
    languages: "",
    wheelchair_accessible: "",
    website: r.website,
    source: r.source ?? "",
    source_url: r.source_url,
    booking: bookingFor(r.name, p),
  }));
  const all = [...fac, ...ph].filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng) && f.name && !/PLACEHOLDER/.test(f.name));
  cache.set(p, all);
  return all;
}

export function getFacility(p: ProvinceCode, id: string): Facility | undefined {
  return loadFacilities(p).find((f) => f.id === id) ?? loadVirtual(p).find((f) => f.id === id);
}

export interface FindFacilitiesInput {
  province: ProvinceCode;
  kind: FacilityKind;
  lat?: number;
  lng?: number;
  limit?: number;
}

/** Walk-in requests also return clinics with unknown walk-in status, flagged so the UI says "call first". */
export function findFacilities(input: FindFacilitiesInput) {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  if (input.kind === "virtual") {
    // Official services first; no location needed.
    const list = loadVirtual(input.province).sort((a, b) => Number(b.official) - Number(a.official));
    return { location_used: true, facilities: list.slice(0, limit), note: undefined as string | undefined };
  }
  const kinds: Facility["kind"][] = input.kind === "walk_in" ? ["walk_in", "urgent_care", "clinic"] : [input.kind];
  let list = loadFacilities(input.province).filter((f) => kinds.includes(f.kind));
  const hasLoc = typeof input.lat === "number" && typeof input.lng === "number";
  // Hide OSM clinics that duplicate an official site (same building, ≤150 m).
  if (input.kind === "walk_in") {
    const official = list.filter((f) => f.kind !== "clinic");
    list = list.filter((f) => f.kind !== "clinic" || !official.some((o) => haversineKm(o.lat, o.lng, f.lat, f.lng) <= 0.15));
  }
  if (hasLoc) {
    list = list
      .map((f) => ({ ...f, distance_km: Math.round(haversineKm(input.lat!, input.lng!, f.lat, f.lng) * 10) / 10 }))
      .sort((a, b) => a.distance_km! - b.distance_km! || (a.kind === "clinic" ? 1 : 0) - (b.kind === "clinic" ? 1 : 0));
  }
  return {
    location_used: hasLoc,
    facilities: hasLoc ? list.slice(0, limit) : [],
    note: hasLoc ? undefined : "No location given. Ask the user to share location or choose a city.",
  };
}

export function loadErWaits(p: ProvinceCode): ErWaitsFile | null {
  const file = path.join(dataDir(p), "er_waits.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ErWaitsFile) : null;
}

/** check_er_waits – the caller must never invoke this after a red flag (enforced in the agent). */
export function checkErWaits(p: ProvinceCode, facilityIds?: string[]) {
  const file = loadErWaits(p);
  if (!file) return { available: false, sites: [] as ErWaitSite[] };
  const sites = facilityIds?.length ? file.sites.filter((s) => facilityIds.includes(s.id)) : file.sites;
  return {
    available: true,
    source_name: file.source_name,
    source_url: file.source_url,
    refreshed_at: file.refreshed_at,
    sites: sites.map((s) => ({ id: s.id, name: s.name, category: s.category, wait_minutes: s.wait_minutes, audience: s.audience })),
  };
}
