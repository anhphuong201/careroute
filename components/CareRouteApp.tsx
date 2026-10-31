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

type Screen = "home" | "household" | "check" | "need" | "loading" | "emergency" | "result" | "clarify" | "history" | "error";
type RouteResult = Extract<AgentResult, { type: "route" }>;
type Persona = { id: string; name: string; note: string; birthDate: string; province: string };

/** Address + city, without repeating the city when the address already contains it. */
const fullAddress = (f: { address: string; city: string }) =>
  f.city && !f.address.toLowerCase().includes(f.city.toLowerCase()) ? [f.address, f.city].filter(Boolean).join(", ") : f.address || f.city;

const uid = () => Math.random().toString(36).slice(2, 10);

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

const DEMO: Record<ProvinceCode, HouseholdMember[]> = {
  AB: [
    { id: "m-amira", displayName: "Amira", ageGroup: "adult", hasFamilyDoctor: "no", personaId: "amira-haddad", birthDate: "1993-04-12" },
    { id: "m-lily", displayName: "Lily", ageGroup: "child", hasFamilyDoctor: "no", personaId: "lily-haddad", birthDate: "2019-01-22" },
    { id: "m-noah", displayName: "Noah", ageGroup: "infant", hasFamilyDoctor: "no", personaId: "noah-haddad", birthDate: "2026-08-25" },
    { id: "m-david", displayName: "David", ageGroup: "adult", hasFamilyDoctor: "hard_to_access", personaId: "david-tremblay", birthDate: "1968-11-02" },
  ],
  BC: [{ id: "m-jun", displayName: "Jun", ageGroup: "adult", hasFamilyDoctor: "no", personaId: "jun-chen", birthDate: "2001-07-30" }],
};

export default function CareRouteApp() {
  const [lang, setLang] = useState<Lang>("en");
  const t: Strings = STRINGS[lang];
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
  const [pending, setPending] = useState<RouteResult["facilities"][number] | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [history, setHistory] = useState<SearchRecord[]>([]);
  const live = useRef<HTMLDivElement>(null);

  // Restore on-device state (only when the user opted in earlier).
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
    fetch("/api/personas").then((r) => r.json()).then(setPersonas).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    live.current?.focus();
    window.scrollTo({ top: 0 });
  }, [screen]);

  const members = household.members;
  const member: HouseholdMember = members.find((m) => m.id === memberId) ?? guest;

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
    setLocStatus(c ? "idle" : locStatus);
  }

  function flag(category: RedFlagCategory) {
    const action: RedFlagAction = category === "suicidal_thoughts" ? "call_911_or_988" : category === "infant_fever" ? "call_811" : "call_911";
    setChecklist({ ...checklist, [category]: true });
    setEmergency(action);
    record({ route: "emergency", reason: "safety checklist", sourceUrl: "" });
    setScreen("emergency");
  }

  function record(r: Pick<SearchRecord, "route" | "reason" | "sourceUrl"> & Partial<SearchRecord>) {
    const rec: SearchRecord = { id: uid(), memberId: member.id, createdAt: new Date().toISOString(), province, ...r };
    storage.addHistory(rec);
    setHistory(storage.history());
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
          province,
          text: fullText,
          ageGroup: member.ageGroup,
          ageMonths: ageMonths(member),
          hasFamilyDoctor: member.hasFamilyDoctor,
          checklist,
          location,
          city: city || undefined,
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
        if (!data.question) {
          setScreen("need");
          return;
        }
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

  async function confirmBooking() {
    if (!pending) return;
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ province, facility_id: pending.id, member_name: member.displayName || t.me, approved: true }),
    });
    if (res.ok) {
      const b = (await res.json()) as Booking;
      setBooking(b);
      window.scrollTo({ top: 0, behavior: "smooth" });
      record({ route: result!.rule.route, routeTitle: result!.rule.title, reason: result!.reason, sourceUrl: result!.rule.source_url, bookingCode: b.confirmation_code });
    }
    setPending(null);
  }

  async function downloadSummary() {
    if (!member.personaId) return;
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        persona_id: member.personaId,
        visit: {
          province,
          needSummaryEn: result?.need_summary_en,
          routeTitle: result?.rule.title,
          routeSourceUrl: result?.rule.source_url,
          booking: booking ? { facility_name: booking.facility_name, slot: booking.slot, confirmation_code: booking.confirmation_code } : undefined,
        },
      }),
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `careroute-summary-${member.personaId}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function startOver() {
    setText("");
    setChecklist({});
    setResult(null);
    setBooking(null);
    setEmergency(null);
    setScreen("home");
  }

  const header = (
    <header className="topbar">
      <button className="brand" onClick={startOver} aria-label="CareRoute – home">
        <span aria-hidden>➜</span> CareRoute
      </button>
      <label className="lang">
        <span className="sr-only">{t.language}</span>
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
  );

  const banner = screen !== "emergency" && (
    <a className="emergency-banner" href="tel:911">
      {t.emergencyBanner}
    </a>
  );

  return (
    <>
      {header}
      {banner}
      <main>
        <div ref={live} tabIndex={-1} aria-live="polite" className="screen">
          {screen === "home" && (
            <Home
              t={t}
              province={province}
              onProvince={chooseProvince}
              members={members}
              memberId={memberId}
              setMemberId={setMemberId}
              guest={guest}
              setGuest={setGuest}
              onHousehold={() => setScreen("household")}
              onHistory={() => setScreen("history")}
              onContinue={() => setScreen("check")}
            />
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
              onSave={(h) => saveHousehold(h)}
              onDemo={() => saveHousehold({ ...household, members: DEMO[province] })}
              onDone={() => setScreen("home")}
            />
          )}

          {screen === "check" && (
            <section>
              <h1>{t.checkTitle}</h1>
              <p>{t.checkIntro}</p>
              <div className="stack">
                {(
                  [
                    ["chest_pain", t.flagChest, "❤"],
                    ["breathing", t.flagBreathing, "🫁"],
                    ["stroke_signs", t.flagStroke, "🧠"],
                    ["severe_bleeding", t.flagBleeding, "🩸"],
                    ["suicidal_thoughts", t.flagSuicide, "💬"],
                    ...(member.ageGroup === "infant" ? [["infant_fever", t.flagInfantFever, "🌡"]] : []),
                  ] as [RedFlagCategory, string, string][]
                ).map(([c, label, icon]) => (
                  <button key={c} className="btn btn-flag" onClick={() => flag(c)}>
                    <span aria-hidden className="icon">{icon}</span> {label}
                  </button>
                ))}
              </div>
              <button className="btn" onClick={() => setScreen("need")}>
                {t.noneOfThese}
              </button>
              <button className="btn btn-ghost" onClick={() => setScreen("home")}>
                {t.back}
              </button>
            </section>
          )}

          {screen === "need" && (
            <section>
              <h1>{t.needTitle}</h1>
              <label htmlFor="need" className="help">
                {t.needHelp}
              </label>
              <textarea id="need" rows={5} value={text} placeholder={t.needPlaceholder} onChange={(e) => setText(e.target.value)} />
              <p className="label">{t.examples}</p>
              <div className="chips">
                {[t.exRenewal, t.exLab, t.exMinor].map((ex) => (
                  <button key={ex} className="chip" onClick={() => setText(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
              <h2>{t.location}</h2>
              <button className="btn btn-secondary" onClick={askLocation} aria-pressed={locStatus === "on"}>
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
                {t.findCare}
              </button>
              <button className="btn btn-ghost" onClick={() => setScreen("check")}>
                {t.back}
              </button>
            </section>
          )}

          {screen === "loading" && (
            <section className="center">
              <div className="spinner" aria-hidden />
              <p>{t.thinking}</p>
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
              result={result}
              member={member}
              booking={booking}
              onChoose={setPending}
              onSummary={downloadSummary}
              onStartOver={startOver}
              onNeedLocation={() => setScreen("need")}
            />
          )}

          {screen === "history" && (
            <section>
              <h1>{t.myHistory}</h1>
              {!consent && <p className="help">{t.consentHelp}</p>}
              {history.length === 0 && <p>{t.historyEmpty}</p>}
              <ul className="list">
                {history.map((h) => (
                  <li key={h.id} className="card">
                    <strong>{h.route === "emergency" ? "🚨 911 / 811" : t.routeNames[h.route] ?? h.route}</strong>
                    <div className="muted">
                      {new Date(h.createdAt).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA")} · {h.province}
                      {members.find((m) => m.id === h.memberId) ? ` · ${members.find((m) => m.id === h.memberId)!.displayName}` : ""}
                    </div>
                    {h.route !== "emergency" && <p>{h.reason}</p>}
                    {h.sourceUrl && (
                      <a href={h.sourceUrl} target="_blank" rel="noreferrer">
                        {t.source}
                      </a>
                    )}
                    {h.bookingCode && <div className="badge">{t.simulated} · {h.bookingCode}</div>}
                  </li>
                ))}
              </ul>
              <button className="btn btn-ghost" onClick={() => setScreen("home")}>
                {t.back}
              </button>
            </section>
          )}

          {screen === "error" && (
            <section>
              <h1>⚠</h1>
              <p className="big">{error}</p>
              <a className="btn btn-secondary" href="tel:811">
                {t.call811}
              </a>
              <button className="btn btn-ghost" onClick={() => setScreen("need")}>
                {t.back}
              </button>
            </section>
          )}
        </div>
      </main>

      {pending && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="approve-title">
          <div className="modal-body">
            <h2 id="approve-title">{t.approveTitle}</h2>
            <p className="big">
              <strong>{pending.name}</strong>
              <br />
              {fullAddress(pending)}
            </p>
            <p>
              <span className="badge">{t.simulated}</span> {t.approveBody}
            </p>
            <button className="btn" onClick={confirmBooking}>
              {t.approveYes}
            </button>
            <button className="btn btn-ghost" onClick={() => setPending(null)}>
              {t.approveNo}
            </button>
          </div>
        </div>
      )}

      <footer>
        <p>{t.notAdvice}</p>
        <p className="muted">{t.attribution}</p>
      </footer>
    </>
  );
}

/* ───────────────────────── screens ───────────────────────── */

function Home(props: {
  t: Strings;
  province: ProvinceCode;
  onProvince: (p: ProvinceCode) => void;
  members: HouseholdMember[];
  memberId: string | null;
  setMemberId: (id: string | null) => void;
  guest: HouseholdMember;
  setGuest: (m: HouseholdMember) => void;
  onHousehold: () => void;
  onHistory: () => void;
  onContinue: () => void;
}) {
  const { t, province, members, memberId, guest } = props;
  return (
    <section>
      <h1>{t.appTagline}</h1>
      <h2>{t.province}</h2>
      <div className="row">
        {ENABLED_PROVINCES.map((p) => (
          <button key={p.code} className={`btn btn-toggle ${province === p.code ? "on" : ""}`} aria-pressed={province === p.code} onClick={() => props.onProvince(p.code)}>
            {p.name}
          </button>
        ))}
      </div>

      <h2>{t.whoNeedsCare}</h2>
      <div className="chips">
        <button className={`chip ${memberId === null ? "on" : ""}`} aria-pressed={memberId === null} onClick={() => props.setMemberId(null)}>
          {t.me}
        </button>
        {members.map((m) => (
          <button key={m.id} className={`chip ${memberId === m.id ? "on" : ""}`} aria-pressed={memberId === m.id} onClick={() => props.setMemberId(m.id)}>
            {m.displayName} · {t[m.ageGroup]}
          </button>
        ))}
        <button className="chip chip-add" onClick={props.onHousehold}>
          + {t.addPerson}
        </button>
      </div>

      {memberId === null && (
        <>
          <MemberQuestions t={t} m={guest} onChange={props.setGuest} />
        </>
      )}

      <button className="btn" onClick={props.onContinue}>
        {t.continue}
      </button>
      <div className="row">
        <button className="btn btn-ghost" onClick={props.onHousehold}>
          👪 {t.myHousehold}
        </button>
        <button className="btn btn-ghost" onClick={props.onHistory}>
          🕘 {t.myHistory}
        </button>
      </div>
    </section>
  );
}

function MemberQuestions({ t, m, onChange }: { t: Strings; m: HouseholdMember; onChange: (m: HouseholdMember) => void }) {
  return (
    <>
      <p className="label">{t.ageGroup}</p>
      <div className="row">
        {(["infant", "child", "adult"] as AgeGroup[]).map((a) => (
          <button key={a} className={`btn btn-toggle ${m.ageGroup === a ? "on" : ""}`} aria-pressed={m.ageGroup === a} onClick={() => onChange({ ...m, ageGroup: a })}>
            {t[a]}
          </button>
        ))}
      </div>
      <p className="label">{t.familyDoctor}</p>
      <div className="row">
        {(
          [
            ["yes", t.yes],
            ["no", t.no],
            ["hard_to_access", t.hardToReach],
          ] as [HouseholdMember["hasFamilyDoctor"], string][]
        ).map(([v, label]) => (
          <button key={v} className={`btn btn-toggle ${m.hasFamilyDoctor === v ? "on" : ""}`} aria-pressed={m.hasFamilyDoctor === v} onClick={() => onChange({ ...m, hasFamilyDoctor: v })}>
            {label}
          </button>
        ))}
      </div>
    </>
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
  const valid = draft && draft.displayName.trim();

  return (
    <section>
      <h1>{t.myHousehold}</h1>
      <label className="consent">
        <input type="checkbox" checked={props.consent} onChange={(e) => props.onConsent(e.target.checked)} />
        <span>
          {t.consent}
          <br />
          <span className="muted">{t.consentHelp}</span>
        </span>
      </label>

      <ul className="list">
        {household.members.map((m) => (
          <li key={m.id} className="card row-between">
            <div>
              <strong>{m.displayName}</strong>
              <div className="muted">
                {t[m.ageGroup]} · {m.hasFamilyDoctor === "yes" ? t.yes : m.hasFamilyDoctor === "no" ? t.no : t.hardToReach}
              </div>
            </div>
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
            disabled={!valid}
            onClick={() => {
              props.onSave({ ...household, members: [...household.members, { ...draft!, id: uid() }] });
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
          <button className="btn btn-secondary" onClick={() => setDraft(blank)}>
            + {t.addPerson}
          </button>
          <button className="btn btn-ghost" onClick={props.onDemo}>
            {t.loadDemo} ({PROVINCES[props.province].name})
          </button>
        </>
      )}

      {props.consent && (
        <button
          className="btn-small"
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
  return (
    <section className="emergency">
      <h1>🚨 {t.emergencyTitle}</h1>
      {action === "call_911" && (
        <>
          <a className="btn btn-danger" href="tel:911">
            📞 {t.call911}
          </a>
          <p className="big">{t.emergency911Body}</p>
        </>
      )}
      {action === "call_911_or_988" && (
        <>
          <a className="btn btn-danger" href="tel:988">
            📞 {t.call988}
          </a>
          <a className="btn btn-danger-outline" href="tel:911">
            {t.call911}
          </a>
          <p className="big">{t.emergency988Body}</p>
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
          <p className="big">{t.emergency811Body}</p>
        </>
      )}
      <p className="muted">{t.safetyRuleNote}</p>
      <button className="btn btn-ghost" onClick={onBack}>
        {t.emergencyBack}
      </button>
    </section>
  );
}

function Result(props: {
  t: Strings;
  result: RouteResult;
  member: HouseholdMember;
  booking: Booking | null;
  onChoose: (f: RouteResult["facilities"][number]) => void;
  onSummary: () => void;
  onStartOver: () => void;
  onNeedLocation: () => void;
}) {
  const { t, result: r, booking } = props;
  const rtl = ["ar", "fa", "ur", "he"].includes(r.language.slice(0, 2));
  const actions = useMemo(() => routeAction(r, t), [r, t]);

  return (
    <section>
      {booking && (
        <div className="card card-booked" role="status">
          <span className="badge">{t.simulated}</span>
          <h2>✅ {t.booked}</h2>
          <p className="big">
            <strong>{booking.facility_name}</strong>
            <br />
            {booking.facility_address}
          </p>
          <p>
            {t.time}: {new Date(booking.slot).toLocaleString()}
            <br />
            {t.confirmation}: <strong>{booking.confirmation_code}</strong>
          </p>
          <p>
            {t.bring}: {booking.instructions}
          </p>
        </div>
      )}

      <p className="label">{t.yourRoute}</p>
      <div className="card card-route">
        <h1>{t.routeNames[r.rule.route] ?? r.rule.title}</h1>
        <p className="label">{t.why}</p>
        <p className="big" dir={rtl ? "rtl" : "auto"} lang={r.language}>
          {r.reason}
        </p>
        <p dir={rtl ? "rtl" : "auto"} lang={r.language}>
          {r.message}
        </p>
        <p className="source">
          {t.source}:{" "}
          <a href={r.rule.source_url} target="_blank" rel="noreferrer">
            {r.rule.sources[0]?.title ?? r.rule.title}
          </a>
        </p>
        {actions}
      </div>

      {r.registry && (
        <div className="card">
          <h2>{t.alsoDoctor}</h2>
          <p className="source">
            {t.source}:{" "}
            <a href={r.registry.source_url} target="_blank" rel="noreferrer">
              {r.registry.sources[0]?.title ?? r.registry.title}
            </a>
          </p>
          <a className="btn btn-secondary" href={r.registry.source_url} target="_blank" rel="noreferrer">
            {t.routeNames.registry} ↗
          </a>
        </div>
      )}

      {r.facility_kind && (
        <>
          <h2>{t.options}</h2>
          {r.location_needed && (
            <>
              <p>{t.shareLocationForOptions}</p>
              <button className="btn btn-secondary" onClick={props.onNeedLocation}>
                📍 {t.useMyLocation}
              </button>
            </>
          )}
          <ul className="list">
            {r.facilities.map((f) => (
              <li key={f.id} className="card">
                <div className="row-between">
                  <strong>{f.name}</strong>
                  {typeof f.distance_km === "number" && (
                    <span className="pill">
                      {f.distance_km} {t.km}
                    </span>
                  )}
                </div>
                <div className="muted">
                  {t.kindNames[f.kind] ?? f.kind} · {fullAddress(f)}
                </div>
                {f.hours && (
                  <div className="muted small">
                    {t.open}: {f.hours.slice(0, 140)}
                  </div>
                )}
                {f.languages && <div className="muted small">🗣 {f.languages}</div>}
                {f.accepts_walk_in === "unknown" && <div className="small warn">{t.walkInUnknown}</div>}
                {typeof f.wait_minutes === "number" && r.er_waits_source && (
                  <div className="wait">
                    ⏱ {t.estWait}: {Math.floor(f.wait_minutes / 60)} h {f.wait_minutes % 60} {t.min}
                    <div className="muted small">
                      {t.waitSource}{" "}
                      <a href={r.er_waits_source.url} target="_blank" rel="noreferrer">
                        {r.er_waits_source.name}
                      </a>{" "}
                      ({new Date(r.er_waits_source.refreshed_at).toLocaleString()})
                    </div>
                  </div>
                )}
                <div className="row">
                  {f.phone && (
                    <a className="btn-small" href={`tel:${f.phone.replace(/[^\d+]/g, "")}`}>
                      📞 {t.callNumber}
                    </a>
                  )}
                  <a className="btn-small" href={`https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lng}`} target="_blank" rel="noreferrer">
                    🗺 Map
                  </a>
                  <a className="btn-small" href={f.source_url} target="_blank" rel="noreferrer" title={f.source}>
                    {t.source}
                  </a>
                </div>
                {!booking && (
                  <button className="btn" onClick={() => props.onChoose(f)}>
                    {t.choose}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="card">
        <h2>📄 {t.summaryTitle}</h2>
        <p>{t.summaryBody}</p>
        {props.member.personaId ? (
          <button className="btn btn-secondary" onClick={props.onSummary}>
            {t.downloadSummary}
          </button>
        ) : (
          <p className="muted">{t.noRecord}</p>
        )}
      </div>

      <button className="btn btn-ghost" onClick={props.onStartOver}>
        {t.startOver}
      </button>
    </section>
  );
}

function routeAction(r: RouteResult, t: Strings) {
  switch (r.rule.route) {
    case "call_811":
      return (
        <a className="btn" href="tel:811">
          📞 {t.call811}
        </a>
      );
    case "virtual_care":
    case "registry":
      return (
        <a className="btn btn-secondary" href={r.rule.source_url} target="_blank" rel="noreferrer">
          {t.routeNames[r.rule.route]} ↗
        </a>
      );
    default:
      return null;
  }
}
