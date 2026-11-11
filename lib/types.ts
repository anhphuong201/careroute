import type { ProvinceCode } from "./provinces";
import type { Coverage, HigherRisk, PreferredMode } from "./intake";

export type CareRoute = "pharmacist" | "virtual_care" | "walk_in" | "call_811" | "registry" | "family_doctor";

export type AgeGroup = "infant" | "child" | "adult";

export interface HouseholdMember {
  id: string;
  displayName: string;
  /** Derived from the exact age (kept for backward compatibility). */
  ageGroup: AgeGroup;
  /** Exact age source #1 – also drives the infant (<3 months) red-flag rule. */
  birthDate?: string;
  /** Exact age source #2 when no birth date: age in months (months for under 2, years×12 otherwise). */
  ageMonths?: number;
  /** Profile (asked once, device only, under the consent rules). */
  coverage?: Coverage;
  /** Only yes/no/prefer not to say – never which condition. */
  higherRisk?: HigherRisk;
  /** Orders options only; never changes the clinical route. */
  preferredMode?: PreferredMode;
  hasFamilyDoctor: "yes" | "no" | "hard_to_access";
  /** Synthea persona id in /data/personas (prototype only). */
  personaId?: string;
  /** Optional booking details. Stored only on this device (localStorage, with consent); never sent to the server. */
  contact?: BookingContact;
  /** Usual free windows (keys of FREE_WINDOWS), for suggesting appointment times. Device only. */
  freeTimes?: string[];
}

export interface BookingContact {
  legalName?: string;
  phone?: string;
  email?: string;
  healthCard?: string;
}

export interface Household {
  id: string;
  province: ProvinceCode;
  /** Postal code prefix or coarse city – only stored if the user opts in. */
  locationHint?: string;
  preferredLanguage?: string;
  members: HouseholdMember[];
  /** The "Me" profile when the person isn't saved as a member (same consent rules). */
  guest?: HouseholdMember;
}

export interface SearchRecord {
  id: string;
  memberId: string;
  createdAt: string;
  province: ProvinceCode;
  route: CareRoute | "emergency";
  routeTitle?: string;
  language?: string;
  bookingCode?: string;
  bookingPlace?: string;
  bookingTime?: string;
  bookingReal?: boolean;
  reason: string;
  sourceUrl: string;
}

/** Every recommendation shown to the user must carry these two fields. */
export interface Sourced {
  reason: string;
  sourceUrl: string;
}
