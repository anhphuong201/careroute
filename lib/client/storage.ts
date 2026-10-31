/**
 * On-device storage only (localStorage). Nothing here is sent to a server
 * except the fields of a single request. Every access is wrapped because
 * storage can be blocked (private mode, previews).
 */
import type { Household, SearchRecord } from "../types";

const K = { consent: "careroute.consent", household: "careroute.household", history: "careroute.history", lang: "careroute.lang" };

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable – the app still works for this session */
  }
}

export const storage = {
  consent: () => read<boolean>(K.consent, false),
  setConsent: (v: boolean) => (v ? write(K.consent, true) : storage.clearAll()),
  lang: () => read<string | null>(K.lang, null),
  setLang: (l: string) => write(K.lang, l),
  household: () => (storage.consent() ? read<Household | null>(K.household, null) : null),
  saveHousehold: (h: Household) => storage.consent() && write(K.household, h),
  history: () => (storage.consent() ? read<SearchRecord[]>(K.history, []) : []),
  addHistory: (r: SearchRecord) => storage.consent() && write(K.history, [r, ...storage.history()].slice(0, 50)),
  clearAll: () => {
    try {
      Object.values(K).forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};
