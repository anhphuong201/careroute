"use client";

/**
 * Assisted booking: the provider's real booking page opens in a new tab and this sheet
 * shows everything needed to fill it in – store, reason, and the person's saved details –
 * with copy buttons. Nothing here is sent to CareRoute's server.
 */
import { useEffect, useState } from "react";
import * as gcal from "@/lib/client/googleCalendar";
import type { Strings } from "@/lib/i18n";
import type { HouseholdMember } from "@/lib/types";
import { callScript, hasContact, maskCard } from "@/lib/client/bookingHelper";
import { FREE_WINDOWS, suggestSlots } from "@/lib/client/suggest";

export interface HelperPlace {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  hours?: string;
  booking?: { url: string; label: string };
}

/** "2026-11-09T17:30" for <input type="datetime-local"> in local time. */
const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without the async clipboard API
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function CopyRow({ t, label, value, display, secret }: { t: Strings; label: string; value: string; display?: string; secret?: boolean }) {
  const [done, setDone] = useState(false);
  const [reveal, setReveal] = useState(false);
  if (!value.trim()) return null;
  return (
    <div className="copy-row">
      <div className="copy-text">
        <span className="copy-label">{label}</span>
        <span className="copy-value">{secret && !reveal ? display : value}</span>
      </div>
      {secret && (
        <button className="btn-mini" onClick={() => setReveal(!reveal)} aria-pressed={reveal}>
          {reveal ? t.hide : t.show}
        </button>
      )}
      <button
        className={`btn-mini ${done ? "is-done" : ""}`}
        onClick={async () => {
          if (await copyText(value)) {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }
        }}
        aria-label={`${t.copy}: ${label}`}
      >
        {done ? `✓ ${t.copied}` : t.copy}
      </button>
    </div>
  );
}

export default function BookingHelper(props: {
  t: Strings;
  lang: "en" | "fr";
  place: HelperPlace;
  member: HouseholdMember;
  reason: string;
  onAddDetails: () => void;
  onSaved: (b: { when: Date; code: string }) => void;
  onClose: () => void;
}) {
  const { t, place, member } = props;
  const c = member.contact ?? {};
  const [when, setWhen] = useState("");
  const [code, setCode] = useState("");
  const viaPhone = !place.booking;
  const address = [place.address, place.city].filter(Boolean).join(", ");
  const name = c.legalName || member.displayName;
  const locale = props.lang === "fr" ? "fr-CA" : "en-CA";
  const [busy, setBusy] = useState<gcal.Busy[]>([]);
  const [connected, setConnected] = useState(gcal.isConnected());
  useEffect(() => gcal.onChange(() => setConnected(gcal.isConnected())), []);
  useEffect(() => {
    if (!connected) return setBusy([]);
    const now = new Date();
    gcal.getBusy(now, new Date(now.getTime() + 8 * 86400000)).then(setBusy).catch(() => setBusy([]));
  }, [connected]);
  // Your free windows (or any daytime window when only the calendar is connected) ∩ opening hours − busy times.
  const keys = member.freeTimes?.length ? member.freeTimes : connected ? Object.keys(FREE_WINDOWS) : [];
  const suggestions = gcal.freeOf(suggestSlots(place.hours ?? "", keys, new Date(), 10), busy).slice(0, 3);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="helper-title">
      <div className="modal-body helper">
        <div className="row-between">
          <h2 id="helper-title">📝 {t.helperTitle}</h2>
          <button className="btn-mini" onClick={props.onClose}>
            {t.closeLabel} ✕
          </button>
        </div>
        <p className="muted small">{viaPhone ? t.helperIntroCall : t.helperIntro}</p>

        <div className="helper-actions">
          {place.booking && (
            <a className="btn btn-book-real" href={place.booking.url} target="_blank" rel="noreferrer">
              📅 {t.openBookingAgain} ↗
            </a>
          )}
          {place.phone && (
            <a className="btn btn-soft" href={`tel:${place.phone.replace(/[^\d+]/g, "")}`}>
              📞 {t.callNumber} {place.phone}
            </a>
          )}
        </div>

        <h3>🗓 {t.suggestedTimes}</h3>
        {suggestions.length > 0 ? (
          <>
            <p className="small muted">{t.suggestedHelp}</p>
            <div className="chips">
              {suggestions.map((d) => {
                const v = toLocalInput(d);
                return (
                  <button key={v} className={`chip ${when === v ? "on" : ""}`} aria-pressed={when === v} onClick={() => setWhen(v)}>
                    {d.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <button className="link-btn" onClick={props.onAddDetails}>
            {t.setFreeTimes}
          </button>
        )}
        {gcal.isConfigured() && !connected && (
          <button className="link-btn" onClick={() => gcal.connect()}>
            🔗 {t.connectGcal}
          </button>
        )}

        <h3>{t.pickStore}</h3>
        <CopyRow t={t} label={place.name} value={`${place.name}${address ? `, ${address}` : ""}`} />

        <h3>{t.reasonForVisit}</h3>
        <CopyRow t={t} label="EN" value={props.reason} />

        {viaPhone && (
          <>
            <h3>{t.callScriptLabel}</h3>
            <CopyRow t={t} label="" value={callScript({ place: place.name, name, reason: props.reason, lang: props.lang })} />
          </>
        )}

        <h3>
          {t.forPerson}: {member.displayName || t.me}
        </h3>
        {hasContact(member.contact) || member.birthDate ? (
          <>
            <CopyRow t={t} label={t.legalName} value={c.legalName ?? ""} />
            <CopyRow t={t} label={t.dob} value={member.birthDate ?? ""} />
            <CopyRow t={t} label={t.healthCard} value={c.healthCard ?? ""} display={maskCard(c.healthCard)} secret />
            <CopyRow t={t} label={t.phoneLabel} value={c.phone ?? ""} />
            <CopyRow t={t} label={t.emailLabel} value={c.email ?? ""} />
          </>
        ) : (
          <p className="small muted">{t.noDetails}</p>
        )}
        <button className="link-btn" onClick={props.onAddDetails}>
          ✏️ {hasContact(member.contact) ? t.editDetails : t.addDetails}
        </button>

        <div className="card helper-done">
          <h3>✅ {t.iBooked}</h3>
          <label className="label" htmlFor="booked-when">
            {t.bookedWhen}
          </label>
          <input id="booked-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <label className="label" htmlFor="booked-code">
            {t.confirmationOptional}
          </label>
          <input id="booked-code" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" disabled={!when} onClick={() => props.onSaved({ when: new Date(when), code: code.trim() })}>
            {t.saveBooking}
          </button>
        </div>
      </div>
    </div>
  );
}
