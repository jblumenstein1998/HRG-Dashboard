"use client";

import TabOptions from "@/components/TabOptions";
import type { Tab } from "@/lib/users/tabs";

/**
 * Bonus attainment — one store's scorecard, every position on it, top to bottom.
 *
 * Reads stored results only; the nightly cron owns computing them. The one
 * write path is the inline editor, which rescores the period on save so the
 * numbers move immediately.
 *
 * A store at a time rather than a store × position grid. The grid answered
 * "who is behind" across the estate, but the work this screen exists for is a
 * conversation with one store's management team about their period, and that
 * conversation runs down the org chart — GM, AGM, then the four Directors —
 * not across twelve stores. Reading it meant opening one cell at a time and
 * losing the last one to do it. (A roll-up across stores can come back as its
 * own summary table; it is a different question and wants a different shape.)
 *
 * Editing happens inside each category rather than on a separate screen,
 * because the two are the same task: you look at why a category scored what it
 * did, and the thing that fixes it is usually a number nobody has entered yet.
 *
 * Two things this screen has to get right, because they're the difference
 * between a useful scorecard and a misleading one:
 *
 *  1. **A pending criterion is never shown as a zero.** Most criteria in these
 *     docs have no automated source, so an un-entered scorecard is the normal
 *     state early in a period. Every position carries the weight it was scored
 *     over, and unscored categories say so.
 *  2. **The near-miss is called out.** Scoring is strict — one condition short
 *     of Target drops a whole category from 100% to 50% — so the screen names
 *     the condition that cost it rather than leaving someone to diff a table.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyableTitle } from "@/components/CopyImageButton";
import { BONUS_STORES } from "@/lib/bonus/storeMap";
import { currentPeriodLabel } from "@/lib/bonus/periods";
import { OVERRIDE_PREFIX, categoryOverrideId } from "@/lib/bonus/rules";
import {
  POSITION_LABELS,
  type CategoryResult, type ConditionResult, type ConditionUnit, type PositionId, type PositionResult,
} from "@/lib/bonus/types";
import {
  STATUS_LABEL, STATUS_TONE, TONE_BG, TONE_TEXT,
  bonusTone, coverageNote, fmtGateValue, fmtScore, fmtValue,
} from "@/lib/bonus/display";

/**
 * Reading order down the org chart, which is not the order the engine computes
 * in — `POSITION_ORDER` puts the Directors before the AGM because the AGM's
 * score is derived from theirs, and compute.ts depends on that. This is purely
 * how the page reads.
 */
const SCORECARD_ORDER: PositionId[] = [
  "gm",
  "agm",
  "hospitality",
  "driveThru",
  "quality",
  "training",
];

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
  const [storeId, setStoreId] = useState<string>(() => BONUS_STORES[0].storeId);
  const [refreshKey, setRefreshKey] = useState(0);

  const cardRef = useRef<HTMLDivElement>(null);
  const store = BONUS_STORES.find((s) => s.storeId === storeId) ?? BONUS_STORES[0];

  /**
   * Loading is derived from a request key rather than set at the top of the
   * effect. The React Compiler is on and rejects a synchronous setState inside
   * an effect body; keying the stored response is the pattern the SMG tab
   * already uses, and it also drops responses that arrive out of order after a
   * fast period or store switch.
   */
  const requestKey = `${period}|${storeId}|${refreshKey}`;
  const [state, setState] = useState<{ key: string; data: AttainmentResponse | null; error: string | null }>(
    { key: "", data: null, error: null }
  );

  useEffect(() => {
    let cancelled = false;
    const qs = `period=${encodeURIComponent(period)}&store=${encodeURIComponent(storeId)}`;
    fetch(`/api/bonus/attainment?${qs}`)
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
  }, [requestKey, period, storeId, router]);

  const loading = state.key !== requestKey;
  const data = state.data;
  const error = state.error;
  const locked = data?.locked ?? false;

  const byPosition = useMemo(() => {
    const map = new Map<PositionId, StoredResult>();
    for (const r of data?.results ?? []) map.set(r.positionId, r);
    return map;
  }, [data]);

  /**
   * Manual entries live here rather than inside each position, because they are
   * stored per store and period, not per position — six scorecards on screen
   * would otherwise each fetch the same rows and each hold a rival copy of
   * them. One fetch, one edit buffer, one save covering every position.
   */
  const inputsKey = `${period}|${storeId}`;
  const [loadedInputs, setLoadedInputs] = useState<{ key: string; values: Record<string, string> }>({ key: "", values: {} });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/inputs?period=${encodeURIComponent(period)}&store=${storeId}`)
      .then((r) => r.json())
      .then((json: { inputs?: BonusInput[] }) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const i of json.inputs ?? []) next[i.criterionId] = i.value === null ? "" : String(i.value);
        setLoadedInputs({ key: inputsKey, values: next });
      })
      .catch(() => { if (!cancelled) setLoadedInputs({ key: inputsKey, values: {} }); });
    return () => { cancelled = true; };
  }, [inputsKey, period, storeId]);

  // A store or period switch must not carry the previous one's unsaved edits
  // onto a different scorecard, where they would be saved against the wrong
  // store. Clearing on the key rather than in the switch handler covers every
  // route into a change, including the period list arriving late.
  useEffect(() => {
    setEdits({});
    setSaveStatus(null);
  }, [inputsKey]);

  const inputsLoading = loadedInputs.key !== inputsKey;
  const values = useMemo(() => ({ ...loadedInputs.values, ...edits }), [loadedInputs, edits]);
  const dirty = Object.keys(edits).length > 0;

  const save = async () => {
    setSaving(true);
    setSaveStatus(null);
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
      setLoadedInputs((prev) => ({ key: prev.key, values: { ...prev.values, ...edits } }));
      setEdits({});
      setSaveStatus(json.recomputed ? "Saved and rescored." : `Saved, but rescoring failed: ${json.recomputeError}`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setSaveStatus(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const windowLabel = data?.window?.label ?? period;
  const scored = SCORECARD_ORDER.map((id) => byPosition.get(id)).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
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
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="text-sm font-semibold text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              <optgroup label="Tennessee">
                {BONUS_STORES.filter((s) => s.state === "TN").map((s) => (
                  <option key={s.storeId} value={s.storeId}>{s.name}</option>
                ))}
              </optgroup>
              <optgroup label="Virginia">
                {BONUS_STORES.filter((s) => s.state === "VA").map((s) => (
                  <option key={s.storeId} value={s.storeId}>{s.name}</option>
                ))}
              </optgroup>
            </select>

            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="text-sm font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              {(data?.periods ?? [{ label: period, isPartial: false }]).map((p) => (
                <option key={p.label} value={p.label}>{p.label}{p.isPartial ? " · to date" : ""}</option>
              ))}
            </select>

            {data?.window && (
              <span className="text-xs text-gray-500">
                {shortDate(data.window.start)}–{shortDate(data.window.end)}
                {data.window.isPartial && " · in progress"}
              </span>
            )}
            {locked && (
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-4 space-y-3">
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => setRefreshKey((k) => k + 1)} className="text-xs font-medium underline underline-offset-2 shrink-0">Retry</button>
          </div>
        )}

        <div ref={cardRef} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <CopyableTitle
            title={`${store.name} — bonus attainment, ${windowLabel}`}
            targetRef={cardRef}
            className="text-base font-semibold text-gray-900"
          />
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
              Loading…
            </span>
          )}
        </div>

        {locked && (
          <div className="rounded-lg bg-gray-900 text-white text-xs px-3 py-2">
            {period} is locked — these are the figures the period was approved on. Unlock it to make changes.
          </div>
        )}
        {saveStatus && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 px-3 py-2">{saveStatus}</div>
        )}

        {!loading && scored === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
            Nothing computed for {store.name} in {period} yet — the nightly rollup hasn&apos;t run for this period.
          </div>
        ) : (
          <div className={`space-y-2.5 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
            {SCORECARD_ORDER.map((positionId) => (
              <PositionScorecard
                key={positionId}
                positionId={positionId}
                result={byPosition.get(positionId)?.detail ?? null}
                values={values}
                inputsLoading={inputsLoading}
                locked={locked}
                onChange={(id, v) => setEdits((prev) => ({ ...prev, [id]: v }))}
              />
            ))}
          </div>
        )}

        <p className="text-[11px] text-gray-400">
          Blank means <em>not entered</em> and leaves a category unscored — which is not the same as
          entering 0. Editable fields are marked <span className="text-blue-500 uppercase tracking-wide">entered</span>.
          Attainment is a percentage of target and can exceed 100% when a category multiplier or the
          transaction-growth kicker fires.
        </p>
      </main>

      {/* One save for the whole store: entries are stored per store and period,
          and a category on the GM's card and one on a Director's can both be
          waiting on the same number. */}
      {dirty && !locked && (
        <div className="sticky bottom-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <span className="text-xs text-gray-600">
              {Object.keys(edits).length} unsaved {Object.keys(edits).length === 1 ? "entry" : "entries"}
            </span>
            <button
              onClick={() => setEdits({})}
              disabled={saving}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save & rescore"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Postgres DATE values arrive as timestamps stamped UTC — read UTC components. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ── One position, with its categories and their entry fields ─────────────────

function PositionScorecard({
  positionId, result, values, inputsLoading, locked, onChange,
}: {
  positionId: PositionId;
  result: PositionResult | null;
  values: Record<string, string>;
  inputsLoading: boolean;
  locked: boolean;
  onChange: (criterionId: string, value: string) => void;
}) {
  // Closed to start, like the categories inside them. The page opens as the
  // six positions with their scores, which is the question being asked most of
  // the time; opening one is how you ask why.
  const [open, setOpen] = useState(false);
  const tone = bonusTone(result?.score ?? null);
  const note = result ? coverageNote(result.scoreableWeight, result.pendingCount) : null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!result}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left ${TONE_BG[tone]} ${result ? "hover:brightness-95" : ""} transition disabled:cursor-default`}
      >
        <span className={`text-[10px] text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
        <span className="text-sm font-semibold text-gray-900">{POSITION_LABELS[positionId]}</span>
        {result?.kickerFired && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-900 text-white">×1.25 kicker</span>
        )}
        {result && result.pendingCount > 0 && (
          <span className="text-[11px] text-gray-500">{result.pendingCount} not entered</span>
        )}
        <span className="ml-auto text-right">
          <span className={`text-base font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
            {result ? fmtScore(result.score) : "—"}
          </span>
          {note && <span className="block text-[10px] leading-tight text-gray-400">{note}</span>}
        </span>
      </button>

      {open && (
        result === null ? (
          <p className="px-3 py-3 text-sm text-gray-400">Not computed for this period.</p>
        ) : inputsLoading ? (
          <p className="px-3 py-3 text-sm text-gray-400 animate-pulse">Loading entries…</p>
        ) : (
          <div className="px-3 py-2 space-y-2 border-t border-gray-100">
            {result.categories.map((cat) => (
              <CategoryCard
                key={cat.category.id}
                cat={cat}
                positionId={positionId}
                values={values}
                locked={locked}
                onChange={onChange}
              />
            ))}
          </div>
        )
      )}
    </section>
  );
}

function CategoryCard({
  cat, positionId, values, locked, onChange,
}: {
  cat: CategoryResult;
  positionId: PositionId;
  values: Record<string, string>;
  locked: boolean;
  onChange: (criterionId: string, value: string) => void;
}) {
  // Categories start closed. Six positions of several categories each is a very
  // long page open, and the header already carries the score, the weight and
  // the override — which is all that is wanted until something looks wrong.
  const [open, setOpen] = useState(false);
  const overrideId = categoryOverrideId(positionId, cat.category.id);
  // Saved inputs with unsaved edits over the top — the same source every other
  // field on the card reads from, so a click shows immediately rather than
  // waiting for a save to round-trip through the engine.
  const overrideValue = values[overrideId] ?? "";
  const hasOverride = overrideValue.trim() !== "";
  // "other" is picked before a figure is typed, so the box has to be able to
  // show while nothing is stored — an empty value means "computed" everywhere
  // else and would otherwise snap the picker straight back.
  const [otherPicked, setOtherPicked] = useState(false);
  const showOtherInput = hasOverride || otherPicked;
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
      <div className="px-3 py-1.5 flex flex-wrap items-center gap-x-3 bg-gray-50 border-b border-gray-100">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-left min-w-0"
        >
          <span className={`text-[10px] text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
          <span className="text-sm font-semibold text-gray-800">{cat.category.label}</span>
          <span className="text-xs text-gray-400 whitespace-nowrap">{cat.category.weight}% of total</span>
          {!open && cat.pendingCount > 0 && (
            <span className="text-xs text-gray-400 whitespace-nowrap">· {cat.pendingCount} pending</span>
          )}
        </button>
        <span className={`text-sm tabular-nums ml-auto ${hasOverride ? "text-amber-700 font-medium" : TONE_TEXT[tone]}`}>
          {cat.score === null ? "Not yet scoreable" : `${(cat.score * 100).toFixed(0)}%`}
          {cat.multiplier > 1 && <span className="ml-1 text-xs">×{cat.multiplier}</span>}
        </span>
        {/* What the rules produced, kept in view beside the decision — the
            reason for overriding is usually that this figure is wrong in a
            known way, and hiding it removes the evidence. */}
        {hasOverride && (
          <span className="text-[11px] text-gray-400 whitespace-nowrap">
            computed{" "}
            {cat.computedScore === null ? "not scoreable" : `${(cat.computedScore * 100).toFixed(0)}%`}
          </span>
        )}
        {!locked && (
          // Overriding the result rather than the numbers behind it. Which
          // input to bend to move a category off a miss was always a guess, and
          // the judgement is the thing worth recording anyway.
          <span className="inline-flex items-center gap-1">
            <select
              value={showOtherInput ? "other" : ""}
              onChange={(e) => {
                const other = e.target.value === "other";
                setOtherPicked(other);
                if (!other) onChange(overrideId, "");
              }}
              title="Set this category's result by hand"
              className={`text-[11px] rounded-md py-0.5 pl-2 pr-6 focus:outline-none focus:ring-2 focus:ring-gray-200 ${
                hasOverride
                  ? "border border-amber-300 bg-amber-50 text-amber-800"
                  : "border border-dashed border-gray-300 bg-white text-gray-500"
              }`}
            >
              <option value="">computed</option>
              <option value="other">other…</option>
            </select>
            {showOtherInput && (
              <span className="inline-flex items-center gap-0.5">
                <input
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  inputMode="decimal"
                  autoFocus={otherPicked && !hasOverride}
                  value={overrideValue}
                  onChange={(e) => onChange(overrideId, e.target.value)}
                  placeholder="0–100"
                  title="Percentage of this category earned"
                  className="w-16 text-[11px] text-right tabular-nums rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-gray-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-[11px] text-amber-700">%</span>
              </span>
            )}
          </span>
        )}
        {locked && cat.scoreOverride !== null && (
          <span className="text-[10px] uppercase tracking-wide text-amber-600">overridden</span>
        )}
        {!locked && hasOverride && String(cat.scoreOverride ?? "") !== overrideValue && (
          <span className="text-[10px] uppercase tracking-wide text-amber-600">unsaved</span>
        )}
        <span className="text-xs tabular-nums text-gray-500 w-16 text-right">
          {cat.payout === null ? "—" : `${cat.payout.toFixed(1)} pts`}
        </span>
      </div>

      {open && cat.disqualifiedBy && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">
          Disqualified — {cat.disqualifiedBy}. This category scores 0 regardless of the criteria below.
        </div>
      )}
      {open && cat.multiplier > 1 && cat.multipliersFired.length > 0 && (
        <div className="px-3 py-2 bg-green-50 border-b border-green-100 text-xs text-green-700">
          Multiplier ×{cat.multiplier} — {cat.multipliersFired.map((m) => m.label).join("; ")}
        </div>
      )}
      {open && derived && (
        <div className="px-3 py-2 text-xs text-gray-600 border-b border-gray-100">
          Derived from {derived.map((d) => POSITION_LABELS[d]).join(", ")}, excluding their Living Our Values
          category. The transaction-growth kicker is deliberately not carried up — this position earns its own.
        </div>
      )}

      {open && rows.length > 0 && (
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-3 py-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Criterion</th>
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

  // Compared as rendered text rather than as gates: a two-sided "between" and
  // a one-sided gate can print the same thing, and what matters here is only
  // whether the reader would see the same figure twice.
  const thresholdText = fmtGateValue(r.thresholdUsed, unit);
  const targetText = fmtGateValue(r.targetUsed, unit);
  const oneGate = thresholdText === targetText;

  // Results are corrected on the category now, not here. The per-metric
  // mechanism still exists in the engine, so a value entered before the switch
  // would still apply — surfaced, rather than left to work invisibly.
  const legacyOverrideId = r.condition.source === "auto" ? `${OVERRIDE_PREFIX}${r.condition.metric}` : null;
  const overridden = legacyOverrideId ? (values[legacyOverrideId] ?? "").trim() !== "" : false;

  return (
    <>
      <tr className={`border-b border-gray-50 ${r.isNearMiss ? "bg-amber-50" : ""}`}>
        <td className="px-3 py-1.5 text-gray-800 align-top break-words">
          {r.condition.label}
          {kind === "disqualifier" && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">disqualifier</span>}
          {kind === "multiplier" && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-green-600">multiplier {badge}</span>}
          {r.condition.advisory && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">not scored</span>}
          {r.condition.source === "manual" && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-blue-400">entered</span>}
          {r.condition.note && (
            <div className="text-[10px] leading-snug text-gray-400 max-w-xl">{r.condition.note}</div>
          )}
        </td>
        <td
          colSpan={unit === "tenPoint" ? 3 : 1}
          className="px-3 py-1.5 text-right align-top"
        >
          {editable ? (
            <UnitField
              unit={unit}
              value={values[r.condition.id] ?? ""}
              onChange={(v) => onChange(r.condition.id, v)}
            />
          ) : (
            <span
              className={`tabular-nums ${overridden ? "text-amber-700 font-medium" : TONE_TEXT[tone]}`}
              title={overridden ? "Entered by hand — this is not the vendor's figure" : undefined}
            >
              {fmtValue(r.value, unit)}
            </span>
          )}
          {overridden && (
            <div className="text-[10px] text-amber-600 mt-0.5 uppercase tracking-wide">value override</div>
          )}
        </td>
        {unit === "tenPoint" ? (
          <td className={`px-3 py-1.5 text-right text-xs align-top ${TONE_TEXT[tone]}`}>
            {STATUS_LABEL[r.status]}
          </td>
        ) : (
          <>
            {oneGate ? (
              <td colSpan={2} className="px-3 py-1.5 text-center tabular-nums text-gray-400 align-top">{targetText}</td>
            ) : (
              <>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-400 align-top">{thresholdText}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-400 align-top">{targetText}</td>
              </>
            )}
            <td className={`px-3 py-1.5 text-right text-xs align-top ${TONE_TEXT[tone]}`}>{STATUS_LABEL[r.status]}</td>
          </>
        )}
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

/**
 * An entry box shaped like the figure it is asking for.
 *
 * A target of "≥ 80%" wants 80 typed into a box that says %, not a bare number
 * whose scale has to be guessed — and a yes/no, a Meets/Exceeds review or a
 * mark out of ten should not be a free-text number at all, which is how values
 * off the scale got entered in the first place.
 *
 * Blank is always "not entered", which the engine reads as pending and keeps
 * distinct from a real 0. It shows as the same em dash a pending value renders
 * as elsewhere on the card, so the two read alike.
 */
const UNIT_CHOICES: Partial<Record<ConditionUnit, { value: string; label: string }[]>> = {
  boolean: [
    { value: "1", label: "Yes" },
    { value: "0", label: "No" },
  ],
  rating: [
    { value: "0", label: "0 · Below" },
    { value: "1", label: "1 · Meets" },
    { value: "2", label: "2 · Exceeds" },
  ],
  // Reviews are given at three levels, so those are the only marks offered.
  // Stored on the 0-10 scale the engine divides by ten — 5 is a half-credit
  // Meets — which keeps the proportional scoring and its tests untouched, and
  // leaves room for finer marks later without a migration.
  tenPoint: [
    { value: "0", label: "Needs improvement" },
    { value: "5", label: "Meets" },
    { value: "10", label: "Exceeds" },
  ],
};

const UNIT_ADORNMENT: Partial<Record<ConditionUnit, { prefix?: string; suffix?: string }>> = {
  percent: { suffix: "%" },
  currency: { prefix: "$" },
  seconds: { suffix: "sec" },
};

function UnitField({
  unit, value, onChange, title, placeholder,
}: {
  unit: ConditionUnit;
  value: string;
  onChange: (value: string) => void;
  title?: string;
  placeholder?: string;
}) {
  const frame =
    "text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-200";

  const choices = UNIT_CHOICES[unit];
  if (choices) {
    // Left-aligned with room for the arrow. Sharing the number box's
    // `text-right px-2 w-20` pushed the labels against both edges — and Chrome
    // carries the alignment into the open list, so the options were crammed too.
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        className={`${frame} py-1 pl-2.5 pr-7 min-w-[8.5rem] text-left`}
      >
        <option value="">—</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    );
  }

  const adornment = UNIT_ADORNMENT[unit];
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {adornment?.prefix && <span className="text-xs text-gray-400">{adornment.prefix}</span>}
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        title={title}
        className={`${frame} w-20 px-2 py-0.5 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      {adornment?.suffix && <span className="text-xs text-gray-400">{adornment.suffix}</span>}
    </span>
  );
}
