import type { ProvinceCode } from "./provinces";

export type CareRoute = "pharmacist" | "virtual_care" | "walk_in" | "call_811" | "registry" | "family_doctor";

export type AgeGroup = "infant" | "child" | "adult";

export interface HouseholdMember {
  id: string;
  displayName: string;
  ageGroup: AgeGroup;
  /** Optional, used for the infant (<3 months) red-flag rule. */
  birthDate?: string;
  hasFamilyDoctor: "yes" | "no" | "hard_to_access";
  /** Synthea persona id in /data/personas (prototype only). */
  personaId?: string;
}

export interface Household {
  id: string;
  province: ProvinceCode;
  /** Postal code prefix or coarse city – only stored if the user opts in. */
  locationHint?: string;
  preferredLanguage?: string;
  members: HouseholdMember[];
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
  reason: string;
  sourceUrl: string;
}

/** Every recommendation shown to the user must carry these two fields. */
export interface Sourced {
  reason: string;
  sourceUrl: string;
}
