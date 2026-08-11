"use client";

import TabOptions from "@/components/TabOptions";
import type { Tab } from "@/lib/users/tabs";

/**
 * Bonus attainment — the grid, with each scorecard expanding in place.
 *
 * Reads stored results only; the nightly cron owns computing them. The one
 * write path is the inline editor, which rescores the period on save so the
 * grid moves immediately.
 *
 * Editing happens inside the expanded scorecard rather than on a separate
 * screen, because the two are the same task: you look at why a category scored
 * what it did, and the thing that fixes it is usually a number nobody has
 * entered yet. Splitting them meant reading a criterion in one place and
 * hunting for its field in another.
 *
 * Two things this screen has to get right, because they're the difference
 * between a useful scorecard and a misleading one:
 *
 *  1. **A pending criterion is never shown as a zero.** Most criteria in these
 *     docs have no automated source, so an un-entered scorecard is the normal
 *     state early in a period. Every cell carries the weight it was measured
 *     over, and unscored categories say so.
 *  2. **The near-miss is called out.** Scoring is strict — one condition short
 *     of Target drops a whole category from 100% to 50% — so the screen names
 *     the condition that cost it rather than leaving someone to diff a table.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyableTitle } from "@/components/CopyImageButton";
import { BONUS_STORES } from "@/lib/bonus/storeMap";
import { currentPeriodLabel } from "@/lib/bonus/periods";
import { OVERRIDABLE_METRICS, OVERRIDE_PREFIX } from "@/lib/bonus/rules";
import {
  POSITION_LABELS, POSITION_ORDER,
  type CategoryResult, type ConditionResult, type ConditionUnit, type PositionId, type PositionResult,
} from "@/lib/bonus/types";
import {
  STATUS_LABEL, STATUS_TONE, TONE_BG, TONE_TEXT,
  bonusTone, coverageNote, fmtGateValue, fmtScore, fmtValue,
} from "@/lib/bonus/display";

type StoredResult = {
  storeId: string;
  periodLabel: string;
  positionId: PositionId;
  score: number | null;
  scoreExLov: number | null;
  pendingCount: number;
  scoreableWeight: number;
  kickerFired: boolean;
  detail: PositionResult;
  computedAt: string;
};

type AttainmentResponse = {
  period: string;
  window: { start: string; end: string; isPartial: boolean; label: string } | null;
  periods: { label: string; isPartial: boolean }[];
  locked: boolean;
  results: StoredResult[];
  error?: string;
};

type BonusInput = { storeId: string; criterionId: string; value: number | null };

export default function BonusClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  const router = useRouter();

  // Seeded from the fiscal calendar rather than from the first response, so the
  // period picker has a value before any fetch resolves.
  const [period, setPeriod] = useState<string>(() => currentPeriodLabel());
  const [showVA, setShowVA] = useState(true);
  const [showTN, setShowTN] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<{ storeId: string; positionId: PositionId } | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);

  /**
   * Loading is derived from a request key rather than set at the top of the
   * effect. The React Compiler is on and rejects a synchronous setState inside
   * an effect body; keying the stored response is the pattern the SMG tab
   * already uses, and it also drops responses that arrive out of order after a
   * fast period switch.
   */
  const requestKey = `${period}|${refreshKey}`;
  const [state, setState] = useState<{ key: string; data: AttainmentResponse | null; error: string | null }>(
    { key: "", data: null, error: null }
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/attainment?period=${encodeURIComponent(period)}`)
      .then(async (r) => {
        if (r.status === 401) { router.push("/login"); return null; }
        const json = (await r.json()) as AttainmentResponse;
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json;
      })
      .then((json) => {
        if (cancelled || !json) return;
        setState({ key: requestKey, data: json, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ key: requestKey, data: null, error: String(err?.message ?? err) });
      });
    return () => { cancelled = true; };
  }, [requestKey, period, router]);

  const loading = state.key !== requestKey;
  const data = state.data;
  const error = state.error;

  const stores = useMemo(
    () => BONUS_STORES.filter((s) => (s.state === "VA" ? showVA : showTN)),
    [showVA, showTN]
  );

  const byStore = useMemo(() => {
    const map = new Map<string, Map<PositionId, StoredResult>>();
    for (const r of data?.results ?? []) {
      let m = map.get(r.storeId);
      if (!m) { m = new Map(); map.set(r.storeId, m); }
      m.set(r.positionId, r);
    }
    return map;
  }, [data]);

  const windowLabel = data?.window?.label ?? period;
  const colCount = POSITION_ORDER.length + 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hrglogo.png" alt="HRG" className="h-8 w-auto" />
              <div className="relative w-fit">
                <select
                  value="/bonus"
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
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
              >
                Log out
              </button>
            </div>
          </div>
        </header>

        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <select
              value={period}
              onChange={(e) => { setPeriod(e.target.value); setExpanded(null); }}
              className="text-sm font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              {(data?.periods ?? [{ label: period, isPartial: false }]).map((p) => (
                <option key={p.label} value={p.label}>{p.label}{p.isPartial ? " · to date" : ""}</option>
              ))}
            </select>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={showVA} onChange={(e) => setShowVA(e.target.checked)} className="rounded border-gray-300" />
                VA
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={showTN} onChange={(e) => setShowTN(e.target.checked)} className="rounded border-gray-300" />
                TN
              </label>
            </div>

            {data?.window && (
              <span className="text-xs text-gray-500">
                {shortDate(data.window.start)}–{shortDate(data.window.end)}
                {data.window.isPartial && " · in progress"}
              </span>
            )}
            {data?.locked && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-900 text-white">Locked</span>
            )}

            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => setRefreshKey((k) => k + 1)} className="text-xs font-medium underline underline-offset-2 shrink-0">Retry</button>
          </div>
        )}

        <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 pt-3 pb-2 flex items-center gap-2 min-w-0">
            <CopyableTitle
              title={`Bonus attainment — ${windowLabel}`}
              targetRef={cardRef}
              className="text-sm font-semibold text-gray-800"
            />
            {loading && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
                Loading…
              </span>
            )}
          </div>
          <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: "16%" }} />
                {POSITION_ORDER.map((p) => <col key={p} style={{ width: `${84 / POSITION_ORDER.length}%` }} />)}
              </colgroup>
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Store</th>
                  {POSITION_ORDER.map((p) => (
                    <th key={p} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {SHORT_POSITION[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => {
                  const openHere = expanded?.storeId === store.storeId;
                  const openResult = openHere
                    ? byStore.get(store.storeId)?.get(expanded.positionId)
                    : undefined;
                  return (
                    <Fragment key={store.storeId}>
                      <tr className="border-b border-gray-100">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{store.name}</td>
                        {POSITION_ORDER.map((positionId) => {
                          const r = byStore.get(store.storeId)?.get(positionId);
                          const tone = bonusTone(r?.score ?? null);
                          const note = r ? coverageNote(r.scoreableWeight, r.pendingCount) : null;
                          const isOpen = openHere && expanded.positionId === positionId;
                          return (
                            <td
                              key={positionId}
                              className={`px-3 py-3 text-right align-top ${TONE_BG[tone]} ${isOpen ? "ring-2 ring-inset ring-gray-900" : ""}`}
                            >
                              <button
                                onClick={() => setExpanded(isOpen ? null : { storeId: store.storeId, positionId })}
                                disabled={!r}
                                className="w-full text-right disabled:cursor-default group"
                              >
                                <div className={`tabular-nums ${TONE_TEXT[tone]} ${r ? "group-hover:underline underline-offset-2" : ""}`}>
                                  {fmtScore(r?.score ?? null)}
                                  {r?.kickerFired && <span className="ml-1 text-[10px] text-gray-500 align-super">×1.25</span>}
                                  {r && (
                                    <span className={`ml-1 inline-block text-[9px] text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}>▼</span>
                                  )}
                                </div>
                                {note && <div className="text-[10px] leading-tight text-gray-400 mt-0.5">{note}</div>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                      {openHere && openResult && (
                        <tr className="border-b-2 border-gray-300 bg-gray-50">
                          <td colSpan={colCount} className="p-0">
                            <ExpandedScorecard
                              key={`${store.storeId}|${expanded.positionId}|${period}`}
                              result={openResult.detail}
                              storeName={store.name}
                              storeId={store.storeId}
                              period={period}
                              locked={data?.locked ?? false}
                              onClose={() => setExpanded(null)}
                              onSaved={() => setRefreshKey((k) => k + 1)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {stores.length === 0 && (
                  <tr><td colSpan={colCount} className="px-4 py-8 text-center text-sm text-gray-400">No stores selected.</td></tr>
                )}
                {!loading && (data?.results.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-gray-400">
                      Nothing computed for {period} yet — the nightly rollup hasn&apos;t run for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">
            Click any percentage to open its scorecard and enter the criteria nobody measures automatically.
            Attainment is a percentage of target and can exceed 100% when a category multiplier or the
            transaction-growth kicker fires.
          </div>
        </div>
      </main>
    </div>
  );
}

const SHORT_POSITION: Record<PositionId, string> = {
  gm: "GM",
  agm: "AGM",
  driveThru: "Drive-Thru",
  quality: "Quality",
  training: "Training",
  hospitality: "Hospitality",
};

/** Postgres DATE values arrive as timestamps stamped UTC — read UTC components. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ── Expanded scorecard, with editing in place ────────────────────────────────

function ExpandedScorecard({
  result, storeName, storeId, period, locked, onClose, onSaved,
}: {
  result: PositionResult;
  storeName: string;
  storeId: string;
  period: string;
  locked: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Same request-key pattern as the grid: loading is derived, never set
  // synchronously inside the effect.
  const requestKey = `${period}|${storeId}`;
  const [loaded, setLoaded] = useState<{ key: string; values: Record<string, string> }>({ key: "", values: {} });
  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/inputs?period=${encodeURIComponent(period)}&store=${storeId}`)
      .then((r) => r.json())
      .then((json: { inputs?: BonusInput[] }) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const i of json.inputs ?? []) next[i.criterionId] = i.value === null ? "" : String(i.value);
        setLoaded({ key: requestKey, values: next });
      })
      .catch(() => { if (!cancelled) setLoaded({ key: requestKey, values: {} }); });
    return () => { cancelled = true; };
  }, [requestKey, period, storeId]);

  const loading = loaded.key !== requestKey;
  const values = { ...loaded.values, ...edits };
  const dirty = Object.keys(edits).length > 0;

  const save = async () => {
    setSaving(true);
    setStatus(null);
    // Only what was actually touched is sent. "" means "still not entered" and
    // is stored as NULL — the engine treats a missing value as pending and a 0
    // as a real miss, so the two must not collapse.
    const payload: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(edits)) payload[k] = v.trim() === "" ? null : Number(v);

    try {
      const res = await fetch("/api/bonus/inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, storeId, values: payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      // Fold what was just saved into the loaded set before clearing the edits.
      // The fetch effect is keyed on period+store, neither of which changed, so
      // it won't re-run — without this the fields blank back to placeholders
      // and it looks as though the save was lost.
      setLoaded((prev) => ({ key: prev.key, values: { ...prev.values, ...edits } }));
      setEdits({});
      setStatus(json.recomputed ? "Saved and rescored." : `Saved, but rescoring failed: ${json.recomputeError}`);
      onSaved();
    } catch (err) {
      setStatus(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-800">
            {storeName} — {POSITION_LABELS[result.positionId]}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Total {fmtScore(result.score)}
            {result.kickerFired && " · transaction growth kicker ×1.25 applied"}
            {result.pendingCount > 0 && ` · ${result.pendingCount} criteria not yet entered`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && !locked && (
            <button
              onClick={save}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save & rescore"}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition"
          >
            Close
          </button>
        </div>
      </div>

      {locked && (
        <div className="mb-3 rounded-lg bg-gray-900 text-white text-xs px-3 py-2">
          {period} is locked — these are the figures the period was approved on. Unlock it to make changes.
        </div>
      )}
      {status && (
        <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 px-3 py-2">{status}</div>
      )}
      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400 animate-pulse">Loading entries…</div>
      ) : (
        <div className="space-y-3">
          {result.categories.map((cat) => (
            <CategoryCard
              key={cat.category.id}
              cat={cat}
              values={values}
              locked={locked}
              onChange={(id, v) => setEdits((prev) => ({ ...prev, [id]: v }))}
            />
          ))}
          <p className="text-[11px] text-gray-400">
            Blank means <em>not entered</em> and leaves a category unscored — which is not the same as
            entering 0. Editable fields are marked <span className="text-blue-500 uppercase tracking-wide">entered</span>.
          </p>
        </div>
      )}
    </div>
  );
}

function CategoryCard({
  cat, values, locked, onChange,
}: {
  cat: CategoryResult;
  values: Record<string, string>;
  locked: boolean;
  onChange: (criterionId: string, value: string) => void;
}) {
  const tone = cat.score === null ? "none" : cat.score >= 1 ? "good" : cat.score >= 0.5 ? "ok" : "bad";
  const derived = cat.category.derivedFrom;

  const rows: { r: ConditionResult; kind: "condition" | "disqualifier" | "multiplier"; note?: string }[] = [
    ...cat.conditions.map((r) => ({ r, kind: "condition" as const })),
    ...cat.disqualifiers.map((r) => ({ r, kind: "disqualifier" as const })),
    ...(cat.multiplierGroups ?? []).flatMap((g) =>
      g.results.map((r) => ({ r, kind: "multiplier" as const, note: `×${g.factor}` }))
    ),
  ];

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
      <div className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-gray-50 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-800">{cat.category.label}</span>
        <span className="text-xs text-gray-400">{cat.category.weight}% of total</span>
        <span className={`text-sm tabular-nums ml-auto ${TONE_TEXT[tone]}`}>
          {cat.score === null ? "Not yet scoreable" : `${(cat.score * 100).toFixed(0)}%`}
          {cat.multiplier > 1 && <span className="ml-1 text-xs">×{cat.multiplier}</span>}
        </span>
        <span className="text-xs tabular-nums text-gray-500 w-16 text-right">
          {cat.payout === null ? "—" : `${cat.payout.toFixed(1)} pts`}
        </span>
      </div>

      {cat.disqualifiedBy && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">
          Disqualified — {cat.disqualifiedBy}. This category scores 0 regardless of the criteria below.
        </div>
      )}
      {cat.multiplier > 1 && cat.multipliersFired.length > 0 && (
        <div className="px-3 py-2 bg-green-50 border-b border-green-100 text-xs text-green-700">
          Multiplier ×{cat.multiplier} — {cat.multipliersFired.map((m) => m.label).join("; ")}
        </div>
      )}
      {derived && (
        <div className="px-3 py-2 text-xs text-gray-600 border-b border-gray-100">
          Derived from {derived.map((d) => POSITION_LABELS[d]).join(", ")}, excluding their Living Our Values
          category. The transaction-growth kicker is deliberately not carried up — this position earns its own.
        </div>
      )}

      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Criterion</th>
              <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-400 w-32">Actual</th>
              <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-400 w-24">Threshold</th>
              <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-400 w-24">Target</th>
              <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-400 w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, kind, note }) => (
              <ConditionRow
                key={`${kind}-${r.condition.id}`}
                r={r}
                kind={kind}
                badge={note}
                values={values}
                locked={locked}
                onChange={onChange}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ConditionRow({
  r, kind, badge, values, locked, onChange,
}: {
  r: ConditionResult;
  kind: "condition" | "disqualifier" | "multiplier";
  badge?: string;
  values: Record<string, string>;
  locked: boolean;
  onChange: (criterionId: string, value: string) => void;
}) {
  const unit = r.condition.unit;
  const tone = STATUS_TONE[r.status];
  const editable = r.condition.source === "manual" && !locked;
  const override = OVERRIDABLE_METRICS.find((m) => m.metric === r.condition.metric);
  const overrideId = override ? `${OVERRIDE_PREFIX}${override.metric}` : null;
  const overridden = overrideId ? (values[overrideId] ?? "").trim() !== "" : false;

  return (
    <>
      <tr className={`border-b border-gray-50 ${r.isNearMiss ? "bg-amber-50" : ""}`}>
        <td className="px-3 py-2 text-gray-800 align-top">
          {r.condition.label}
          {kind === "disqualifier" && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">disqualifier</span>}
          {kind === "multiplier" && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-green-600">multiplier {badge}</span>}
          {r.condition.advisory && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">not scored</span>}
          {r.condition.source === "manual" && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-blue-400">entered</span>}
          {r.condition.note && (
            <div className="text-[10px] leading-tight text-gray-400 mt-0.5 max-w-xl">{r.condition.note}</div>
          )}
        </td>
        <td className="px-3 py-2 text-right align-top">
          {editable ? (
            <input
              type="number"
              step="any"
              value={values[r.condition.id] ?? ""}
              onChange={(e) => onChange(r.condition.id, e.target.value)}
              placeholder={unitPlaceholder(unit)}
              className="w-28 text-sm text-right tabular-nums border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          ) : (
            <span className={`tabular-nums ${TONE_TEXT[tone]}`}>{fmtValue(r.value, unit)}</span>
          )}
          {overrideId && !locked && (
            <input
              type="number"
              step="any"
              value={values[overrideId] ?? ""}
              onChange={(e) => onChange(overrideId, e.target.value)}
              placeholder="override"
              title={override?.label}
              className="mt-1 w-28 text-xs text-right tabular-nums border border-dashed border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          )}
          {overridden && <div className="text-[10px] text-amber-600 mt-0.5">overridden</div>}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-400 align-top">{fmtGateValue(r.thresholdUsed, unit)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-400 align-top">{fmtGateValue(r.targetUsed, unit)}</td>
        <td className={`px-3 py-2 text-right text-xs align-top ${TONE_TEXT[tone]}`}>{STATUS_LABEL[r.status]}</td>
      </tr>
      {r.isNearMiss && (
        <tr className="bg-amber-50 border-b border-amber-100">
          <td colSpan={5} className="px-3 pb-2 text-xs text-amber-800">
            This is the only criterion holding the category back — everything else in it cleared the next level up.
          </td>
        </tr>
      )}
    </>
  );
}

function unitPlaceholder(unit: ConditionUnit): string {
  switch (unit) {
    case "boolean": return "1 = yes";
    case "rating": return "0/1/2";
    case "percent": return "%";
    case "currency": return "$";
    default: return "";
  }
}
