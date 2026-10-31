import { ENABLED_PROVINCES } from "@/lib/provinces";

export default function Home() {
  return (
    <main>
      <h1>CareRoute</h1>
      <p>Find the right care when you don&apos;t have a family doctor. If this is an emergency, call 911.</p>
      <p style={{ color: "var(--muted)" }}>Scaffold only. The agent flow is not built yet.</p>
      {ENABLED_PROVINCES.map((p) => (
        <button key={p.code} className="btn" style={{ marginBottom: 12 }} disabled>
          {p.name}
        </button>
      ))}
    </main>
  );
}
