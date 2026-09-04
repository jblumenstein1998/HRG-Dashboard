"use client";

/**
 * Staffing — who was on the clock, at a moment, across every store.
 *
 * Opens on now and stays there until you move it. The date and time are one
 * control rather than two because they are one question, and a half-changed
 * pair would silently answer a different one.
 *
 * The stores keep their own clocks. Tennessee is Central and Virginia Eastern,
 * so a single instant is two different wall-clock times, and each store's
 * heading says which one it is reading. Asking "who was on at 6:30" without
 * saying whose 6:30 is how you end up an hour out for half the estate.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import { CopyableTitle } from "@/components/CopyImageButton";
import type { Tab } from "@/lib/users/tabs";
import type { StaffingReport, StoreRoster } from "@/lib/staffing";

function hrs(minutes: number): string {
  return `${(minutes / 60).toFixed(2)}h`;
}

/** A value for <input type="datetime-local">, in the browser's own zone. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function StaffingClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  const router = useRouter();

  // Held as the datetime-local string the input wants, seeded from now. `live`
  // means "follow the clock" — it survives until the field is touched, so the
  // page opened in the morning is still telling the truth at lunchtime.
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [live, setLive] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const at = useMemo(() => (live ? null : new Date(when)), [live, when]);

  // Loading is derived from a request key rather than set inside the effect —
  // the React Compiler rejects a synchronous setState there, and keying the
  // response also drops answers that arrive out of order.
  const requestKey = `${live ? "live" : when}|${refreshKey}`;
  const [state, setState] = useState<{ key: string; data: StaffingReport | null; error: string | null }>(
    { key: "", data: null, error: null }
  );

  useEffect(() => {
    let cancelled = false;
    const qs = at && !Number.isNaN(at.getTime()) ? `?at=${encodeURIComponent(at.toISOString())}` : "";
    fetch(`/api/staffing${qs}`)
      .then(async (r) => {
        if (r.status === 401) { router.push("/login"); return null; }
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json as StaffingReport;
      })
      .then((json) => { if (!cancelled && json) setState({ key: requestKey, data: json, error: null }); })
      .catch((err) => { if (!cancelled) setState({ key: requestKey, data: null, error: String(err?.message ?? err) }); });
    return () => { cancelled = true; };
  }, [requestKey, at, router]);

  const loading = state.key !== requestKey;
  const data = state.data;

  const setNow = useCallback(() => {
    setWhen(toLocalInput(new Date()));
    setLive(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const totalOn = data?.stores.reduce((n, s) => n + s.onClock.length, 0) ?? 0;
  const storesReporting = data?.stores.filter((s) => !s.error).length ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hrglogo.png" alt="HRG" className="h-8 w-auto" />
              <div className="relative w-fit">
                <select
                  value="/staffing"
                  onChange={(e) => router.push(e.target.value)}
                  className="text-base font-semibold text-gray-900 bg-transparent border-0 p-0 m-0 pr-5 appearance-none cursor-pointer focus:outline-none focus:ring-0"
                >
                  <TabOptions tabs={tabs} isAdmin={isAdmin} />
                </select>
                <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <button
              onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            >
              Log out
            </button>
          </div>
        </header>

        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => { setWhen(e.target.value); setLive(false); }}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
            <button
              onClick={setNow}
              className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                live ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Now
            </button>
            {live && <span className="text-xs text-gray-400">following the clock</span>}

            {data && !loading && (
              <span className="text-xs text-gray-500">
                <strong className="text-gray-900">{totalOn}</strong> on the clock across{" "}
                <strong className="text-gray-900">{storesReporting}</strong> stores
              </span>
            )}

            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-3">
        {state.error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
            <span>{state.error}</span>
            <button onClick={() => setRefreshKey((k) => k + 1)} className="text-xs font-medium underline underline-offset-2 shrink-0">Retry</button>
          </div>
        )}

        <div ref={cardRef} className="flex flex-wrap items-baseline gap-x-3">
          <CopyableTitle
            title={`On the clock — ${data ? new Date(data.at).toLocaleString() : when.replace("T", " ")}`}
            targetRef={cardRef}
            className="text-base font-semibold text-gray-900"
          />
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
              Reading PAR — first load of a new time takes a moment
            </span>
          )}
        </div>

        <div className={`space-y-3 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
          {(data?.stores ?? []).map((store) => <StoreCard key={store.storeId} store={store} />)}
          {!loading && data && data.stores.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
              No stores configured.
            </div>
          )}
        </div>

        <p className="text-[11px] text-gray-400">
          Times are each store&apos;s own — Tennessee is Central, Virginia Eastern. Position and
          break windows are PAR&apos;s own. <strong>Elapsed</strong> is time since clocking in and
          includes breaks; <strong>trailing 7d</strong> is PAR&apos;s paid minutes-worked, which
          excludes them, over the seven business dates before the one shown. Wages sum the hourly rates on the
          clock; salaried staff carry no rate in PAR and are counted separately rather than
          added as zero. It is gross pay, not a burdened cost.
        </p>
      </main>
    </div>
  );
}

function StoreCard({ store }: { store: StoreRoster }) {
  const [open, setOpen] = useState(true);
  const onBreak = store.onClock.filter((p) => p.onBreak).length;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-gray-50 transition"
      >
        <span className={`text-[10px] text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
        <span className="text-sm font-semibold text-gray-900">{store.storeName}</span>
        <span className="text-xs text-gray-400">{store.state} · {store.localTime} local</span>
        {store.error ? (
          <span className="text-xs text-red-600">{store.error}</span>
        ) : (
          <>
            <span className="text-xs text-gray-500">
              {store.onClock.length} on the clock
              {onBreak > 0 && <span className="text-gray-400"> · {onBreak} on break</span>}
            </span>
            {store.hourlyWageRunRate !== null && (
              <span className="ml-auto text-xs tabular-nums text-gray-500">
                ${store.hourlyWageRunRate.toFixed(2)}/hr in wages
                {store.salariedOnClock > 0 && (
                  <span className="text-gray-400"> · {store.salariedOnClock} salaried</span>
                )}
              </span>
            )}
          </>
        )}
      </button>

      {open && !store.error && (
        store.onClock.length === 0 ? (
          <p className="px-3 py-4 text-sm text-gray-400 border-t border-gray-100">
            Nobody clocked in at this time.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Name</th>
                  <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Position</th>
                  <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-400 w-40">Shift</th>
                  <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-400 w-24">Elapsed</th>
                  <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-400 w-20">Rate</th>
                  <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-400 w-32">Trailing 7d</th>
                </tr>
              </thead>
              <tbody>
                {store.onClock.map((p, i) => (
                  <tr key={`${p.employeeId ?? "?"}-${i}`} className="border-b border-gray-50">
                    <td className="px-3 py-1.5 font-medium text-gray-900">{p.name}</td>
                    <td className="px-3 py-1.5 text-gray-600">{p.job ?? "—"}</td>
                    <td className="px-3 py-1.5 text-gray-600 tabular-nums">
                      {p.startLabel} – {p.endLabel}
                      {p.isOpen && <span className="ml-1 text-[10px] text-green-600 uppercase tracking-wide">on now</span>}
                      {p.onBreak && <span className="ml-1 text-[10px] text-amber-600 uppercase tracking-wide">break</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{hrs(p.minutesElapsedAtQuery)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                      {p.payRate === null || p.payRate === 0 ? "—" : `$${p.payRate.toFixed(2)}`}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                      {hrs(p.trailing7Minutes)}
                      <span className="ml-1 text-[10px] text-gray-400">{p.trailing7Shifts} shifts</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}
