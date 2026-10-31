# Data sources (from the team "Dataset" sheet)

| Use | Source |
|---|---|
| ER guidance / when to use ER | https://erstat.ca/guide · https://www.healthlinkbc.ca/health-library/health-features/when-visit-emergency-room · https://emergency.easternhealth.ca/patients-and-families/when-to-use-the-emergency-department/ |
| AB care navigation | https://navigatecareab.ca/ |
| Urgent care vs ER (other provinces, for scaling) | https://www.gov.nl.ca/hcs/files/23078-urgentcare-flyer-online.pdf · https://www.manitoba.ca/mr/northern/pubs/workplace_safety_and_health/forms/urgent_care_or_emergency_fact_sheet.pdf |
| Live ER data | https://erstat.ca/developers |
| BC walk-in clinics | https://open.canada.ca/data/en/dataset/5e2707c3-0aa4-4d2d-aedc-4dd0914b686a |
| Clinic directories | https://empower.ca/en/providers · https://canclinics.ca/ |
| Facilities (find_facilities) | StatCan ODHF https://open.canada.ca/data/en/dataset/543fe07a-fd79-40e9-a829-ccd697526765 (metadata: https://www.statcan.gc.ca/en/lode/databases/odhf/metadata) + OpenStreetMap pharmacies |
| Medications (lookup_medication) | Health Canada DPD API https://health-products.canada.ca/api/documentation/dpd-documentation-en.html · dataset https://open.canada.ca/data/en/dataset/a1bcd4ee-8e57-499b-9c6f-94f6902fdf32 |

## Constraints from the build plan
- MVP needs: prescription renewal, lab result follow-up, minor new symptom.
- No data stored server-side: household profiles and search history live on the user's device (browser storage), with consent.
- Simulated parts (booking, cached wait times) are labelled on screen.
