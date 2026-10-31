/**
 * Build /data/<prov>/facilities.csv and /data/<prov>/pharmacies.csv.
 *
 * Inputs
 *  - BC walk-in clinics (HealthLink BC, via BC Data Catalogue, OGL-BC)
 *      downloaded automatically from BC_WALKIN_CSV
 *  - Emergency / urgent care sites from /data/<prov>/er_waits.json
 *      (run `npm run refresh:er-waits` first)
 *  - OpenStreetMap pharmacies + clinics (ODbL), as Overpass JSON files in a folder:
 *      npm run build:facilities -- <folder-with-overpass-json>
 *    (see scripts/fetch-osm.sh)
 *  - Province boundaries: /data/boundaries/ab_bc.geojson (Natural Earth, public domain)
 *
 * Behind a proxy on Node >= 22.21 run with NODE_USE_ENV_PROXY=1.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv, toCsv } from "../lib/data/csv";
import { haversineKm, inGeometry, type Geometry } from "../lib/data/geo";
import type { ErWaitsFile } from "./refresh-er-waits";

const ROOT = process.cwd();
const BC_WALKIN_CSV =
  "https://catalogue.data.gov.bc.ca/dataset/5e2707c3-0aa4-4d2d-aedc-4dd0914b686a/resource/3ca6b086-c92b-4654-ae82-ff5723d00611/download/hlbc_walkinclinics.csv";
const BC_WALKIN_SOURCE = "https://catalogue.data.gov.bc.ca/dataset/walk-in-clinics-in-bc";
const OSM_SOURCE = "https://www.openstreetmap.org/copyright";

export const FACILITY_COLUMNS = [
  "id", "name", "type", "address", "city", "lat", "lng", "phone", "hours",
  "accepts_walk_in", "languages", "wheelchair_accessible", "website", "source", "source_url",
] as const;
export const PHARMACY_COLUMNS = [
  "id", "name", "address", "city", "lat", "lng", "phone", "hours", "website", "source", "source_url",
] as const;

type Row = Record<string, string | number | null>;
type Prov = "AB" | "BC";

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const fmtPhone = (p: string) => {
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : p;
};

async function loadBoundaries(): Promise<Record<Prov, Geometry>> {
  const gj = JSON.parse(await readFile(path.join(ROOT, "data/boundaries/ab_bc.geojson"), "utf8"));
  const out = {} as Record<Prov, Geometry>;
  for (const f of gj.features) out[f.properties.code as Prov] = f.geometry;
  return out;
}

/**
 * Natural Earth 1:50m coastlines are coarse, so some coastal BC points fall
 * "in the sea". Fallback: west of the AB border and north of the US border
 * (excluding the Alaska panhandle), or southern Vancouver Island.
 */
function provinceOf(lat: number, lng: number, b: Record<Prov, Geometry>): Prov | null {
  if (inGeometry(lat, lng, b.AB)) return "AB";
  if (inGeometry(lat, lng, b.BC)) return "BC";
  if (lat >= 60) return null;
  if (lat > 54.6 && lng < -130) return null; // Alaska panhandle
  if (lat >= 49 && lng < -120) return "BC";
  if (lat >= 48.2 && lat < 49 && lng < -123.25) return "BC"; // southern Vancouver Island
  return null;
}

function osmAddress(t: Record<string, string>) {
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return [t["addr:unit"] ? `${t["addr:unit"]}-${street}` : street].filter(Boolean).join(", ");
}

async function loadOsm(dir: string): Promise<OsmElement[]> {
  const seen = new Map<string, OsmElement>();
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const json = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    for (const e of json.elements as OsmElement[]) seen.set(`${e.type}/${e.id}`, e);
  }
  return [...seen.values()];
}

/**
 * OSM "clinic"/"doctors" covers everything from dentists to laser hair removal.
 * For the walk-in route keep only general medical clinics.
 */
const GENERAL_CLINIC = /medical|family|walk[\s-]?in|primary care|health cent(re|er)|physicians?|doctors?|\bmd\b|urgent care|after[\s-]?hours|polyclinic|community health/i;
const SPECIALTY = /lasik|cataract|retina|ophthalm|public health|laser|eye|optom|optic|vision|dental|dentist|denture|orthodont|physio|chiro|massage|acupunct|naturopath|travel|passport|cosmetic|aesthetic|botox|skin|derma|vein|fertility|ivf|addiction|mental|psych|counsel|lab\b|labs\b|dynalife|imaging|x-ray|xray|ultrasound|mri|radiolog|hearing|audiolog|vet\b|veterinar|animal|pet\b|spa\b|sleep|cancer|dialysis|kidney|rehab|foot|podiat|orthot|weight|hair|tattoo|blood|plasma|vaccin|immuniz|abortion|sexual|sports|pain|wellness|ketamine|methadone|suboxone|surgery|surgical/i;
export function isGeneralClinic(t: Record<string, string>): boolean {
  const spec = (t["healthcare:speciality"] ?? "").toLowerCase();
  const name = `${t.name ?? ""} ${t.description ?? ""}`;
  if (spec && !/general|family|community/.test(spec)) return false;
  if (SPECIALTY.test(name)) return false;
  return /general|family|community/.test(spec) || GENERAL_CLINIC.test(name);
}

async function main() {
  const osmDir = process.argv[2];
  const bounds = await loadBoundaries();
  const facilities: Record<Prov, Row[]> = { AB: [], BC: [] };
  const pharmacies: Record<Prov, Row[]> = { AB: [], BC: [] };

  // 1. BC walk-in clinics (official)
  const res = await fetch(BC_WALKIN_CSV);
  if (!res.ok) throw new Error(`BC walk-in CSV → HTTP ${res.status}`);
  for (const r of parseCsv(await res.text())) {
    if (!r.LATITUDE || !r.LONGITUDE) continue;
    facilities.BC.push({
      id: `bc-wi-${r.SV_REFERENCE}`,
      name: r.RG_NAME,
      type: "walk_in",
      address: [r.STREET_NUMBER, r.STREET_NAME, r.STREET_TYPE, r.STREET_DIRECTION].filter(Boolean).join(" ") + (r.POSTAL_CODE ? `, ${r.POSTAL_CODE}` : ""),
      city: r.CITY,
      lat: Number(r.LATITUDE),
      lng: Number(r.LONGITUDE),
      phone: fmtPhone(r.PHONE_NUMBER),
      hours: r.HOURS,
      accepts_walk_in: "yes",
      languages: r.LANGUAGE,
      wheelchair_accessible: r.WHEELCHAIR_ACCESSIBLE === "Y" ? "yes" : r.WHEELCHAIR_ACCESSIBLE === "N" ? "no" : "",
      website: r.WEBSITE,
      source: "HealthLink BC via BC Data Catalogue (OGL-BC)",
      source_url: r["811_LINK"] || BC_WALKIN_SOURCE,
    });
  }

  // 2. Emergency departments + urgent care (from the official wait-time feeds)
  for (const prov of ["AB", "BC"] as Prov[]) {
    const er: ErWaitsFile = JSON.parse(await readFile(path.join(ROOT, "data", prov.toLowerCase(), "er_waits.json"), "utf8"));
    for (const s of er.sites) {
      facilities[prov].push({
        id: s.id,
        name: s.name,
        type: s.category,
        address: s.address,
        city: s.city,
        lat: s.lat,
        lng: s.lng,
        phone: "",
        hours: s.note ?? "",
        accepts_walk_in: "yes",
        languages: "",
        wheelchair_accessible: "",
        website: s.url ?? "",
        source: er.source_name,
        source_url: er.source_url,
      });
    }
  }

  // 3. OpenStreetMap pharmacies (both provinces) + clinics (AB only; BC uses the official list)
  if (osmDir) {
    for (const e of await loadOsm(osmDir)) {
      const t = e.tags ?? {};
      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      if (lat === undefined || lng === undefined || !t.name) continue;
      const prov = provinceOf(lat, lng, bounds);
      if (!prov) continue;
      const base = {
        name: t.name,
        address: osmAddress(t) + (t["addr:postcode"] ? `, ${t["addr:postcode"]}` : ""),
        city: t["addr:city"] ?? "",
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        phone: fmtPhone(t.phone ?? t["contact:phone"] ?? ""),
        hours: t.opening_hours ?? "",
        website: t.website ?? t["contact:website"] ?? "",
        source: "OpenStreetMap contributors (ODbL)",
        source_url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      };
      const isPharmacy = t.amenity === "pharmacy" || t.healthcare === "pharmacy";
      if (isPharmacy) {
        pharmacies[prov].push({ id: `${prov.toLowerCase()}-ph-osm-${e.type[0]}${e.id}`, ...base });
      } else if (
        prov === "AB" &&
        (t.amenity === "clinic" || t.amenity === "doctors" || ["clinic", "doctor", "centre"].includes(t.healthcare ?? "")) &&
        isGeneralClinic(t)
      ) {
        const walkIn = /walk[\s-]?in/i.test(`${t.name} ${t.description ?? ""}`) ? "yes" : "unknown";
        facilities.AB.push({
          id: `ab-cl-osm-${e.type[0]}${e.id}`,
          ...base,
          type: walkIn === "yes" ? "walk_in" : "clinic",
          accepts_walk_in: walkIn,
          languages: "",
          wheelchair_accessible: t.wheelchair === "yes" ? "yes" : t.wheelchair === "no" ? "no" : "",
        });
      }
    }
  } else {
    console.warn("No OSM folder given – pharmacies.csv and AB clinics will not be rebuilt.");
  }

  // OSM often has no addr:city. Borrow it from the nearest row that has one (≤ 15 km).
  for (const prov of ["AB", "BC"] as Prov[]) {
    const all = [...facilities[prov], ...pharmacies[prov]];
    const named = all.filter((r) => r.city);
    for (const r of all) {
      if (r.city) continue;
      let best: Row | null = null;
      let bestKm = 15;
      for (const n of named) {
        const km = haversineKm(Number(r.lat), Number(r.lng), Number(n.lat), Number(n.lng));
        if (km < bestKm) [best, bestKm] = [n, km];
      }
      if (best) r.city = best.city;
    }
  }

  for (const prov of ["AB", "BC"] as Prov[]) {
    const dir = path.join(ROOT, "data", prov.toLowerCase());
    const byName = (a: Row, b: Row) => String(a.name).localeCompare(String(b.name));
    await writeFile(path.join(dir, "facilities.csv"), toCsv(FACILITY_COLUMNS, facilities[prov].sort(byName)));
    if (osmDir) await writeFile(path.join(dir, "pharmacies.csv"), toCsv(PHARMACY_COLUMNS, pharmacies[prov].sort(byName)));
    console.log(`${prov}: ${facilities[prov].length} facilities, ${pharmacies[prov].length} pharmacies`);
  }
  console.log(`Attribution: ${OSM_SOURCE}`);
}

if (process.argv[1] && /build-facilities/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
