/**
 * Real online booking links for pharmacist appointments. Only links verified on 2026-11-01
 * from the operator's own website are listed. The person books directly with the pharmacy;
 * CareRoute sends no personal data.
 */
import type { ProvinceCode } from "../provinces";

export interface BookingLink {
  url: string;
  label: string;
  note: string;
  source_title: string;
  source_url: string;
}

const REXALL: BookingLink = {
  url: "https://rexall.medmeapp.com/schedule/groups/minorAilments",
  label: "Rexall online booking",
  note: "Book an in-person or phone visit with a Rexall pharmacist. Choose this store when booking.",
  source_title: "Rexall – linked from rexall.ca",
  source_url: "https://www.rexall.ca/",
};

const BC_PROVINCIAL: BookingLink = {
  url: "https://bookapharmacist.gov.bc.ca/s/",
  label: "Book a Pharmacist (Government of B.C.)",
  note: "B.C.'s official booking site for minor ailments and contraception. Search for this pharmacy; not every pharmacy takes online bookings.",
  source_title: "Pharmacy services in B.C. – HealthLink BC",
  source_url: "https://www.healthlinkbc.ca/find-care/pharmacy-services-bc",
};

export function bookingFor(name: string, province: ProvinceCode): BookingLink | undefined {
  if (/\brexall\b/i.test(name)) return REXALL;
  if (province === "BC") return BC_PROVINCIAL;
  return undefined;
}
