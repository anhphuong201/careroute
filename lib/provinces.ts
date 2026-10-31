/**
 * Province registry. To add a province: add an entry here, then create
 * /rules/<code> and /data/<code> with the same file layout as AB/BC.
 * Nothing else in the app should hard-code a province.
 */
export type ProvinceCode = "AB" | "BC";

export interface ProvinceConfig {
  code: ProvinceCode;
  name: string;
  enabled: boolean;
  /** Folder name under /rules and /data. */
  dir: string;
  nurseLine: { phone: string; name: string; url: string };
  findADoctor: { name: string; url: string };
  erWaitsSourceUrl: string;
}

export const PROVINCES: Record<ProvinceCode, ProvinceConfig> = {
  AB: {
    code: "AB",
    name: "Alberta",
    enabled: true,
    dir: "ab",
    nurseLine: { phone: "811", name: "Health Link", url: "https://www.primarycarealberta.ca/page14176.aspx" },
    findADoctor: { name: "Alberta Find a Provider", url: "https://albertafindaprovider.ca/" },
    erWaitsSourceUrl: "https://www.albertahealthservices.ca/waittimes/waittimes.aspx",
  },
  BC: {
    code: "BC",
    name: "British Columbia",
    enabled: true,
    dir: "bc",
    nurseLine: { phone: "811", name: "HealthLink BC", url: "https://www.healthlinkbc.ca/find-care/healthlink-bc-8-1-1-services" },
    findADoctor: { name: "Health Connect Registry", url: "https://www.healthlinkbc.ca/find-care/health-connect-registry" },
    erWaitsSourceUrl: "https://edwaittimes.ca/",
  },
};

export const ENABLED_PROVINCES = Object.values(PROVINCES).filter((p) => p.enabled);
