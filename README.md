# CareRoute

An AI care-navigation agent for people in Canada who don't have a family doctor, or whose doctor is hard to reach.
The prototype covers **Alberta and British Columbia**. Other provinces can be added through `lib/provinces.ts` plus `/rules/<prov>` and `/data/<prov>`.

> CareRoute never diagnoses. Every recommendation shows its reason and an official source.
> In an emergency, call **911**. For a mental-health crisis, call or text **988**.

## Run locally
```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY (or ANTHROPIC_API_KEY)
npm run dev
npm test                     # red-flag unit tests
```

## Deploy to Vercel
1. vercel.com → Add New → Project → import `careroute`.
2. Settings → Environment Variables → add `OPENAI_API_KEY` (optional: `OPENAI_MODEL`, default `gpt-5.5`).
   To use Claude instead, add `ANTHROPIC_API_KEY` and `LLM_PROVIDER=anthropic`.
3. Deploy. No database is needed: households and search history stay in the user's browser.

## How the agent works
```
User ─► safety checklist (tap = emergency screen, no AI)
     ─► /api/agent
          1. checkRedFlags(raw text, checklist, age)        rules, not AI ── match → 911 / 988 / 811 screen
          2. AI → record_need (English restatement)
             checkRedFlags(English restatement)             rules again ─── match → emergency screen
          3. AI → search_care_rules → symptom_guide (HealthLink BC) → find_facilities → check_er_waits / lookup_medication
          4. AI → present_route  → main route + 1–3 "If …" alternatives + a word-for-word quote from the guideline;
                                       no quote match / "no guideline" → 811 (no guessing); server checks every rule_id was really retrieved,
                                       attaches the rule's official source link + facility records
     ─► user taps "Choose" → approval dialog → /api/book (mock, labelled SIMULATED)
     ─► /api/summary → one-page PDF (FHIR IPS layout) from /data/personas
```
- The model never sees `check_red_flags`, `book_appointment` or `build_summary`; the server runs them.
- **Getting there:** Transit directions (Google Maps) and an Uber link with the drop-off filled in (the rider confirms in Uber).
- **Suggested times:** each person's usual free windows ∩ the place's opening hours (device only); after booking, add to the phone calendar (.ics) or Google Calendar.
- **One-tap booking (demo):** a DEMO clinic on Cal.com + Google Calendar free/busy → 3 suggested times → approve → booked with saved details → added to Google Calendar. Setup: `docs/booking-demo-setup.md` (runs offline without setup).
- **Assisted booking:** pharmacies with a verified online booking page (Shoppers Drug Mart and Rexall in AB/BC, B.C.'s Book a Pharmacist site) get a "Book online" button that opens the real page plus a booking helper with copy buttons for the store, an AI-written reason for visit, and the person's saved details. Booking details (name, health card, phone, email) are stored only in the browser, with consent, and are never sent to the server. "I booked it" saves the appointment to history, the PDF summary and an `.ics` calendar file.
- Province and location are injected by the server, not chosen by the model.
- AI provider is pluggable (`lib/llm/`): OpenAI Chat Completions with strict function calling (default when `OPENAI_API_KEY` is set), or the Claude Messages API. The safety gates, rule validation and source links are provider-independent.
- Tests: `npm test` covers red-flag rules (many languages), data parsing, and the agent loop with a scripted fake model.

## Layout
| Path | Purpose |
|---|---|
| `lib/safety/redFlags.ts` | `check_red_flags`: hard-coded rules (not AI) that always run first |
| `lib/tools/definitions.ts` | Tool schemas (provider-neutral) |
| `lib/llm/` | OpenAI + Claude adapters; provider chosen by env vars |
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
| `rules/<prov>/*.md` | Primary Care Alberta "Navigating care options", HealthLink BC, Navigate Care Alberta pharmacist list, BC minor-ailments checklist (links in each file) | **Draft – needs team/mentor review** |
| `data/personas/` | Synthea-format FHIR bundles (`scripts/make-personas.ts`) | 5 synthetic demo personas; swap in real Synthea output any time |

Rebuild facilities: `npm run fetch:osm && npm run build:facilities -- .osm-cache`

Attribution: map data © OpenStreetMap contributors (ODbL); BC walk-in clinics © Province of British Columbia (OGL-BC); boundaries from Natural Earth (public domain). The app must show these credits.
