/** Shape of /data/<province>/er_waits.json (written by scripts/refresh-er-waits.ts). */
export interface ErWaitSite {
  id: string;
  name: string;
  category: "emergency" | "urgent_care";
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  wait_minutes: number | null;
  /** Who the site serves, as published (e.g. "17 and older"). */
  audience: string | null;
  note: string | null;
  url: string | null;
}

export interface ErWaitsFile {
  province: "AB" | "BC";
  source_name: string;
  source_url: string;
  refreshed_at: string;
  sites: ErWaitSite[];
}
