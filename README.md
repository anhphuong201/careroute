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
1. vercel.com → Add New → Project → import `careroute`.
2. Settings → Environment Variables → add `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, default `claude-opus-5-5`).
3. Deploy. No database is needed: households and search history stay in the user's browser.

## How the agent works
```
User ─► safety checklist (tap = emergency screen, no AI)
     ─► /api/agent
          1. checkRedFlags(raw text, checklist, age)        rules, not AI ── match → 911 / 988 / 811 screen
          2. Claude → record_need (English restatement)
             checkRedFlags(English restatement)             rules again ─── match → emergency screen
          3. Claude → search_care_rules → find_facilities → check_er_waits / lookup_medication
          4. Claude → present_route  → server checks rule_id was really retrieved,
                                       attaches the rule's official source link + facility records
     ─► user taps "Choose" → approval dialog → /api/book (mock, labelled SIMULATED)
     ─► /api/summary → one-page PDF (FHIR IPS layout) from /data/personas
```
- The model never sees `check_red_flags`, `book_appointment` or `build_summary`; the server runs them.
- Province and location are injected by the server, not chosen by the model.
- Claude API: `claude-opus-5-5`, adaptive thinking at `medium` effort, server-side refusal fallback enabled (`fallbacks: "default"`).
- Tests: `npm test` covers red-flag rules (many languages), data parsing, and the agent loop with a scripted fake model.

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

## Data status
| File | Source | Status |
|---|---|---|
| `data/<prov>/er_waits.json` | AHS wait-time feed (AB), edwaittimes.ca (BC) | Real snapshot. Refresh: `npm run refresh:er-waits` |
| `data/bc/facilities.csv` | HealthLink BC walk-in clinics (BC Data Catalogue) + ER/UPCC sites | Real |
| `data/ab/facilities.csv` | AHS ER/urgent care sites + OpenStreetMap general medical clinics (specialty clinics filtered out) | Real; walk-in status often unknown, so the app says "call first" |
| `data/<prov>/pharmacies.csv` | OpenStreetMap | Real (OSM coverage varies) |
| `rules/<prov>/*.md` | Official provincial pages (links in each file) | **Draft – needs team/mentor review** |
| `data/personas/` | Synthea-format FHIR bundles (`scripts/make-personas.ts`) | 5 synthetic demo personas; swap in real Synthea output any time |

Rebuild facilities: `npm run fetch:osm && npm run build:facilities -- .osm-cache`

Attribution: map data © OpenStreetMap contributors (ODbL); BC walk-in clinics © Province of British Columbia (OGL-BC); boundaries from Natural Earth (public domain). The app must show these credits.
