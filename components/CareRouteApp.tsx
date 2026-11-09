"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STRINGS, type Lang, type Strings } from "@/lib/i18n";
import { ALL_REGIONS, PROVINCES, isEnabledProvince, type ProvinceCode } from "@/lib/provinces";
import { CITIES } from "@/lib/cities";
import { storage } from "@/lib/client/storage";
import type { AgeGroup, Household, HouseholdMember, SearchRecord } from "@/lib/types";
import type { AgentResult } from "@/lib/agent/runAgent";
import type { RedFlagAction, RedFlagCategory } from "@/lib/safety/redFlags";
import type { Booking } from "@/lib/tools/booking";
import { fmtMinute, fmtWeekday, openStatus, parseHours, weekLines } from "@/lib/data/hours";
import BookingHelper from "@/components/BookingHelper";
import SmartBook, { type DemoBooked } from "@/components/SmartBook";
import { DEMO_CLINIC_DISPLAY } from "@/lib/demoClinicConfig";
import { icsFor } from "@/lib/client/bookingHelper";
import { FREE_WINDOWS, googleCalendarUrl } from "@/lib/client/suggest";
import { tzLabel, zonedDate, zonedParts } from "@/lib/data/tz";
import { arriveBy, transitArriveByUrl, uberRideUrl, type TravelPlace } from "@/lib/client/travel";

type Screen =
  | "onboard" | "home" | "household" | "check" | "need" | "loading" | "emergency"
  | "result" | "book" | "booked" | "clarify" | "history" | "records" | "error";
type RouteResult = Extract<AgentResult, { type: "route" }>;
type Option = RouteResult["facilities"][number];
type Persona = { id: string; name: string; note: string; birthDate: string; province: string };

/* ───────────────────────── helpers ───────────────────────── */

/**
 * Google Maps link that shows the place by NAME (not raw coordinates).
 * With a street address: directions to "name, address, city".
 * Without one (common in OpenStreetMap): search the name centred on the exact location,
 * so "Shoppers Drug Mart" lands on this branch, not another one in the city.
 */
const hasStreet = (a: string) => /\d/.test(a.split(",")[0] ?? "");
const mapsUrl = (f: { name: string; address: string; city: string; lat: number; lng: number }) =>
  hasStreet(f.address)
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([f.name, f.address, f.city].filter(Boolean).join(", "))}`
    : `https://www.google.com/maps/search/${encodeURIComponent(f.name)}/@${f.lat},${f.lng},18z`;

/** Google Maps public-transit directions to the place. */
const transitUrl = (f: { name: string; address: string; city: string; lat: number; lng: number }) => {
  const dest = hasStreet(f.address) ? [f.name, f.address, f.city].filter(Boolean).join(", ") : `${f.lat},${f.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=transit`;
};

/**
 * Uber universal link: opens the Uber app (or m.uber.com) with the drop-off filled in.
 * The rider still chooses the car, sees the price and confirms inside Uber – nothing is booked here.
 */
const uberUrl = (f: { name: string; address: string; city: string; lat: number; lng: number }) => {
  const q = new URLSearchParams({
    action: "setPickup",
    pickup: "my_location",
    "dropoff[latitude]": String(f.lat),
    "dropoff[longitude]": String(f.lng),
    "dropoff[nickname]": f.name,
    "dropoff[formatted_address]": [f.address, f.city].filter(Boolean).join(", ") || f.name,
  });
  return `https://m.uber.com/ul/?${q.toString()}`;
};

const fullAddress = (f: { address: string; city: string }) =>
  f.city && !f.address.toLowerCase().includes(f.city.toLowerCase()) ? [f.address, f.city].filter(Boolean).join(", ") : f.address || f.city;

/** Add or remove a phrase from the free-text need ("Sore throat. A few days."). */
function toggleItem(text: string, item: string): string {
  const parts = text.split(/\.\s*/).map((p) => p.trim()).filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase() === item.toLowerCase());
  if (i >= 0) parts.splice(i, 1);
  else parts.push(item);
  return parts.length ? parts.join(". ") + "." : "";
}

const uid = () => Math.random().toString(36).slice(2, 10);
const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
const fmtWait = (m: number, t: Strings) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} ${t.min}` : `${m} ${t.min}`);

function ageMonths(m: HouseholdMember): number | undefined {
  if (m.birthDate) {
    const b = new Date(m.birthDate);
    if (!Number.isNaN(b.getTime())) {
      const n = new Date();
      return Math.max(0, (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth() - (n.getDate() < b.getDate() ? 1 : 0));
    }
  }
  // Unknown birth date: treat a baby as the youngest age, so the infant-fever safety rule still applies.
  return m.ageGroup === "infant" ? 0 : undefined;
}

const TZ: Record<ProvinceCode, string> = { AB: "America/Edmonton", BC: "America/Vancouver" };

const KIND_ICON: Record<string, string> = { pharmacy: "💊", walk_in: "🏥", urgent_care: "🚑", emergency: "🏨", clinic: "🩺", virtual: "📹" };
const ROUTE_ICON: Record<string, string> = { pharmacist: "💊", virtual_care: "📹", walk_in: "🏥", call_811: "📞", registry: "👩‍⚕️", family_doctor: "🩺" };

const DEMO: Record<ProvinceCode, HouseholdMember[]> = {
  AB: [
    { id: "m-amira", displayName: "Amira", ageGroup: "adult", hasFamilyDoctor: "no", personaId: "amira-haddad", birthDate: "1993-04-12" },
    { id: "m-lily", displayName: "Lily", ageGroup: "child", hasFamilyDoctor: "no", personaId: "lily-haddad", birthDate: "2019-01-22" },
    { id: "m-noah", displayName: "Noah", ageGroup: "infant", hasFamilyDoctor: "no", personaId: "noah-haddad", birthDate: "2026-08-25" },
    { id: "m-david", displayName: "David", ageGroup: "adult", hasFamilyDoctor: "hard_to_access", personaId: "david-tremblay", birthDate: "1968-11-02" },
  ],
  BC: [{ id: "m-jun", displayName: "Jun", ageGroup: "adult", hasFamilyDoctor: "no", personaId: "jun-chen", birthDate: "2001-07-30" }],
};

/** Next 7 days (noon of each day in the province's zone); slots every 30 min, 8:00–19:30, ≥ 1 h from now. */
function days(tz: string, n = 7) {
  const p = zonedParts(new Date(), tz);
  return Array.from({ length: n }, (_, i) => zonedDate(p.year, p.month, p.day + i, 12, 0, tz));
}
function slots(day: Date, tz: string) {
  const out: Date[] = [];
  const min = Date.now() + 3600000;
  const p = zonedParts(day, tz);
  for (let h = 8; h < 20; h++)
    for (const m of [0, 30]) {
      const s = zonedDate(p.year, p.month, p.day, h, m, tz);
      if (s.getTime() > min) out.push(s);
    }
  return out;
}

/* ───────────────────────── app ───────────────────────── */

export default function CareRouteApp() {
  const [lang, setLang] = useState<Lang>("en");
  const t: Strings = STRINGS[lang];
  const loc = lang === "fr" ? "fr-CA" : "en-CA";
  const [consent, setConsent] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [province, setProvince] = useState<ProvinceCode>("AB");
  const [household, setHousehold] = useState<Household>({ id: uid(), province: "AB", members: [] });
  const [memberId, setMemberId] = useState<string | null>(null);
  const [guest, setGuest] = useState<HouseholdMember>({ id: "guest", displayName: "", ageGroup: "adult", hasFamilyDoctor: "no" });
  const [text, setText] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState("");
  const [locStatus, setLocStatus] = useState<"idle" | "asking" | "on" | "denied">("idle");
  const [checklist, setChecklist] = useState<Partial<Record<RedFlagCategory, boolean>>>({});
  const [emergency, setEmergency] = useState<RedFlagAction | null>(null);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [clarifyQ, setClarifyQ] = useState("");
  const [clarifyA, setClarifyA] = useState("");
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<Option | null>(null);
  const [helperFor, setHelperFor] = useState<Option | null>(null);
  const [smartOpen, setSmartOpen] = useState(false);
  const [gcalLink, setGcalLink] = useState<string | null>(null);
  /** Where the confirmed appointment is (for transit / Uber links). */
  const [bookedPlace, setBookedPlace] = useState<TravelPlace | null>(null);
  const [editMemberId, setEditMemberId] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [history, setHistory] = useState<SearchRecord[]>([]);
  const live = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = storage.lang();
    const l = (saved ?? navigator.language.slice(0, 2)) as Lang;
    if (l in STRINGS) setLang(l);
    const c = storage.consent();
    setConsent(c);
    const h = storage.household();
    if (h) {
      setHousehold(h);
      setProvince(h.province);
    }
    setHistory(storage.history());
    try {
      if (!localStorage.getItem("careroute.onboarded")) setScreen("onboard");
    } catch {
      /* storage blocked – skip onboarding */
    }
    fetch("/api/personas").then((r) => r.json()).then(setPersonas).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    live.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [screen]);

  const members = household.members;
  const member: HouseholdMember = members.find((m) => m.id === memberId) ?? guest;
  // Set after mount: the page is pre-rendered, so the server's clock must not decide the greeting.
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []); // greeting follows the person's own clock
  const greeting = hour === null ? t.hello : hour < 12 ? t.goodMorning : hour < 18 ? t.goodAfternoon : t.goodEvening;

  function saveHousehold(h: Household) {
    setHousehold(h);
    storage.saveHousehold(h);
  }
  function chooseProvince(p: ProvinceCode) {
    setProvince(p);
    setLocation(null);
    setCity("");
    setLocStatus("idle");
    saveHousehold({ ...household, province: p });
  }
  function askLocation() {
    if (!("geolocation" in navigator)) return setLocStatus("denied");
    setLocStatus("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCity("");
        setLocStatus("on");
      },
      () => setLocStatus("denied"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }
  function pickCity(name: string) {
    setCity(name);
    const c = CITIES[province].find((x) => x.name === name);
    setLocation(c ? { lat: c.lat, lng: c.lng } : null);
    if (c) setLocStatus("idle");
  }
  function record(r: Pick<SearchRecord, "route" | "reason" | "sourceUrl"> & Partial<SearchRecord>) {
    storage.addHistory({ id: uid(), memberId: member.id, createdAt: new Date().toISOString(), province, ...r });
    setHistory(storage.history());
  }
  function flag(category: RedFlagCategory) {
    const action: RedFlagAction = category === "suicidal_thoughts" ? "call_911_or_988" : category === "infant_fever" ? "call_811" : "call_911";
    setChecklist({ ...checklist, [category]: true });
    setEmergency(action);
    record({ route: "emergency", reason: "safety checklist", sourceUrl: "" });
    setScreen("emergency");
  }
  /** Every new search starts with the safety check. */
  function startSearch(prefill?: string) {
    if (prefill !== undefined) setText(prefill);
    setChecklist({});
    setResult(null);
    setBooking(null);
    setChosen(null);
    setScreen("check");
  }

  async function submit(extra?: string) {
    const fullText = extra ? `${text}\n\n${clarifyQ}\n${extra}` : text;
    setScreen("loading");
    setBooking(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          province, text: fullText, ageGroup: member.ageGroup, ageMonths: ageMonths(member),
          hasFamilyDoctor: member.hasFamilyDoctor, checklist, location, city: city || undefined,
        }),
      });
      const data = (await res.json()) as AgentResult;
      if (data.type === "emergency") {
        setEmergency(data.action);
        record({ route: "emergency", reason: `safety rules (${data.stage})`, sourceUrl: "" });
        setScreen("emergency");
      } else if (data.type === "route") {
        setResult(data);
        record({ route: data.rule.route, routeTitle: data.rule.title, reason: data.reason, sourceUrl: data.rule.source_url, language: data.language });
        setScreen("result");
      } else if (data.type === "clarify") {
        if (!data.question) return setScreen("need");
        setClarifyQ(data.question);
        setClarifyA("");
        setScreen("clarify");
      } else {
        setError(data.message === "missing_api_key" || data.message === "invalid_api_key" ? t.errorKey : t.errorGeneric);
        setScreen("error");
      }
    } catch {
      setError(t.errorGeneric);
      setScreen("error");
    }
  }

  async function confirmBooking(slot: Date) {
    if (!chosen || !result) return;
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ province, facility_id: chosen.id, member_name: member.displayName || t.me, approved: true, slot: slot.toISOString() }),
    });
    if (!res.ok) return setScreen("error");
    const b = (await res.json()) as Booking;
    setBooking(b);
    setBookedPlace(chosen.kind === "virtual" ? null : { name: chosen.name, address: chosen.address, city: chosen.city, lat: chosen.lat, lng: chosen.lng });
    record({ route: result.rule.route, routeTitle: result.rule.title, reason: result.reason, sourceUrl: result.rule.source_url, bookingCode: b.confirmation_code });
    setScreen("booked");
  }

  function saveRealBooking(f: Option, b: { when: Date; code: string }) {
    const real: Booking = {
      simulated: false,
      confirmation_code: b.code,
      facility_id: f.id,
      facility_name: f.name,
      facility_address: fullAddress(f),
      for_member: member.displayName || t.me,
      slot: b.when.toISOString(),
      instructions: f.kind === "pharmacy" ? "Bring your health card and your medicine bottle or list." : "Bring your health card, your medicine list and your CareRoute summary.",
    };
    setBooking(real);
    setGcalLink(null);
    setBookedPlace(f.kind === "virtual" ? null : { name: f.name, address: f.address, city: f.city, lat: f.lat, lng: f.lng });
    if (result)
      record({
        route: result.rule.route, routeTitle: result.rule.title, reason: result.reason, sourceUrl: result.rule.source_url,
        bookingCode: b.code || undefined, bookingPlace: f.name, bookingTime: real.slot, bookingReal: true,
      });
    setHelperFor(null);
    setScreen("booked");
  }

  function saveDemoBooking(d: DemoBooked) {
    const b: Booking = {
      simulated: true, // demo provider, not a real pharmacy
      confirmation_code: d.uid,
      facility_id: "demo-clinic",
      facility_name: DEMO_CLINIC_DISPLAY.badge ? `${d.clinicName} (DEMO)` : d.clinicName,
      facility_address: DEMO_CLINIC_DISPLAY.address,
      for_member: member.displayName || t.me,
      slot: d.start,
      instructions: "Demo booking made through the clinic's booking system. Bring your health card and medicine list.",
    };
    setBooking(b);
    setGcalLink(d.calendarLink === undefined ? null : d.calendarLink ?? "");
    const demo = DEMO_CLINIC_DISPLAY;
    setBookedPlace(demo.lat || /\d/.test(demo.address) ? { name: demo.name, address: demo.address, city: "", lat: demo.lat, lng: demo.lng } : null);
    if (result)
      record({ route: result.rule.route, routeTitle: result.rule.title, reason: result.reason, sourceUrl: result.rule.source_url, bookingCode: d.uid, bookingPlace: b.facility_name, bookingTime: d.start });
    setSmartOpen(false);
    setScreen("booked");
  }

  function downloadCalendar(b: Booking) {
    const ics = icsFor({
      title: `${b.simulated ? "[SIMULATED] " : ""}Appointment – ${b.facility_name}`,
      start: new Date(b.slot),
      location: b.facility_address,
      description: [
        result?.booking_note,
        b.confirmation_code ? `Confirmation: ${b.confirmation_code}` : "",
        "Bring your health card and medicine list.",
        bookedPlace ? `Transit (arrive by): ${transitArriveByUrl(bookedPlace, new Date(b.slot), TZ[province], locStatus === "on" ? location : null)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      uid: `${b.confirmation_code || b.slot}@careroute`,
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "careroute-appointment.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function downloadSummary(m: HouseholdMember) {
    if (!m.personaId) return;
    const forThisSearch = m.id === member.id;
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        persona_id: m.personaId,
        visit: forThisSearch
          ? {
              province,
              needSummaryEn: result?.need_summary_en,
              routeTitle: result?.rule.title,
              routeSourceUrl: result?.rule.source_url,
              booking: booking ? { facility_name: booking.facility_name, slot: booking.slot, confirmation_code: booking.confirmation_code, simulated: booking.simulated } : undefined,
            }
          : { province },
      }),
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `careroute-summary-${m.personaId}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const sheetOpen = !!helperFor || smartOpen;
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHelperFor(null);
        setSmartOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  const showNav = !["onboard", "emergency", "loading", "book"].includes(screen);

  if (screen === "onboard")
    return (
      <Onboarding
        t={t}
        onStart={() => {
          try {
            localStorage.setItem("careroute.onboarded", "1");
          } catch {
            /* ignore */
          }
          setScreen("home");
        }}
      />
    );

  return (
    <div className={`app ${screen === "emergency" ? "app-emergency" : ""}`}>
      <header className="topbar">
        <div className="who">
          <span className="avatar" aria-hidden>
            {member.displayName ? initial(member.displayName) : "🙂"}
          </span>
          <span>
            <span className="who-name">{member.displayName || t.hello}</span>
            <span className="who-sub">{greeting}</span>
          </span>
        </div>
        <label className="icon-btn" title={t.language}>
          <span className="sr-only">{t.language}</span>
          <span aria-hidden>🌐</span>
          <select
            value={lang}
            onChange={(e) => {
              setLang(e.target.value as Lang);
              storage.setLang(e.target.value);
            }}
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </label>
      </header>

      {screen !== "emergency" && (
        <a className="emergency-banner" href="tel:911">
          {t.emergencyBanner}
        </a>
      )}

      <main>
        <div ref={live} tabIndex={-1} aria-live="polite" className="screen">
          {screen === "home" && (
            <section>
              <h1 className="hero-title">{t.heroTitle}</h1>
              <button className="search" onClick={() => startSearch(text)}>
                <span aria-hidden>🔍</span>
                <span className="search-ph">{text || t.searchPlaceholder}</span>
              </button>

              <label className="label" htmlFor="province">
                📍 {t.province}
              </label>
              <div className="province-picker">
                <select id="province" value={province} onChange={(e) => isEnabledProvince(e.target.value) && chooseProvince(e.target.value)}>
                  {ALL_REGIONS.map((r) => (
                    <option key={r.code} value={r.code} disabled={!isEnabledProvince(r.code)}>
                      {lang === "fr" ? r.nameFr : r.name}
                      {isEnabledProvince(r.code) ? "" : ` – ${t.comingSoon}`}
                    </option>
                  ))}
                </select>
              </div>
              <p className="help small">{t.provinceNote}</p>

              <SectionHead title={t.categories} />
              <div className="cat-scroll">
                {(
                  [
                    ["💊", t.catRenewal, t.exRenewal],
                    ["🧪", t.catLab, t.exLab],
                    ["🩹", t.catSymptom, t.exMinor],
                    ["📹", t.catVirtual, t.catVirtualText],
                    ["👩‍⚕️", t.catDoctor, t.catDoctorText],
                  ] as [string, string, string][]
                ).map(([icon, label, prefill], i) => (
                  <button key={label} className={`cat ${i === 0 ? "cat-primary" : ""}`} onClick={() => startSearch(prefill)}>
                    <span className="cat-icon" aria-hidden>
                      {icon}
                    </span>
                    {label}
                  </button>
                ))}
              </div>

              <SectionHead title={t.commonSymptoms} />
              <div className="chips">
                {t.symptoms.slice(0, 8).map((sym) => (
                  <button key={sym} className="chip" onClick={() => startSearch(sym)}>
                    {sym}
                  </button>
                ))}
              </div>

              <SectionHead title={t.whoNeedsCare} action={t.myHousehold} onAction={() => setScreen("household")} />
              <div className="people">
                <PersonChip label={t.me} sub={t[guest.ageGroup]} on={memberId === null} onClick={() => setMemberId(null)} />
                {members.map((m) => (
                  <PersonChip key={m.id} label={m.displayName} sub={t[m.ageGroup]} on={memberId === m.id} onClick={() => setMemberId(m.id)} />
                ))}
                <button className="person person-add" onClick={() => setScreen("household")}>
                  <span className="avatar avatar-lg avatar-add" aria-hidden>
                    +
                  </span>
                  <span className="person-name">{t.addPerson}</span>
                </button>
              </div>

              {memberId === null && (
                <div className="card">
                  <MemberQuestions t={t} m={guest} onChange={setGuest} />
                </div>
              )}

              <button className="btn" onClick={() => startSearch()}>
                {t.continue} →
              </button>
            </section>
          )}

          {screen === "household" && (
            <HouseholdEditor
              t={t}
              household={household}
              province={province}
              personas={personas}
              consent={consent}
              onConsent={(v) => {
                setConsent(v);
                storage.setConsent(v);
                if (v) storage.saveHousehold(household);
                else setHistory([]);
              }}
              onSave={saveHousehold}
              onDemo={() => saveHousehold({ ...household, members: DEMO[province] })}
              editId={editMemberId}
              guest={guest}
              onSelect={setMemberId}
              onDone={() => {
                setEditMemberId(null);
                setScreen(result ? "result" : "home");
              }}
            />
          )}

          {screen === "check" && (
            <section>
              <BackLink t={t} onClick={() => setScreen("home")} />
              <h1>{t.checkTitle}</h1>
              <p>{t.checkIntro}</p>
              <div className="stack">
                {(
                  [
                    ["chest_pain", t.flagChest, "❤️"],
                    ["breathing", t.flagBreathing, "🫁"],
                    ["stroke_signs", t.flagStroke, "🧠"],
                    ["severe_bleeding", t.flagBleeding, "🩸"],
                    ["suicidal_thoughts", t.flagSuicide, "💬"],
                    ...(member.ageGroup === "infant" ? [["infant_fever", t.flagInfantFever, "🌡️"]] : []),
                  ] as [RedFlagCategory, string, string][]
                ).map(([c, label, icon]) => (
                  <button key={c} className="flag" onClick={() => flag(c)}>
                    <span className="flag-icon" aria-hidden>
                      {icon}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
              <button className="btn" onClick={() => setScreen("need")}>
                ✓ {t.noneOfThese}
              </button>
            </section>
          )}

          {screen === "need" && (
            <section>
              <BackLink t={t} onClick={() => setScreen("check")} />
              <h1>{t.needTitle}</h1>
              <label htmlFor="need" className="help">
                {t.needHelp}
              </label>
              <textarea id="need" rows={5} value={text} placeholder={t.needPlaceholder} onChange={(e) => setText(e.target.value)} />
              <p className="label">{t.commonSymptoms}</p>
              <p className="help small">{t.tapToAdd}</p>
              <div className="chips">
                {[...t.symptoms, t.exRenewal, t.exLab].map((ex) => {
                  const on = text.toLowerCase().includes(ex.toLowerCase());
                  return (
                    <button key={ex} className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setText(toggleItem(text, ex))}>
                      {on ? "✓ " : ""}
                      {ex}
                    </button>
                  );
                })}
              </div>
              <p className="label">{t.howLong}</p>
              <div className="chips">
                {t.durations.map((d) => {
                  const on = text.toLowerCase().includes(d.toLowerCase());
                  return (
                    <button key={d} className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setText(toggleItem(text, d))}>
                      {d}
                    </button>
                  );
                })}
              </div>
              <SectionHead title={t.location} />
              <button className={`btn btn-soft ${locStatus === "on" ? "is-on" : ""}`} onClick={askLocation} aria-pressed={locStatus === "on"}>
                📍 {locStatus === "on" ? t.locationOn : t.useMyLocation}
              </button>
              <label className="label" htmlFor="city">
                {t.orChooseCity}
              </label>
              <select id="city" value={city} onChange={(e) => pickCity(e.target.value)}>
                <option value="">—</option>
                {CITIES[province].map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
              <button className="btn" disabled={!text.trim()} onClick={() => submit()}>
                {t.findCare} →
              </button>
            </section>
          )}

          {screen === "loading" && (
            <section className="center">
              <div className="spinner" aria-hidden />
              <p className="big">{t.thinking}</p>
            </section>
          )}

          {screen === "clarify" && (
            <section>
              <h1>{t.clarify}</h1>
              <p className="big">{clarifyQ}</p>
              <label htmlFor="ans" className="label">
                {t.answer}
              </label>
              <textarea id="ans" rows={3} value={clarifyA} onChange={(e) => setClarifyA(e.target.value)} />
              <button className="btn" disabled={!clarifyA.trim()} onClick={() => submit(clarifyA)}>
                {t.continue}
              </button>
            </section>
          )}

          {screen === "emergency" && emergency && <Emergency t={t} action={emergency} onBack={() => { setChecklist({}); setScreen("need"); }} />}

          {screen === "result" && result && (
            <Result
              t={t}
              loc={loc}
              province={province}
              location={location}
              result={result}
              onChoose={(o) => {
                setChosen(o);
                setScreen("book");
              }}
              onHelper={setHelperFor}
              onSmart={() => setSmartOpen(true)}
              onNeedLocation={() => setScreen("need")}
            />
          )}

          {screen === "book" && chosen && result && (
            <BookScreen t={t} loc={loc} tz={TZ[province]} option={chosen} waitsSource={result.er_waits_source} onBack={() => setScreen("result")} onConfirm={confirmBooking} />
          )}

          {screen === "booked" && booking && (
            <section>
              <div className="card card-booked" role="status">
                {booking.simulated ? <span className="badge">{t.simulated}</span> : <span className="badge badge-real">{t.realBooking}</span>}
                <h1>✅ {t.booked}</h1>
                <p className="big">
                  <strong>{booking.facility_name}</strong>
                  <br />
                  <span className="muted">{booking.facility_address}</span>
                </p>
                <div className="stats">
                  <Stat icon="📅" value={new Date(booking.slot).toLocaleDateString(loc, { timeZone: TZ[province], weekday: "short", month: "short", day: "numeric" })} label={t.dateLabel} />
                  <Stat icon="🕒" value={`${new Date(booking.slot).toLocaleTimeString(loc, { timeZone: TZ[province], hour: "numeric", minute: "2-digit" })} ${tzLabel(TZ[province], loc, new Date(booking.slot))}`} label={t.time} />
                  {booking.confirmation_code && <Stat icon="#" value={booking.confirmation_code} label={t.confirmation} />}
                </div>
                <p>
                  <strong>{t.bring}:</strong> {booking.instructions}
                </p>
                {bookedPlace && (
                  <GettingThere
                    t={t}
                    loc={loc}
                    tz={TZ[province]}
                    place={bookedPlace}
                    appointment={new Date(booking.slot)}
                    from={locStatus === "on" ? location : null}
                  />
                )}
                {gcalLink !== null && (
                  <p className="saved-gcal">
                    ✅ {t.savedToGcal}
                    {gcalLink ? (
                      <>
                        {" "}
                        <a href={gcalLink} target="_blank" rel="noreferrer">
                          ↗
                        </a>
                      </>
                    ) : null}
                  </p>
                )}
                <button className="btn btn-soft" onClick={() => downloadCalendar(booking)}>
                  📆 {t.addToCalendar}
                </button>
                <a
                  className="btn btn-ghost"
                  target="_blank"
                  rel="noreferrer"
                  href={googleCalendarUrl({
                    title: `${booking.simulated ? "[SIMULATED] " : ""}Appointment – ${booking.facility_name}`,
                    start: new Date(booking.slot),
                    location: booking.facility_address,
                    details: [result?.booking_note, booking.confirmation_code ? `Confirmation: ${booking.confirmation_code}` : ""].filter(Boolean).join("\n"),
                  })}
                >
                  📅 {t.addGoogleCal} ↗
                </a>
              </div>
              <SummaryCard t={t} member={member} onDownload={() => downloadSummary(member)} />
              <button className="btn btn-ghost" onClick={() => setScreen("result")}>
                ← {t.back}
              </button>
            </section>
          )}

          {screen === "history" && (
            <section>
              <h1>{t.myHistory}</h1>
              {!consent && <p className="help">{t.consentHelp}</p>}
              {history.length === 0 && <p className="muted">{t.historyEmpty}</p>}
              <ul className="list">
                {history.map((h) => {
                  const who = members.find((m) => m.id === h.memberId)?.displayName;
                  return (
                    <li key={h.id} className="card history-item">
                      <span className={`tile ${h.route === "emergency" ? "tile-danger" : ""}`} aria-hidden>
                        {h.route === "emergency" ? "🚨" : ROUTE_ICON[h.route] ?? "•"}
                      </span>
                      <div>
                        <strong>{h.route === "emergency" ? "911 / 988 / 811" : t.routeNames[h.route] ?? h.route}</strong>
                        <div className="muted small">
                          {new Date(h.createdAt).toLocaleString(loc, { timeZone: TZ[h.province] ?? undefined, dateStyle: "medium", timeStyle: "short" })} · {h.province}
                          {who ? ` · ${who}` : ""}
                        </div>
                        {h.route !== "emergency" && <p className="small">{h.reason}</p>}
                        <div className="row">
                          {h.sourceUrl && (
                            <a className="link-small" href={h.sourceUrl} target="_blank" rel="noreferrer">
                              {t.source} ↗
                            </a>
                          )}
                          {h.bookingReal ? (
                            <span className="badge badge-real">
                              {t.realBooking} · {h.bookingPlace}
                              {h.bookingTime ? ` · ${new Date(h.bookingTime).toLocaleString(loc, { timeZone: TZ[h.province] ?? undefined, dateStyle: "medium", timeStyle: "short" })}` : ""}
                            </span>
                          ) : (
                            h.bookingCode && <span className="badge">{t.simulated} · {h.bookingCode}</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {screen === "records" && (
            <section>
              <h1>{t.recordsTitle}</h1>
              <p className="muted">{t.summaryBody}</p>
              {members.filter((m) => m.personaId).length === 0 && <p>{t.recordsEmpty}</p>}
              <ul className="list">
                {members
                  .filter((m) => m.personaId)
                  .map((m) => (
                    <li key={m.id} className="card row-between">
                      <span className="row-center">
                        <span className="avatar" aria-hidden>
                          {initial(m.displayName)}
                        </span>
                        <span>
                          <strong>{m.displayName}</strong>
                          <span className="muted small block">{t[m.ageGroup]}</span>
                        </span>
                      </span>
                      <button className="btn-small" onClick={() => downloadSummary(m)}>
                        📄 PDF
                      </button>
                    </li>
                  ))}
              </ul>
              {members.filter((m) => m.personaId).length === 0 && (
                <button className="btn btn-soft" onClick={() => setScreen("household")}>
                  👪 {t.myHousehold}
                </button>
              )}
            </section>
          )}

          {screen === "error" && (
            <section>
              <h1>⚠️</h1>
              <p className="big">{error || t.errorGeneric}</p>
              <a className="btn btn-soft" href="tel:811">
                📞 {t.call811}
              </a>
              <button className="btn btn-ghost" onClick={() => setScreen("need")}>
                ← {t.back}
              </button>
            </section>
          )}
        </div>
        <footer>
          <p>{t.notAdvice}</p>
          <p className="muted small">{t.attribution}</p>
        </footer>
      </main>

      {helperFor && result && (
        <BookingHelper
          t={t}
          lang={lang}
          tz={TZ[province]}
          place={helperFor}
          member={member}
          reason={result.booking_note}
          onClose={() => setHelperFor(null)}
          onSaved={(b) => saveRealBooking(helperFor, b)}
          onAddDetails={() => {
            setHelperFor(null);
            setEditMemberId(member.id);
            setScreen("household");
          }}
        />
      )}

      {smartOpen && result && (
        <SmartBook
          t={t}
          lang={lang}
          tz={TZ[province]}
          member={member}
          reason={result.booking_note}
          onClose={() => setSmartOpen(false)}
          onBooked={saveDemoBooking}
          onAddDetails={() => {
            setSmartOpen(false);
            setEditMemberId(member.id);
            setScreen("household");
          }}
        />
      )}

      {showNav && !helperFor && !smartOpen && (
        <nav className="bottom-nav" aria-label="Main">
          <NavBtn icon="🏠" label={t.navHome} on={screen === "home"} onClick={() => setScreen("home")} />
          <NavBtn icon="🕘" label={t.navHistory} on={screen === "history"} onClick={() => setScreen("history")} />
          <button className="fab" aria-label={t.navNew} onClick={() => startSearch("")}>
            +
          </button>
          <NavBtn icon="👪" label={t.navFamily} on={screen === "household"} onClick={() => setScreen("household")} />
          <NavBtn icon="📄" label={t.navRecords} on={screen === "records"} onClick={() => setScreen("records")} />
        </nav>
      )}
    </div>
  );
}

/* ───────────────────────── small pieces ───────────────────────── */

function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {action && (
        <button className="link-btn" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

function BackLink({ t, onClick }: { t: Strings; onClick: () => void }) {
  return (
    <button className="back" onClick={onClick} aria-label={t.back}>
      ←
    </button>
  );
}

function PersonChip({ label, sub, on, onClick }: { label: string; sub: string; on: boolean; onClick: () => void }) {
  sub = sub.replace(/\s*\(.*\)\s*$/, "");
  return (
    <button className={`person ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>
      <span className="avatar avatar-lg" aria-hidden>
        {initial(label)}
      </span>
      <span className="person-name">{label}</span>
      <span className="person-sub">{sub}</span>
    </button>
  );
}

function NavBtn({ icon, label, on, onClick }: { icon: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`nav-btn ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} onClick={onClick}>
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Stat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-icon" aria-hidden>
        {icon}
      </span>
      <span>
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </span>
    </div>
  );
}

function SummaryCard({ t, member, onDownload }: { t: Strings; member: HouseholdMember; onDownload: () => void }) {
  return (
    <div className="card">
      <h2>📄 {t.summaryTitle}</h2>
      <p className="muted">{t.summaryBody}</p>
      {member.personaId ? (
        <button className="btn btn-soft" onClick={onDownload}>
          {t.downloadSummary}
        </button>
      ) : (
        <p className="muted small">{t.noRecord}</p>
      )}
    </div>
  );
}

function MemberQuestions({ t, m, onChange }: { t: Strings; m: HouseholdMember; onChange: (m: HouseholdMember) => void }) {
  return (
    <>
      <p className="label">{t.ageGroup}</p>
      <div className="segmented segmented-3">
        {(["infant", "child", "adult"] as AgeGroup[]).map((a) => (
          <button key={a} className={m.ageGroup === a ? "on" : ""} aria-pressed={m.ageGroup === a} onClick={() => onChange({ ...m, ageGroup: a })}>
            {t[a]}
          </button>
        ))}
      </div>
      <p className="label">{t.familyDoctor}</p>
      <div className="segmented segmented-3">
        {(
          [
            ["yes", t.yes],
            ["no", t.no],
            ["hard_to_access", t.hardToReach],
          ] as [HouseholdMember["hasFamilyDoctor"], string][]
        ).map(([v, label]) => (
          <button key={v} className={m.hasFamilyDoctor === v ? "on" : ""} aria-pressed={m.hasFamilyDoctor === v} onClick={() => onChange({ ...m, hasFamilyDoctor: v })}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

function Onboarding({ t, onStart }: { t: Strings; onStart: () => void }) {
  return (
    <div className="onboard">
      <div className="onboard-deco" aria-hidden />
      <p className="onboard-brand">
        <span aria-hidden>➜</span> {t.onboardBrand}
      </p>
      <h1>{t.onboardTitle}</h1>
      <div className="onboard-card">
        <h2>{t.onboardCard}</h2>
        <div className="onboard-icons" aria-hidden>
          <span>💊</span>
          <span>🏥</span>
          <span>📹</span>
          <span>📞</span>
        </div>
        <p>{t.onboardBody}</p>
      </div>
      <button className="onboard-go" onClick={onStart} aria-label={t.getStarted}>
        <span>{t.getStarted}</span>
        <span className="onboard-arrow" aria-hidden>
          ↗
        </span>
      </button>
      <a className="onboard-911" href="tel:911">
        {t.emergencyBanner}
      </a>
    </div>
  );
}

function HouseholdEditor(props: {
  t: Strings;
  household: Household;
  province: ProvinceCode;
  personas: Persona[];
  consent: boolean;
  onConsent: (v: boolean) => void;
  onSave: (h: Household) => void;
  onDemo: () => void;
  editId?: string | null;
  guest?: HouseholdMember;
  onSelect?: (id: string) => void;
  onDone: () => void;
}) {
  const { t, household, personas } = props;
  const blank: HouseholdMember = { id: "", displayName: "", ageGroup: "adult", hasFamilyDoctor: "no" };
  // Opened from the booking helper: edit that person (or turn "Me" into a saved person).
  const [draft, setDraft] = useState<HouseholdMember | null>(() => {
    if (!props.editId) return null;
    const m = household.members.find((x) => x.id === props.editId);
    if (m) return { ...m };
    if (props.editId === "guest" && props.guest) return { ...props.guest, id: "", displayName: props.guest.displayName || t.me };
    return null;
  });
  const setContact = (k: keyof NonNullable<HouseholdMember["contact"]>, v: string) =>
    draft && setDraft({ ...draft, contact: { ...(draft.contact ?? {}), [k]: v } });

  return (
    <section>
      <h1>{t.myHousehold}</h1>
      <label className="consent card">
        <input type="checkbox" checked={props.consent} onChange={(e) => props.onConsent(e.target.checked)} />
        <span>
          {t.consent}
          <span className="muted small block">{t.consentHelp}</span>
        </span>
      </label>

      <ul className="list">
        {household.members.map((m) => (
          <li key={m.id} className="card row-between">
            <span className="row-center">
              <span className="avatar" aria-hidden>
                {initial(m.displayName)}
              </span>
              <span>
                <strong>{m.displayName}</strong>
                <span className="muted small block">
                  {t[m.ageGroup]} · {m.hasFamilyDoctor === "yes" ? t.yes : m.hasFamilyDoctor === "no" ? t.no : t.hardToReach}
                </span>
              </span>
            </span>
            <span className="row">
              <button className="btn-small" onClick={() => setDraft({ ...m })}>
                ✏️
                <span className="sr-only">{m.displayName}</span>
              </button>
              <button className="btn-small" onClick={() => props.onSave({ ...household, members: household.members.filter((x) => x.id !== m.id) })}>
                {t.remove}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="card">
          <label className="label" htmlFor="mname">
            {t.name}
          </label>
          <input id="mname" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
          <MemberQuestions t={t} m={draft} onChange={setDraft} />
          <label className="label" htmlFor="mbirth">
            {t.birthDate}
          </label>
          <input id="mbirth" type="date" value={draft.birthDate ?? ""} onChange={(e) => setDraft({ ...draft, birthDate: e.target.value || undefined })} />
          <label className="label" htmlFor="mpersona">
            {t.demoRecord}
          </label>
          <select id="mpersona" value={draft.personaId ?? ""} onChange={(e) => setDraft({ ...draft, personaId: e.target.value || undefined })}>
            <option value="">{t.none}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} – {p.note}
              </option>
            ))}
          </select>
          <fieldset className="contact-fields">
            <legend>🔒 {t.bookingDetails}</legend>
            <p className="small muted">{t.bookingDetailsHelp}</p>
            <label className="label" htmlFor="c-name">
              {t.legalName}
            </label>
            <input id="c-name" autoComplete="name" value={draft.contact?.legalName ?? ""} onChange={(e) => setContact("legalName", e.target.value)} />
            <label className="label" htmlFor="c-card">
              {t.healthCard}
            </label>
            <input id="c-card" inputMode="numeric" autoComplete="off" value={draft.contact?.healthCard ?? ""} onChange={(e) => setContact("healthCard", e.target.value)} />
            <label className="label" htmlFor="c-phone">
              {t.phoneLabel}
            </label>
            <input id="c-phone" type="tel" autoComplete="tel" value={draft.contact?.phone ?? ""} onChange={(e) => setContact("phone", e.target.value)} />
            <label className="label" htmlFor="c-email">
              {t.emailLabel}
            </label>
            <input id="c-email" type="email" autoComplete="email" value={draft.contact?.email ?? ""} onChange={(e) => setContact("email", e.target.value)} />
            <p className="label">🗓 {t.freeTimes}</p>
            <p className="small muted">{t.freeTimesHelp}</p>
            <div className="chips">
              {Object.keys(FREE_WINDOWS).map((k) => {
                const on = (draft.freeTimes ?? []).includes(k);
                return (
                  <button
                    key={k}
                    className={`chip ${on ? "on" : ""}`}
                    aria-pressed={on}
                    onClick={() => setDraft({ ...draft, freeTimes: on ? (draft.freeTimes ?? []).filter((x) => x !== k) : [...(draft.freeTimes ?? []), k] })}
                  >
                    {on ? "✓ " : ""}
                    {t.freeSlots[k]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <button
            className="btn"
            disabled={!draft.displayName.trim()}
            onClick={() => {
              const exists = household.members.some((x) => x.id === draft.id);
              const saved = exists ? draft : { ...draft, id: uid() };
              const members = exists ? household.members.map((x) => (x.id === draft.id ? saved : x)) : [...household.members, saved];
              props.onSave({ ...household, members });
              if (props.editId) props.onSelect?.(saved.id);
              setDraft(null);
              if (props.editId) props.onDone();
            }}
          >
            {t.save}
          </button>
          <button className="btn btn-ghost" onClick={() => setDraft(null)}>
            {t.cancel}
          </button>
        </div>
      ) : (
        <>
          <button className="btn btn-soft" onClick={() => setDraft(blank)}>
            + {t.addPerson}
          </button>
          <button className="btn btn-ghost" onClick={props.onDemo}>
            {t.loadDemo} ({PROVINCES[props.province].name})
          </button>
        </>
      )}

      {props.consent && (
        <button
          className="link-btn danger"
          onClick={() => {
            storage.clearAll();
            props.onConsent(false);
          }}
        >
          {t.clearData}
        </button>
      )}
      <button className="btn" onClick={props.onDone}>
        {t.continue}
      </button>
    </section>
  );
}

function Emergency({ t, action, onBack }: { t: Strings; action: RedFlagAction; onBack: () => void }) {
  const body = action === "call_911" ? t.emergency911Body : action === "call_911_or_988" ? t.emergency988Body : t.emergency811Body;
  return (
    <section className="emergency">
      <div className="emergency-icon" aria-hidden>
        🚨
      </div>
      <h1>{t.emergencyTitle}</h1>
      <p className="big">{body}</p>
      {action === "call_911" && (
        <a className="btn btn-danger" href="tel:911">
          📞 {t.call911}
        </a>
      )}
      {action === "call_911_or_988" && (
        <>
          <a className="btn btn-danger" href="tel:988">
            📞 {t.call988}
          </a>
          <a className="btn btn-danger-outline" href="tel:911">
            {t.call911}
          </a>
        </>
      )}
      {action === "call_811" && (
        <>
          <a className="btn btn-danger" href="tel:811">
            📞 {t.call811}
          </a>
          <a className="btn btn-danger-outline" href="tel:911">
            {t.call911}
          </a>
        </>
      )}
      <p className="muted small">{t.safetyRuleNote}</p>
      <button className="btn btn-ghost" onClick={onBack}>
        {t.emergencyBack}
      </button>
    </section>
  );
}

function SourceInfo({ t, sources, light }: { t: Strings; sources: { title: string; url: string }[]; light?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <span className={`source-info ${light ? "is-light" : ""}`}>
      <button className="source-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${t.source} (${sources.length})`} title={t.source}>
        ⓘ
      </button>
      {open && (
        <span className="source-pop" role="note">
          <strong>{t.source}</strong>
          {sources.map((s) => (
            <a key={s.url + s.title} href={s.url} target="_blank" rel="noreferrer">
              {s.title} ↗
            </a>
          ))}
        </span>
      )}
    </span>
  );
}

function Result(props: {
  t: Strings;
  loc: string;
  province: ProvinceCode;
  location: { lat: number; lng: number } | null;
  result: RouteResult;
  onChoose: (o: Option) => void;
  onHelper: (o: Option) => void;
  onSmart: () => void;
  onNeedLocation: () => void;
}) {
  const { t, loc, result: r, province } = props;
  const tz = TZ[province];
  const rtl = ["ar", "fa", "ur", "he"].includes(r.language.slice(0, 2));
  const action = useMemo(() => routeAction(r, t), [r, t]);
  const [showAll, setShowAll] = useState(false);
  const heroSources = [
    ...r.rule.sources,
    ...(r.guide ? [{ title: `${t.symptomGuide}: HealthLink BC – ${r.guide.title}`, url: r.guide.url }] : []),
  ];
  const visible = showAll ? r.facilities : r.facilities.slice(0, 3);

  return (
    <section>
      <div className={`route-hero ${r.no_guideline ? "is-nurse" : ""}`}>
        <div className="row-between">
          <p className="route-eyebrow">{r.no_guideline ? t.noGuidelineTitle : t.yourRoute}</p>
          <SourceInfo t={t} sources={heroSources} light />
        </div>
        <div className="row-center">
          <span className="route-icon" aria-hidden>
            {ROUTE_ICON[r.rule.route] ?? "➜"}
          </span>
          <h1>{t.routeNames[r.rule.route] ?? r.rule.title}</h1>
        </div>
        {r.no_guideline && !r.reason ? (
          <p className="route-reason">{t.noGuidelineBody}</p>
        ) : (
          <>
            <p className="route-why-label">{t.why}</p>
            <p className="route-reason" dir={rtl ? "rtl" : "auto"} lang={r.language}>
              {r.reason}
            </p>
            {r.message && (
              <p className="route-msg" dir={rtl ? "rtl" : "auto"} lang={r.language}>
                {r.message}
              </p>
            )}
          </>
        )}
        {action}
      </div>

      {r.alternatives.length > 0 && (
        <>
          <SectionHead title={t.otherOptions} />
          <ul className="list">
            {r.alternatives.map((a) => (
              <Alternative key={a.rule.rule_id} t={t} loc={loc} tz={tz} province={province} location={props.location} alt={a} rtl={rtl} lang={r.language} onChoose={props.onChoose} onHelper={props.onHelper} />
            ))}
          </ul>
        </>
      )}

      {r.facility_kind && (
        <>
          <SectionHead title={r.facility_kind === "virtual" ? t.catVirtual : t.options} />
          {r.location_needed && (
            <div className="card">
              <p>{t.shareLocationForOptions}</p>
              <button className="btn btn-soft" onClick={props.onNeedLocation}>
                📍 {t.useMyLocation}
              </button>
            </div>
          )}
          <ul className="list">
            {DEMO_CLINIC_DISPLAY.enabled && r.facility_kind !== "virtual" && !r.location_needed && (
              <DemoPlaceCard t={t} loc={loc} tz={tz} kind={r.facility_kind} onBook={props.onSmart} />
            )}
            {visible.map((f) => (
              <OptionCard key={f.id} t={t} loc={loc} tz={tz} f={f} waitsSource={r.er_waits_source} onChoose={() => props.onChoose(f)} onHelper={() => props.onHelper(f)} />
            ))}
          </ul>
          {r.facilities.length > 3 && (
            <button className="btn btn-ghost" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
              {showAll ? t.showFewer : `${t.showMore} (${r.facilities.length - 3})`}
            </button>
          )}
        </>
      )}

      {r.registry && (
        <a className="registry-line" href={r.registry.source_url} target="_blank" rel="noreferrer">
          👩‍⚕️ {t.alsoDoctor} ↗
        </a>
      )}
    </section>
  );
}

function Alternative(props: {
  t: Strings;
  loc: string;
  tz: string;
  province: ProvinceCode;
  location: { lat: number; lng: number } | null;
  alt: RouteResult["alternatives"][number];
  rtl: boolean;
  lang: string;
  onChoose: (o: Option) => void;
  onHelper: (o: Option) => void;
}) {
  const { t, alt } = props;
  const [places, setPlaces] = useState<{ facilities: Option[]; er_waits_source?: RouteResult["er_waits_source"]; location_needed: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isCall = alt.rule.route === "call_811";

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (places || !alt.facility_kind) return;
    setBusy(true);
    try {
      const res = await fetch("/api/facilities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ province: props.province, kind: alt.facility_kind, location: props.location }),
      });
      setPlaces(await res.json());
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <>
      <span className="tile" aria-hidden>
        {ROUTE_ICON[alt.rule.route] ?? "➜"}
      </span>
      <span className="option-title">
        <strong>{t.routeNames[alt.rule.route] ?? alt.rule.title}</strong>
        <span className="block alt-when" dir={props.rtl ? "rtl" : "auto"} lang={props.lang}>
          {alt.when}
        </span>
      </span>
      <span className="alt-chevron" aria-hidden>
        {isCall ? "📞" : open ? "▲" : "▼"}
      </span>
    </>
  );

  return (
    <li className={`card alt alt-${alt.rule.route}`}>
      <div className="alt-head-row">
        {isCall ? (
          <a className="alt-head" href="tel:811" aria-label={`${t.call811}: ${alt.when}`}>
            {head}
          </a>
        ) : alt.facility_kind ? (
          <button className="alt-head" onClick={toggle} aria-expanded={open}>
            {head}
          </button>
        ) : (
          <a className="alt-head" href={alt.rule.source_url} target="_blank" rel="noreferrer">
            {head}
          </a>
        )}
        <SourceInfo t={t} sources={alt.rule.sources} />
      </div>
      {open && busy && <p className="small muted">…</p>}
      {open && places && (
        <ul className="list nested">
          {places.location_needed && <p className="small muted">{t.shareLocationForOptions}</p>}
          {places.facilities.slice(0, 3).map((f) => (
            <OptionCard key={f.id} t={t} loc={props.loc} tz={props.tz} f={f} waitsSource={places.er_waits_source} onChoose={() => props.onChoose(f)} onHelper={() => props.onHelper(f)} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** After booking: transit (arrive-by) and Uber with time, start and destination filled in. */
function GettingThere(props: { t: Strings; loc: string; tz: string; place: TravelPlace; appointment: Date; from: { lat: number; lng: number } | null }) {
  const { t, loc, tz, place, appointment } = props;
  const [uberAsk, setUberAsk] = useState(false);
  const arrive = arriveBy(appointment);
  const fmtT = (d: Date) => d.toLocaleTimeString(loc, { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const uber = uberRideUrl(place, props.from);
  return (
    <div className="getting-there">
      <h2>🧭 {t.gettingThere}</h2>
      <p className="small">
        {t.arriveBy} <strong>{fmtT(arrive)}</strong> ({t.arriveEarlyNote}) · {place.name}
      </p>
      <div className="row">
        <a className="btn-outline" href={transitArriveByUrl(place, appointment, tz, props.from)} target="_blank" rel="noreferrer">
          🚌 {t.busSchedule}
        </a>
        {uber && (
          <button className="btn-outline" onClick={() => setUberAsk(!uberAsk)} aria-expanded={uberAsk}>
            🚗 {t.ride}
          </button>
        )}
      </div>
      <p className="small muted">{t.transitNote}</p>
      {uberAsk && uber && (
        <div className="confirm-box" role="dialog" aria-label={t.ride}>
          <p className="small">
            {t.rideConfirm} <strong>{place.name}</strong>. {t.rideTiming} <strong>{fmtT(arrive)}</strong>
          </p>
          <div className="row">
            <a className="btn-outline" href={uber} target="_blank" rel="noreferrer" onClick={() => setUberAsk(false)}>
              {t.openUber} ↗
            </a>
            <button className="btn-outline" onClick={() => setUberAsk(false)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The DEMO clinic shown as the first nearby place: same look as a real place card. */
function DemoPlaceCard({ t, loc, tz, kind, onBook }: { t: Strings; loc: string; tz: string; kind: string; onBook: () => void }) {
  const d = DEMO_CLINIC_DISPLAY;
  return (
    <li className="card option demo-place">
      <div className="option-head">
        <span className="tile" aria-hidden>
          {KIND_ICON[kind] ?? "💊"}
        </span>
        <span className="option-title">
          <strong>
            {d.name} {d.badge && <span className="badge">DEMO</span>}
          </strong>
          <span className="muted small block">{t.kindNames[kind] ?? kind}</span>
        </span>
      </div>
      <p className="muted small">{d.address}</p>
      <OpenBadge t={t} loc={loc} tz={tz} hours={d.hours} />
      <p className="small">⚡ {t.demoPlaceNote}</p>
      <button className="btn btn-book-real" onClick={onBook}>
        ⚡ {t.bookWithCalendar}
      </button>
    </li>
  );
}

function OpenBadge({ t, loc, tz, hours }: { t: Strings; loc: string; tz: string; hours: string }) {
  const parsed = useMemo(() => parseHours(hours), [hours]);
  const st = openStatus(parsed, tz);
  const lines = weekLines(parsed.week, loc, t.closed);
  let badge: React.ReactNode;
  if (st.kind === "always") badge = <span className="open-badge is-open">● {t.open24}</span>;
  else if (st.kind === "open") badge = <span className="open-badge is-open">● {t.openNow} · {t.closesAt} {fmtMinute(st.closesAt, loc)}</span>;
  else if (st.kind === "closed")
    badge = (
      <span className="open-badge is-closed">
        ● {t.closedNow} · {t.opensAt} {st.opensToday ? "" : `${fmtWeekday(st.opensDay, loc)} `}
        {fmtMinute(st.opensAt, loc)}
      </span>
    );
  else badge = <span className="open-badge is-unknown">{t.hoursUnknown}</span>;
  return (
    <div className="hours">
      {badge}
      {!parsed.always && lines.length > 0 && (
        <details>
          <summary>{t.weekHours}</summary>
          <ul className="week">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function OptionCard({ t, loc, tz, f, waitsSource, onChoose, onHelper }: { t: Strings; loc: string; tz: string; f: Option; waitsSource?: RouteResult["er_waits_source"]; onChoose: () => void; onHelper: () => void }) {
  const virtual = f.kind === "virtual";
  const [uberAsk, setUberAsk] = useState(false);
  const sources = [{ title: f.source_title ?? f.source, url: f.source_url }, ...(f.booking ? [{ title: f.booking.source_title, url: f.booking.source_url }] : [])];
  return (
    <li className="card option">
      <div className="option-head">
        <span className="tile" aria-hidden>
          {KIND_ICON[f.kind] ?? "🏥"}
        </span>
        <span className="option-title">
          <strong>{f.name}</strong>
          <span className="muted small block">{virtual ? (f.official ? `✓ ${t.official}` : t.kindNames.virtual) : t.kindNames[f.kind] ?? f.kind}</span>
        </span>
        {typeof f.distance_km === "number" && (
          <span className="pill">
            {f.distance_km} {t.km}
          </span>
        )}
        <SourceInfo t={t} sources={sources} />
      </div>

      {virtual ? (
        <>
          <div className="modes">
            {(f.modes ?? []).map((m) => (
              <span key={m} className="mode">
                {m === "video" ? `📹 ${t.video}` : m === "phone" ? `📞 ${t.phoneMode}` : `💬 ${t.chat}`}
              </span>
            ))}
          </div>
          <p className="small">{f.how}</p>
          <p className="muted small">
            🕒 {f.hours} · {f.cost}
          </p>
          {f.limits && (
            <p className="small warn">
              {t.limitsLabel}: {f.limits}
            </p>
          )}
          {!f.official && <p className="small warn">{t.checkCoverage}</p>}
        </>
      ) : (
        <>
          <p className="muted small">{fullAddress(f)}</p>
          {typeof f.wait_minutes === "number" && waitsSource && (
            <div className="wait-row">
              <span className="wait-big">{fmtWait(f.wait_minutes, t)}</span>
              <span className="muted small">
                {t.estWait} · {waitsSource.name}
              </span>
            </div>
          )}
          <OpenBadge t={t} loc={loc} tz={tz} hours={f.hours} />
          {f.phone ? (
            <p className="phone">
              📞{" "}
              <a href={`tel:${f.phone.replace(/[^\d+]/g, "")}`}>{f.phone}</a>
            </p>
          ) : (
            <p className="small muted">
              📞 {t.phoneNotListed} ·{" "}
              <a href={mapsUrl(f)} target="_blank" rel="noreferrer">
                {t.findPhone} ↗
              </a>
            </p>
          )}
          {f.languages && <p className="muted small">🗣 {f.languages}</p>}
          {f.accepts_walk_in === "unknown" && <p className="small warn">{t.walkInUnknown}</p>}
        </>
      )}

      <div className="option-actions">
        {f.phone && (
          <a className="btn-outline" href={`tel:${f.phone.replace(/[^\d+]/g, "")}`}>
            📞 {t.callNumber}
          </a>
        )}
        {virtual ? (
          f.website && (
            <a className="btn-outline" href={f.website} target="_blank" rel="noreferrer">
              🌐 {t.website}
            </a>
          )
        ) : (
          <a className="btn-outline" href={mapsUrl(f)} target="_blank" rel="noreferrer">
            🗺 {t.directions}
          </a>
        )}
        {f.booking ? null : virtual && f.phone === "811" ? (
          <a className="round-go" href="tel:811" aria-label={`${t.call811}: ${f.name}`}>
            📞
          </a>
        ) : (
          <button className="round-go" onClick={onChoose} aria-label={`${t.choose}: ${f.name}`}>
            ↗
          </button>
        )}
      </div>
      {!virtual && (
        <div className="travel">
          <a className="chip-link" href={transitUrl(f)} target="_blank" rel="noreferrer">
            🚌 {t.transit}
          </a>
          <button className="chip-link" onClick={() => setUberAsk(!uberAsk)} aria-expanded={uberAsk}>
            🚗 {t.ride}
          </button>
        </div>
      )}
      {uberAsk && (
        <div className="confirm-box" role="dialog" aria-label={t.ride}>
          <p className="small">
            {t.rideConfirm} <strong>{f.name}</strong>
            {fullAddress(f) ? ` – ${fullAddress(f)}` : ""}
          </p>
          <div className="row">
            <a className="btn-outline" href={uberUrl(f)} target="_blank" rel="noreferrer" onClick={() => setUberAsk(false)}>
              {t.openUber} ↗
            </a>
            <button className="btn-outline" onClick={() => setUberAsk(false)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}
      {f.booking && (
        <div className="book-real">
          <a className="btn btn-book-real" href={f.booking.url} target="_blank" rel="noreferrer" onClick={onHelper}>
            📅 {t.bookOnline} ↗
          </a>
          <p className="small muted">{f.booking.note}</p>
        </div>
      )}
      {!f.booking && f.phone && f.kind !== "virtual" && (
        <button className="link-btn" onClick={onHelper}>
          📝 {t.callHelper}
        </button>
      )}
    </li>
  );
}

function BookScreen(props: { t: Strings; loc: string; tz: string; option: Option; waitsSource?: RouteResult["er_waits_source"]; onBack: () => void; onConfirm: (slot: Date) => void }) {
  const { t, loc, option: f } = props;
  const tz = props.tz;
  const dayList = useMemo(() => days(tz, 7), [tz]);
  // Open on the first day that still has free times (late in the evening, today has none).
  const [day, setDay] = useState(() => Math.max(0, dayList.findIndex((d) => slots(d, tz).length > 0)));
  const [slot, setSlot] = useState<Date | null>(null);
  const times = useMemo(() => slots(dayList[day], tz), [dayList, day, tz]);
  const virtual = f.kind === "virtual";

  return (
    <section className="book">
      <div className="book-hero">
        <button className="back back-light" onClick={props.onBack} aria-label={t.back}>
          ←
        </button>
        <span className="book-tile" aria-hidden>
          {KIND_ICON[f.kind] ?? "🏥"}
        </span>
        <h1>{f.name}</h1>
        <p>{virtual ? f.how : fullAddress(f)}</p>
      </div>

      <div className="card stats">
        {virtual ? (
          <>
            <Stat icon="📹" value={(f.modes ?? []).map((m) => (m === "video" ? t.video : m === "phone" ? t.phoneMode : t.chat)).join(" · ")} label={t.modes} />
            <Stat icon="🕒" value={f.hours} label={t.hoursLabel} />
          </>
        ) : (
          <>
            {typeof f.distance_km === "number" && <Stat icon="📍" value={`${f.distance_km} ${t.km}`} label={t.distance} />}
            {typeof f.wait_minutes === "number" && <Stat icon="⏱" value={fmtWait(f.wait_minutes, t)} label={t.wait} />}
            {f.languages && <Stat icon="🗣" value={f.languages.split(",").slice(0, 2).join(", ")} label={t.languagesLabel} />}
          </>
        )}
      </div>

      <div className="section-head">
        <h2>{t.selectDate}</h2>
        <span className="muted small">
          {dayList[day].toLocaleDateString(loc, { timeZone: tz, month: "long" })} · 🕒 {tzLabel(tz, loc)}
        </span>
      </div>
      <div className="date-scroll" role="radiogroup" aria-label={t.selectDate}>
        {dayList.map((d, i) => (
          <button key={i} role="radio" disabled={slots(d, tz).length === 0} aria-checked={day === i} className={`date ${day === i ? "on" : ""}`} onClick={() => { setDay(i); setSlot(null); }}>
            <span className="date-num">{zonedParts(d, tz).day}</span>
            <span className="date-day">{i === 0 ? t.today : d.toLocaleDateString(loc, { timeZone: tz, weekday: "short" })}</span>
          </button>
        ))}
      </div>

      <div className="section-head">
        <h2>{t.selectTime}</h2>
      </div>
      <div className="time-grid" role="radiogroup" aria-label={t.selectTime}>
        {times.length === 0 && <p className="muted">—</p>}
        {times.map((s) => (
          <button key={s.toISOString()} role="radio" aria-checked={slot?.getTime() === s.getTime()} className={`time ${slot?.getTime() === s.getTime() ? "on" : ""}`} onClick={() => setSlot(s)}>
            {s.toLocaleTimeString(loc, { timeZone: tz, hour: "numeric", minute: "2-digit" })}
          </button>
        ))}
      </div>

      <p className="small sim-note">
        <span className="badge">{t.simulated}</span> {t.approveBody}
      </p>
      <button className="btn btn-book" disabled={!slot} onClick={() => slot && props.onConfirm(slot)}>
        {virtual ? t.requestVisit : t.bookSimulated}
      </button>
    </section>
  );
}

function routeAction(r: RouteResult, t: Strings) {
  if (r.rule.route === "call_811")
    return (
      <a className="btn btn-white" href="tel:811">
        📞 {t.call811}
      </a>
    );
  if (r.rule.route === "registry")
    return (
      <a className="btn btn-white" href={r.rule.source_url} target="_blank" rel="noreferrer">
        {t.routeNames.registry} ↗
      </a>
    );
  return null;
}
