# Personas

Synthetic patient records as FHIR R4 Bundles in Synthea's export format
(Patient, Condition, MedicationRequest, AllergyIntolerance, Immunization, Observation).
`build_summary` reads these to make the one-page PDF.

The current files are hand-authored by `scripts/make-personas.ts` (names follow
Synthea's numbered style so nobody mistakes them for real people). Real Synthea
output (`java -jar synthea-with-dependencies.jar -p 5`) can be dropped in here
as-is. **No real patient data belongs here.**

| id | Who | Demo need |
|---|---|---|
| amira-haddad | Adult, Calgary AB, no family doctor | Prescription renewal |
| lily-haddad | Child (7) in Amira's household | Minor symptom (child) |
| noah-haddad | Infant (~2 months) in Amira's household | Infant fever → red flag (811) |
| david-tremblay | Adult, Edmonton AB, family doctor hard to reach | Lab result follow-up |
| jun-chen | Young adult, Vancouver BC, no family doctor | Minor new symptom |
