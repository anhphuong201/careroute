"use client";

/**
 * One-tap booking with the DEMO clinic:
 * clinic's open slots (Cal.com) − your busy times (Google Calendar) → 3 suggestions →
 * you approve → booked with your saved details → added to your Google Calendar.
 */
import { useEffect, useMemo, useState } from "react";
import type { Strings } from "@/lib/i18n";
import type { HouseholdMember } from "@/lib/types";
import * as gcal from "@/lib/client/googleCalendar";
import { googleCalendarUrl, pickSuggestions } from "@/lib/client/suggest";
import { icsFor } from "@/lib/client/bookingHelper";

interface SlotsResponse {
  clinic: { id: string; name: string; note: string };
  mode: "calcom" | "offline";
  slots: string[];
  error?: string;
}

export interface DemoBooked {
  uid: string;
  start: string;
  clinicName: string;
  mode: "calcom" | "offline";
  calendarLink?: string | null;
}

export default function SmartBook(props: {
  t: Strings;
  lang: "en" | "fr";
  tz: string;
  member: HouseholdMember;
  reason: string;
  onAddDetails: () => void;
  onBooked: (b: DemoBooked) => void;
  onClose: () => void;
}) {
  const { t, member } = props;
  const locale = props.lang === "fr" ? "fr-CA" : "en-CA";
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [busy, setBusy] = useState<gcal.Busy[]>([]);
  const [connected, setConnected] = useState(gcal.isConnected());
  const [chosen, setChosen] = useState<Date | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [addToCal, setAddToCal] = useState(true);
  const [state, setState] = useState<"idle" | "booking" | "error">("idle");
  const [calError, setCalError] = useState(false);

  useEffect(() => gcal.onChange(() => setConnected(gcal.isConnected())), []);
  useEffect(() => {
    fetch(`/api/demo-clinic/slots?tz=${encodeURIComponent(props.tz)}&days=7`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ clinic: { id: "demo-clinic", name: "CareRoute Demo Pharmacy", note: "" }, mode: "offline", slots: [], error: "x" }));
  }, [props.tz]);
  useEffect(() => {
    if (!connected) return setBusy([]);
    const now = new Date();
    gcal
      .getBusy(now, new Date(now.getTime() + 8 * 86400000))
      .then((b) => {
        setBusy(b);
        setCalError(false);
      })
      .catch(() => setCalError(true));
  }, [connected]);

  const open = useMemo(() => gcal.freeOf((data?.slots ?? []).map((s) => new Date(s)), busy), [data, busy]);
  const suggestions = useMemo(() => pickSuggestions(open, member.freeTimes ?? []), [open, member.freeTimes]);
  const fmt = (d: Date) => d.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const name = member.contact?.legalName || member.displayName;
  const c = member.contact ?? {};

  async function book() {
    if (!chosen) return;
    setState("booking");
    try {
      const res = await fetch("/api/demo-clinic/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true, start: chosen.toISOString(), name, email: c.email, phone: c.phone, timeZone: props.tz, note: props.reason }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      let calendarLink: string | null | undefined;
      if (connected && addToCal) {
        calendarLink = await gcal.addEvent({
          title: `Appointment – ${data?.clinic.name ?? "CareRoute Demo Pharmacy"} (DEMO)`,
          start: chosen,
          location: "Demo clinic (prototype)",
          description: [props.reason, `Booking: ${j.uid}`].filter(Boolean).join("\n"),
        });
      }
      props.onBooked({ uid: j.uid, start: j.start, clinicName: data?.clinic.name ?? "CareRoute Demo Pharmacy", mode: j.mode, calendarLink });
    } catch {
      setState("error");
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="smart-title">
      <div className="modal-body helper">
        <div className="row-between">
          <h2 id="smart-title">⚡ {t.smartTitle}</h2>
          <button className="btn-mini" onClick={props.onClose}>
            {t.closeLabel} ✕
          </button>
        </div>
        <p className="small">
          <span className="badge">DEMO</span> {data?.clinic.name ?? "CareRoute Demo Pharmacy"} – {t.demoClinicNote}
          {data?.mode === "offline" && <span className="muted"> ({t.offlineDemo})</span>}
        </p>

        {/* Step 1: calendar */}
        <div className="card step">
          <h3>1 · 📅 {t.yourCalendar}</h3>
          {!gcal.isConfigured() ? (
            <p className="small muted">{t.gcalNotSetUp}</p>
          ) : connected ? (
            <p className="small">
              ✅ {t.gcalConnected} {calError ? `– ${t.gcalError}` : `– ${busy.length} ${t.busyBlocks}`}{" "}
              <button className="link-btn" onClick={() => gcal.disconnect()}>
                {t.disconnect}
              </button>
            </p>
          ) : (
            <>
              <p className="small muted">{t.gcalWhy}</p>
              <button className="btn btn-soft" onClick={() => gcal.connect()}>
                🔗 {t.connectGcal}
              </button>
            </>
          )}
        </div>

        {/* Step 2: pick a time */}
        <div className="card step">
          <h3>2 · 🗓 {t.pickTime}</h3>
          {!data ? (
            <p className="small muted">…</p>
          ) : open.length === 0 ? (
            <p className="small muted">{t.noSlots}</p>
          ) : (
            <>
              <p className="small muted">{connected ? t.suggestFree : t.suggestNoCal}</p>
              <div className="chips">
                {(showAll ? open.slice(0, 24) : suggestions).map((d) => (
                  <button key={d.toISOString()} className={`chip ${chosen?.getTime() === d.getTime() ? "on" : ""}`} aria-pressed={chosen?.getTime() === d.getTime()} onClick={() => setChosen(d)}>
                    {chosen?.getTime() === d.getTime() ? "✓ " : ""}
                    {fmt(d)}
                  </button>
                ))}
              </div>
              <button className="link-btn" onClick={() => setShowAll(!showAll)}>
                {showAll ? t.showFewer : t.moreTimes}
              </button>
            </>
          )}
        </div>

        {/* Step 3: approve */}
        <div className="card step">
          <h3>3 · ✅ {t.approveSend}</h3>
          <ul className="send-list">
            <li>
              {t.legalName}: <strong>{name || "—"}</strong>
            </li>
            <li>
              {t.emailLabel}: <strong>{c.email || "—"}</strong>
            </li>
            <li>
              {t.phoneLabel}: <strong>{c.phone || "—"}</strong>
            </li>
            <li>
              {t.reasonForVisit}: <strong>{props.reason || "—"}</strong>
            </li>
          </ul>
          <p className="small muted">{t.sendNote}</p>
          {!c.legalName && (
            <button className="link-btn" onClick={props.onAddDetails}>
              ✏️ {t.addDetails}
            </button>
          )}
          {connected && (
            <label className="consent">
              <input type="checkbox" checked={addToCal} onChange={(e) => setAddToCal(e.target.checked)} />
              <span>{t.addToMyGcal}</span>
            </label>
          )}
          {state === "error" && <p className="small warn">{t.bookingFailed}</p>}
          <button className="btn btn-book-real" disabled={!chosen || !name || state === "booking"} onClick={book}>
            {state === "booking" ? "…" : chosen ? `${t.approveBook} · ${fmt(chosen)}` : t.approveBook}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Calendar links for a demo booking when Google Calendar wasn't connected. */
export function demoCalendarLinks(b: DemoBooked, reason: string) {
  const start = new Date(b.start);
  const title = `Appointment – ${b.clinicName} (DEMO)`;
  return {
    google: googleCalendarUrl({ title, start, location: "Demo clinic (prototype)", details: `${reason}\nBooking: ${b.uid}` }),
    ics: icsFor({ title, start, location: "Demo clinic (prototype)", description: `${reason}\nBooking: ${b.uid}`, uid: `${b.uid}@careroute` }),
  };
}
