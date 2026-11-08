/**
 * How the DEMO clinic appears in the app. Set in Vercel to make the demo look like the
 * pharmacy you want to present (it is still a demo provider booked through Cal.com).
 *   NEXT_PUBLIC_DEMO_CLINIC_NAME     e.g. "Shoppers Drug Mart – Kensington (demo)"
 *   NEXT_PUBLIC_DEMO_CLINIC_ADDRESS  e.g. "Demo location"
 *   NEXT_PUBLIC_DEMO_CLINIC_HOURS    OSM-style hours, should match your Cal.com availability
 *   NEXT_PUBLIC_DEMO_BADGE           "off" hides the DEMO tag (for presentations only)
 *   NEXT_PUBLIC_DEMO_CLINIC          "off" hides the demo clinic completely
 */
export const DEMO_CLINIC_DISPLAY = {
  enabled: process.env.NEXT_PUBLIC_DEMO_CLINIC !== "off",
  name: process.env.NEXT_PUBLIC_DEMO_CLINIC_NAME || "CareRoute Demo Pharmacy",
  address: process.env.NEXT_PUBLIC_DEMO_CLINIC_ADDRESS || "Demo location (prototype)",
  hours: process.env.NEXT_PUBLIC_DEMO_CLINIC_HOURS || "Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off",
  badge: process.env.NEXT_PUBLIC_DEMO_BADGE !== "off",
};
