"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STRINGS, type Lang, type Strings } from "@/lib/i18n";
import { ENABLED_PROVINCES, PROVINCES, type ProvinceCode } from "@/lib/provinces";
import { CITIES } from "@/lib/cities";
import { storage } from "@/lib/client/storage";
import type { AgeGroup, Household, HouseholdMember, SearchRecord } from "@/lib/types";
import type { AgentResult } from "@/lib/agent/runAgent";
import type { RedFlagAction, RedFlagCategory } from "@/lib/safety/redFlags";
import type { Booking } from "@/lib/tools/booking";

type Screen =
  | "onboard" | "home" | "household" | "check" | "need" | "loading" | "emergency"
  | "result" | "book" | "booked" | "clarify" | "history" | "records" | "error";
type RouteResult = Extract<AgentResult, { type: "route" }>;
type Option = RouteResult["facilities"][number];
type Persona = { id: string; name: string; note: string; birthDate: string; province: string };

/* ───────────────────────── helpers ───────────────────────── */

const fullAddress = (f: { address: string; city: string }) =>
  f.city && !f.address.toLowerCase().includes(f.city.toLowerCase()) ? [f.address, f.city].filter(Boolean).join(", ") : f.address || f.city;

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

/** Next 7 days; time slots every 30 min, 8:00–19:30, at least 1 h from now. */
function days(n = 7) {
  const out: Date[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) out.push(new Date(d.getTime() + i * 86400000));
  return out;
}
function slots(day: Date) {
  const out: Date[] = [];
  const min = Date.now() + 3600000;
  for (let h = 8; h < 20; h++)
    for (const m of [0, 30]) {
      const s = new Date(day);
      s.setHours(h, m, 0, 0);
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
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? t.goodMorning : h < 18 ? t.goodAfternoon : t.goodEvening;
  })();

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
    record({ route: result.rule.route, routeTitle: result.rule.title, reason: result.reason, sourceUrl: result.rule.source_url, bookingCode: b.confirmation_code });
    setScreen("booked");
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
              booking: booking ? { facility_name: booking.facility_name, slot: booking.slot, confirmation_code: booking.confirmation_code } : undefined,
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

              <div className="segmented" role="group" aria-label={t.province}>
                {ENABLED_PROVINCES.map((p) => (
                  <button key={p.code} className={province === p.code ? "on" : ""} aria-pressed={province === p.code} onClick={() => chooseProvince(p.code)}>
                    {p.name}
                  </button>
                ))}
              </div>

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
              onDone={() => setScreen("home")}
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
              <div className="chips">
                {[t.exRenewal, t.exLab, t.exMinor].map((ex) => (
                  <button key={ex} className="chip" onClick={() => setText(ex)}>
                    {ex}
                  </button>
                ))}
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
              result={result}
              onChoose={(o) => {
                setChosen(o);
                setScreen("book");
              }}
              onNeedLocation={() => setScreen("need")}
            />
          )}

          {screen === "book" && chosen && result && (
            <BookScreen t={t} loc={loc} option={chosen} waitsSource={result.er_waits_source} onBack={() => setScreen("result")} onConfirm={confirmBooking} />
          )}

          {screen === "booked" && booking && (
            <section>
              <div className="card card-booked" role="status">
                <span className="badge">{t.simulated}</span>
                <h1>✅ {t.booked}</h1>
                <p className="big">
                  <strong>{booking.facility_name}</strong>
                  <br />
                  <span className="muted">{booking.facility_address}</span>
                </p>
                <div className="stats">
                  <Stat icon="📅" value={new Date(booking.slot).toLocaleDateString(loc, { weekday: "short", month: "short", day: "numeric" })} label={t.selectDate} />
                  <Stat icon="🕒" value={new Date(booking.slot).toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" })} label={t.time} />
                  <Stat icon="#" value={booking.confirmation_code} label={t.confirmation} />
                </div>
                <p>
                  <strong>{t.bring}:</strong> {booking.instructions}
                </p>
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
                          {new Date(h.createdAt).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" })} · {h.province}
                          {who ? ` · ${who}` : ""}
                        </div>
                        {h.route !== "emergency" && <p className="small">{h.reason}</p>}
                        <div className="row">
                          {h.sourceUrl && (
                            <a className="link-small" href={h.sourceUrl} target="_blank" rel="noreferrer">
                              {t.source} ↗
                            </a>
                          )}
                          {h.bookingCode && <span className="badge">{t.simulated} · {h.bookingCode}</span>}
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

      {showNav && (
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
  onDone: () => void;
}) {
  const { t, household, personas } = props;
  const blank: HouseholdMember = { id: "", displayName: "", ageGroup: "adult", hasFamilyDoctor: "no" };
  const [draft, setDraft] = useState<HouseholdMember | null>(null);

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
            <button className="btn-small" onClick={() => props.onSave({ ...household, members: household.members.filter((x) => x.id !== m.id) })}>
              {t.remove}
            </button>
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
          <button
            className="btn"
            disabled={!draft.displayName.trim()}
            onClick={() => {
              props.onSave({ ...household, members: [...household.members, { ...draft, id: uid() }] });
              setDraft(null);
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

function Result(props: { t: Strings; loc: string; result: RouteResult; onChoose: (o: Option) => void; onNeedLocation: () => void }) {
  const { t, result: r } = props;
  const rtl = ["ar", "fa", "ur", "he"].includes(r.language.slice(0, 2));
  const action = useMemo(() => routeAction(r, t), [r, t]);

  return (
    <section>
      <div className="route-hero">
        <p className="route-eyebrow">{t.yourRoute}</p>
        <div className="row-center">
          <span className="route-icon" aria-hidden>
            {ROUTE_ICON[r.rule.route] ?? "➜"}
          </span>
          <h1>{t.routeNames[r.rule.route] ?? r.rule.title}</h1>
        </div>
        <p className="route-why-label">{t.why}</p>
        <p className="route-reason" dir={rtl ? "rtl" : "auto"} lang={r.language}>
          {r.reason}
        </p>
        <p className="route-msg" dir={rtl ? "rtl" : "auto"} lang={r.language}>
          {r.message}
        </p>
        <a className="route-source" href={r.rule.source_url} target="_blank" rel="noreferrer">
          {t.source}: {r.rule.sources[0]?.title ?? r.rule.title} ↗
        </a>
        {action}
      </div>

      {r.registry && (
        <a className="card registry" href={r.registry.source_url} target="_blank" rel="noreferrer">
          <span className="tile" aria-hidden>
            👩‍⚕️
          </span>
          <span>
            <strong>{t.alsoDoctor}</strong>
            <span className="muted small block">
              {t.source}: {r.registry.sources[0]?.title ?? r.registry.title} ↗
            </span>
          </span>
        </a>
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
            {r.facilities.map((f) => (
              <OptionCard key={f.id} t={t} f={f} waitsSource={r.er_waits_source} onChoose={() => props.onChoose(f)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function OptionCard({ t, f, waitsSource, onChoose }: { t: Strings; f: Option; waitsSource?: RouteResult["er_waits_source"]; onChoose: () => void }) {
  const virtual = f.kind === "virtual";
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
                {t.estWait} ·{" "}
                <a href={waitsSource.url} target="_blank" rel="noreferrer">
                  {waitsSource.name}
                </a>
              </span>
            </div>
          )}
          {f.hours && <p className="muted small">🕒 {f.hours.slice(0, 120)}</p>}
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
          <a className="btn-outline" href={`https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lng}`} target="_blank" rel="noreferrer">
            🗺 {t.directions}
          </a>
        )}
        {virtual && f.phone === "811" ? (
          <a className="round-go" href="tel:811" aria-label={`${t.call811}: ${f.name}`}>
            📞
          </a>
        ) : (
          <button className="round-go" onClick={onChoose} aria-label={`${t.choose}: ${f.name}`}>
            ↗
          </button>
        )}
      </div>
      <a className="link-small" href={f.source_url} target="_blank" rel="noreferrer">
        {t.source}: {f.source_title ?? f.source} ↗
      </a>
    </li>
  );
}

function BookScreen(props: { t: Strings; loc: string; option: Option; waitsSource?: RouteResult["er_waits_source"]; onBack: () => void; onConfirm: (slot: Date) => void }) {
  const { t, loc, option: f } = props;
  const dayList = useMemo(() => days(7), []);
  // Open on the first day that still has free times (late in the evening, today has none).
  const [day, setDay] = useState(() => Math.max(0, dayList.findIndex((d) => slots(d).length > 0)));
  const [slot, setSlot] = useState<Date | null>(null);
  const times = useMemo(() => slots(dayList[day]), [dayList, day]);
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
        <span className="muted small">{dayList[day].toLocaleDateString(loc, { month: "long" })}</span>
      </div>
      <div className="date-scroll" role="radiogroup" aria-label={t.selectDate}>
        {dayList.map((d, i) => (
          <button key={i} role="radio" disabled={slots(d).length === 0} aria-checked={day === i} className={`date ${day === i ? "on" : ""}`} onClick={() => { setDay(i); setSlot(null); }}>
            <span className="date-num">{d.getDate()}</span>
            <span className="date-day">{i === 0 ? t.today : d.toLocaleDateString(loc, { weekday: "short" })}</span>
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
            {s.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" })}
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
