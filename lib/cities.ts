/** Fallback locations when the user does not share GPS. Approximate city centres. */
import type { ProvinceCode } from "./provinces";

export const CITIES: Record<ProvinceCode, { name: string; lat: number; lng: number }[]> = {
  AB: [
    { name: "Calgary", lat: 51.0447, lng: -114.0719 },
    { name: "Edmonton", lat: 53.5461, lng: -113.4938 },
    { name: "Red Deer", lat: 52.269, lng: -113.8116 },
    { name: "Lethbridge", lat: 49.6942, lng: -112.8328 },
    { name: "Medicine Hat", lat: 50.0405, lng: -110.6766 },
    { name: "Grande Prairie", lat: 55.1707, lng: -118.7947 },
    { name: "Fort McMurray", lat: 56.7265, lng: -111.381 },
    { name: "Airdrie", lat: 51.2917, lng: -114.0144 },
  ],
  BC: [
    { name: "Vancouver", lat: 49.2827, lng: -123.1207 },
    { name: "Surrey", lat: 49.1913, lng: -122.849 },
    { name: "Burnaby", lat: 49.2488, lng: -122.9805 },
    { name: "Richmond", lat: 49.1666, lng: -123.1336 },
    { name: "Abbotsford", lat: 49.0504, lng: -122.3045 },
    { name: "Victoria", lat: 48.4284, lng: -123.3656 },
    { name: "Nanaimo", lat: 49.1659, lng: -123.9401 },
    { name: "Kelowna", lat: 49.888, lng: -119.496 },
    { name: "Kamloops", lat: 50.6745, lng: -120.3273 },
    { name: "Prince George", lat: 53.9171, lng: -122.7497 },
  ],
};
