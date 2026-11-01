/**
 * Refresh /data/<province>/er_waits.json from the official wait-time feeds.
 *
 *   AB: Alberta Health Services – the JSON that powers
 *       https://www.albertahealthservices.ca/waittimes/waittimes.aspx
 *   BC: edwaittimes.ca (VCH / PHC / FH / PHSA) – the JSON that powers https://edwaittimes.ca/
 *
 * Run: npm run refresh:er-waits   (locally, in CI, or as a scheduled job)
 * Behind an HTTP proxy on Node >= 22.21, run with NODE_USE_ENV_PROXY=1.
 *
 * These are estimates published by the health authorities. The app never
 * shows them when a red flag matched.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { ErWaitSite, ErWaitsFile } from "../lib/data/erTypes";
export type { ErWaitSite, ErWaitsFile };

const AHS_PAGE = "https://www.albertahealthservices.ca/waittimes/waittimes.aspx";
const AHS_API = "https://www.albertahealthservices.ca/Webapps/WaitTimes/api/waittimes/en";
const BC_PAGE = "https://edwaittimes.ca/";
const BC_API = "https://edwaittimes.ca/api/wait-times";

const stripHtml = (s: string | null | undefined) =>
  s ? s.replace(/<br\s*\/?>/gi, " · ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() || null : null;

/** "5 hr 48 min" → 348 */
export function parseAhsWait(text: string | null | undefined): number | null {
  if (!text) return null;
  const h = /(\d+)\s*hr/.exec(text);
  const m = /(\d+)\s*min/.exec(text);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

const CITY_NAMES: Record<string, string> = {
  RedDeer: "Red Deer",
  MedicineHat: "Medicine Hat",
  GrandePrairie: "Grande Prairie",
  FortMcMurray: "Fort McMurray",
};

interface AhsSite {
  Name: string;
  Category: string;
  WaitTime: string;
  URL: string;
  Note: string;
  TimesUnavailable: string;
  Address: string;
  GoogleMapsLinkDirection: string;
  SiteId: string;
}

export function mapAhs(json: Record<string, Record<string, AhsSite[]>>): ErWaitSite[] {
  const sites: ErWaitSite[] = [];
  for (const [cityKey, groups] of Object.entries(json)) {
    for (const [group, list] of Object.entries(groups)) {
      for (const s of list ?? []) {
        const coords = /query=(-?[\d.]+),(-?[\d.]+)/.exec(s.GoogleMapsLinkDirection ?? "");
        const unavailable = String(s.TimesUnavailable).toLowerCase() === "true";
        sites.push({
          id: `ab-er-${s.SiteId}`,
          name: s.Name,
          category: group === "Urgent" ? "urgent_care" : "emergency",
          city: CITY_NAMES[cityKey] ?? cityKey,
          address: s.Address,
          lat: coords ? Number(coords[1]) : null,
          lng: coords ? Number(coords[2]) : null,
          wait_minutes: unavailable ? null : parseAhsWait(s.WaitTime),
          audience: null,
          note: stripHtml(s.Note),
          url: s.URL,
          hours: stripHtml(s.Note),
          phone: null,
        });
      }
    }
  }
  return sites;
}

interface BcSite {
  id: string;
  name: string;
  status: string;
  type: string;
  address: string;
  latitude: number;
  longitude: number;
  website: string;
  audience: string;
  description: string;
  showWaitTimes: boolean;
  waitTime?: { waitTimeMinutes?: number | null } | null;
  phone?: string;
  open247?: boolean;
  operatingHours?: { days?: { open: string | null; close: string | null }[] } | null;
}

/**
 * edwaittimes.ca stores times as 1970-01-01 GMT instants; they are Pacific Standard Time
 * (UTC-8) wall-clock times. days[0] is Sunday.
 */
export function bcHours(s: Pick<BcSite, "open247" | "operatingHours">): string | null {
  if (s.open247) return "24/7";
  const days = s.operatingHours?.days;
  if (!days?.length) return null;
  const OSM = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const hm = (iso: string) => {
    const d = new Date(new Date(iso).getTime() - 8 * 3600 * 1000);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const rules = days.map((d, i) => (d.open && d.close ? `${OSM[i]} ${hm(d.open)}-${hm(d.close)}` : `${OSM[i]} off`));
  return rules.join("; ");
}

const BC_AUDIENCE: Record<string, string> = {
  allAges: "All ages",
  seventeenPlus: "17 and older",
  sixteenAndUnder: "16 and under",
};

export function mapBc(json: BcSite[]): ErWaitSite[] {
  return json
    .filter((s) => s.status === "published")
    .map((s) => ({
      id: `bc-er-${s.id}`,
      name: s.name,
      category: s.type === "upcc" ? "urgent_care" : "emergency",
      city: (s.address.split(",").at(-3) ?? "").trim(),
      address: s.address,
      lat: s.latitude ?? null,
      lng: s.longitude ?? null,
      wait_minutes: s.showWaitTimes ? (s.waitTime?.waitTimeMinutes ?? null) : null,
      audience: BC_AUDIENCE[s.audience] ?? s.audience ?? null,
      note: s.description || null,
      url: s.website || null,
      hours: bcHours(s),
      phone: s.phone || null,
    }));
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "CareRoute/0.1 (prototype)" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function refreshAll(rootDir = process.cwd()) {
  const now = new Date().toISOString();
  const jobs: { file: ErWaitsFile; dir: string }[] = [];

  const ab = mapAhs(await getJson(AHS_API));
  jobs.push({ dir: "ab", file: { province: "AB", source_name: "Alberta Health Services", source_url: AHS_PAGE, refreshed_at: now, sites: ab } });

  const bc = mapBc(await getJson(BC_API));
  jobs.push({ dir: "bc", file: { province: "BC", source_name: "edwaittimes.ca (VCH, PHC, FH, PHSA)", source_url: BC_PAGE, refreshed_at: now, sites: bc } });

  for (const { dir, file } of jobs) {
    await writeFile(path.join(rootDir, "data", dir, "er_waits.json"), JSON.stringify(file, null, 2) + "\n");
    console.log(`${file.province}: ${file.sites.length} sites written`);
  }
}

if (process.argv[1] && /refresh-er-waits/.test(process.argv[1])) {
  refreshAll().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
