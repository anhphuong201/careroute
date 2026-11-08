/**
 * Google Calendar in the browser (Google Identity Services token flow).
 * Scopes: free/busy (read when you're busy – no event details) + events (add the appointment).
 * The access token lives only in this tab's memory; nothing is sent to CareRoute's server.
 *
 * Setup: NEXT_PUBLIC_GOOGLE_CLIENT_ID = OAuth client ID (type "Web application"),
 * with the site's URL as an authorized JavaScript origin.
 */
"use client";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void;
            error_callback?: (e: { type: string }) => void;
          }): { requestAccessToken(opts?: { prompt?: string }): void };
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const SCOPES = "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3";

let token: { value: string; expires: number } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const isConfigured = () => !!GOOGLE_CLIENT_ID;
export const isConnected = () => !!token && token.expires > Date.now();
export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
}

type TokenClient = { requestAccessToken(opts?: { prompt?: string }): void };
let client: TokenClient | null = null;
let pending: ((ok: boolean, why?: string) => void) | null = null;
let lastError = "";
export const getLastError = () => lastError;

/**
 * Load Google's script and create the token client AHEAD of the tap.
 * Browsers only allow the sign-in popup if it opens directly from the user's tap,
 * so connect() must not wait for anything before calling requestAccessToken().
 */
export async function prepare(): Promise<boolean> {
  if (!GOOGLE_CLIENT_ID) return false;
  if (client) return true;
  try {
    await loadScript();
  } catch {
    lastError = "script";
    return false;
  }
  client = window.google!.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: (r) => {
      if (r.access_token) {
        token = { value: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 - 60000 };
        lastError = "";
        notify();
        pending?.(true);
      } else {
        lastError = r.error ?? "denied";
        notify();
        pending?.(false, lastError);
      }
      pending = null;
    },
    error_callback: (e) => {
      // e.type: "popup_failed_to_open" (blocked) | "popup_closed" | "unknown"
      lastError = e.type;
      notify();
      pending?.(false, e.type);
      pending = null;
    },
  });
  return true;
}

export const isReady = () => !!client;

/** Call directly from a click handler (after prepare() has finished). */
export function connect(): Promise<boolean> {
  if (!client) {
    lastError = GOOGLE_CLIENT_ID ? "not_ready" : "not_configured";
    notify();
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    pending = (ok) => resolve(ok);
    client!.requestAccessToken();
  });
}

export function disconnect() {
  if (token && window.google) window.google.accounts.oauth2.revoke(token.value);
  token = null;
  notify();
}

export interface Busy {
  start: Date;
  end: Date;
}

export async function getBusy(from: Date, to: Date): Promise<Busy[]> {
  if (!isConnected()) return [];
  const res = await fetch(`${API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token!.value}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
  });
  if (!res.ok) throw new Error(`Google free/busy → HTTP ${res.status}`);
  const json = (await res.json()) as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } };
  return (json.calendars?.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export async function addEvent(e: { title: string; start: Date; minutes?: number; location: string; description: string }): Promise<string | null> {
  if (!isConnected()) return null;
  const end = new Date(e.start.getTime() + (e.minutes ?? 30) * 60000);
  const res = await fetch(`${API}/calendars/primary/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token!.value}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: e.title,
      location: e.location,
      description: e.description,
      start: { dateTime: e.start.toISOString() },
      end: { dateTime: end.toISOString() },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { htmlLink?: string };
  return json.htmlLink ?? "";
}

/** Slots that don't overlap any busy block (30-minute appointments). */
export function freeOf(slots: Date[], busy: Busy[], minutes = 30): Date[] {
  return slots.filter((s) => {
    const e = s.getTime() + minutes * 60000;
    return !busy.some((b) => s.getTime() < b.end.getTime() && e > b.start.getTime());
  });
}
