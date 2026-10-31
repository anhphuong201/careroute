# CareRoute

An AI care-navigation agent for people in Canada who don't have a family doctor, or whose doctor is hard to reach.
The prototype covers **Alberta and British Columbia**. Other provinces can be added through `lib/provinces.ts` plus `/rules/<prov>` and `/data/<prov>`.

> CareRoute never diagnoses. Every recommendation shows its reason and an official source.
> In an emergency, call **911**. For a mental-health crisis, call or text **988**.

## Run locally
```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm run dev
npm test                     # red-flag unit tests
```

## Deploy to Vercel
Import the GitHub repo in Vercel and set `ANTHROPIC_API_KEY` under Environment Variables.

## Layout
| Path | Purpose |
|---|---|
| `lib/safety/redFlags.ts` | `check_red_flags`: hard-coded rules (not AI) that always run first |
| `lib/tools/definitions.ts` | Claude tool schemas |
| `lib/provinces.ts` | Province registry (add new provinces here) |
| `rules/<prov>/*.md` | Care-route rules, each with a `source_url` in its front-matter |
| `data/<prov>/facilities.csv`, `pharmacies.csv`, `er_waits.json` | Facility and wait-time data |
| `data/personas/` | Synthea FHIR bundles for `build_summary` |
| `scripts/refresh-er-waits.ts` | Refreshes ER waits from the official AB/BC pages |

All files under `rules/` and `data/` are **PLACEHOLDERS** until they're replaced with the vetted data from the project Google Drive folder.
