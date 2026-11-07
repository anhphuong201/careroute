# One-tap booking demo – setup (about 20 minutes, free)

The demo shows the future flow: **your calendar + a clinic's real open times → 3 suggestions → you approve → booked with your saved details → added to your calendar.**
The clinic is a DEMO provider on Cal.com (real pharmacies have no public booking API yet).
Without any setup the demo still runs in *offline* mode with made-up times and no Google Calendar.

## 1. Google Calendar (busy times + add the appointment)
1. Go to https://console.cloud.google.com/ → create a project (e.g. "CareRoute").
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen:** User type **External**, app name "CareRoute", your email.
   - Scopes: add `.../auth/calendar.freebusy` and `.../auth/calendar.events`.
   - Leave publishing status on **Testing** and add your team's Gmail addresses as **Test users** (max 100). No Google review is needed in Testing mode; users will see an "unverified app" notice.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorized JavaScript origins: `https://<your-app>.vercel.app` and `http://localhost:3000`.
5. Copy the **Client ID** → Vercel → Settings → Environment Variables → `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. (A client ID is public; no client secret is used.)

## 2. Cal.com demo clinic (real open times + real booking)
1. Create a free account at https://cal.com/ (e.g. "CareRoute Demo Pharmacy").
2. Create an event type **"Pharmacist consultation (demo)"**, 30 minutes, and set availability (e.g. weekdays 9–17).
3. Open the event type; the number in the URL (`/event-types/123456`) is the **event type ID**.
4. **Settings → Developer → API keys →** create a key (starts with `cal_`).
5. Vercel → Environment Variables: `CALCOM_API_KEY` = the key (**secret**), `CALCOM_EVENT_TYPE_ID` = the number.
6. Redeploy. The demo sheet no longer says "offline demo".

## Privacy
- Google access token stays in the browser tab; CareRoute only reads free/busy (no event details) and adds the one appointment you approve.
- Booking details (name, email, phone, reason) go from the browser through `/api/demo-clinic/book` straight to Cal.com and are not stored or logged by CareRoute.
