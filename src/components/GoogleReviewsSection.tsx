"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CopyableTitle } from "@/components/CopyImageButton";
import { STORE_LABELS, TONE_BG, TONE_TEXT, type ScoreTone } from "@/lib/surveyMeta";

type Reading = { rating: number; reviews: number; asOf: string };
type StoreRating = {
  storeId: string;
  reviewsUri: string | null;
  current: Reading;
  windowStart: Reading | null;
  windowEnd: Reading | null;
};
type RatingsResponse = { historyFrom: string | null; stores: StoreRating[]; error?: string };

type Row = {
  storeId: string;
  label: string;
  reviewsUri: string | null;
  rating: number | null;
  reviews: number | null;
  /** Reviews gained over the window; null without a reading at its start. */
  gained: number | null;
  /** How far the star rating moved over the window. */
  moved: number | null;
};

const STORE_COL_PCT = 28;
const DATA_COLS = 4;

/**
 * Star thresholds. Google's averages bunch between 3.5 and 4.5, so the bands
 * sit there rather than at SMG's percentages.
 */
function ratingTone(r: number | null): ScoreTone {
  if (r === null) return "none";
  return r >= 4.3 ? "good" : r >= 4.0 ? "ok" : "bad";
}

const mdy = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
};

/** Review-weighted average — a 1,000-review store counts for more than a 50-review one. */
function weighted(pairs: { rating: number; reviews: number }[]): number | null {
  const n = pairs.reduce((s, p) => s + p.reviews, 0);
  return n ? pairs.reduce((s, p) => s + p.rating * p.reviews, 0) / n : null;
}

/**
 * Google ratings for the SMG tab.
 *
 * Rating and Reviews are Google's lifetime figures as of the latest daily
 * reading — they ignore the period picker, because Google has no notion of a
 * period. The two window columns do follow it: they're the difference between
 * the readings either side of the window (lib/googleRatings.ts), and blank for
 * any window that starts before the readings do.
 */
export default function GoogleReviewsSection({
  start,
  end,
  label,
  stores,
  totalLabel,
  refreshKey,
}: {
  start: string | null;
  end: string | null;
  label: string;
  /** Store ids the filter allows; null = every store. */
  stores: string[] | null;
  totalLabel: string;
  refreshKey: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const query = `start=${start ?? ""}&end=${end ?? ""}`;
  const [state, setState] = useState<{ key: string; data: RatingsResponse | null }>({ key: "", data: null });
  const [sort, setSort] = useState<{ col: keyof Row; dir: "asc" | "desc" }>({ col: "rating", dir: "desc" });

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    fetch(`/api/smg/google-ratings?${params}`)
      .then((r) => r.json())
      .then((j: RatingsResponse) => !cancelled && setState({ key: query, data: j.error ? null : j }))
      .catch(() => !cancelled && setState({ key: query, data: null }));
    return () => {
      cancelled = true;
    };
  }, [query, start, end, refreshKey]);

  const data = state.data;
  const loading = state.key !== query;

  const rows = useMemo<Row[]>(() => {
    const byStore = new Map((data?.stores ?? []).map((s) => [s.storeId, s]));
    return Object.keys(STORE_LABELS)
      .filter((id) => !stores || stores.includes(id))
      .map((id) => {
        const s = byStore.get(id);
        const from = s?.windowStart;
        const to = s?.windowEnd;
        return {
          storeId: id,
          label: STORE_LABELS[id],
          reviewsUri: s?.reviewsUri ?? null,
          rating: s?.current.rating ?? null,
          reviews: s?.current.reviews ?? null,
          gained: from && to ? to.reviews - from.reviews : null,
          moved: from && to ? to.rating - from.rating : null,
        };
      });
  }, [data, stores]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.col];
      const y = b[sort.col];
      if (sort.col === "label") return dir * a.label.localeCompare(b.label);
      // Blanks sink either way, same as the survey table.
      if (x === null && y === null) return a.label.localeCompare(b.label);
      if (x === null) return 1;
      if (y === null) return -1;
      return dir * ((x as number) - (y as number)) || a.label.localeCompare(b.label);
    });
  }, [rows, sort]);

  /** The rollup line. The window columns only total when every listed store has both readings. */
  const total = useMemo(() => {
    const rated = (data?.stores ?? []).filter((s) => !stores || stores.includes(s.storeId));
    const allWindowed = rated.length > 0 && rated.every((s) => s.windowStart && s.windowEnd);
    const startAvg = allWindowed ? weighted(rated.map((s) => s.windowStart!)) : null;
    const endAvg = allWindowed ? weighted(rated.map((s) => s.windowEnd!)) : null;
    return {
      rating: weighted(rated.map((s) => s.current)),
      reviews: rated.length ? rated.reduce((n, s) => n + s.current.reviews, 0) : null,
      gained: allWindowed ? rated.reduce((n, s) => n + s.windowEnd!.reviews - s.windowStart!.reviews, 0) : null,
      moved: startAvg !== null && endAvg !== null ? endAvg - startAvg : null,
    };
  }, [data, stores]);

  const latestAsOf = (data?.stores ?? []).reduce<string | null>(
    (m, s) => (m === null || s.current.asOf > m ? s.current.asOf : m),
    null,
  );
  // Says why the window columns are blank rather than leaving them to look broken.
  const noBaseline = Boolean(start && data?.historyFrom && start < data.historyFrom);

  const header = (col: keyof Row, text: string, align: "left" | "right" = "right") => {
    const active = sort.col === col;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide ${align === "left" ? "text-left" : "text-right"}`}
      >
        <button
          type="button"
          onClick={() =>
            setSort({ col, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : col === "label" ? "asc" : "desc" })
          }
          className={`inline-flex items-center gap-1 w-full cursor-pointer transition-colors hover:text-gray-600 ${
            align === "left" ? "justify-start" : "justify-end"
          } ${active ? "text-gray-700" : "text-gray-400"}`}
        >
          <span>{text}</span>
          <span aria-hidden="true" className={`text-[9px] leading-none ${active ? "opacity-100" : "opacity-0"}`}>
            {sort.dir === "asc" ? "▲" : "▼"}
          </span>
        </button>
      </th>
    );
  };

  // Google gives a store's rating to one decimal; only the weighted total carries two.
  const fmtRating = (r: number | null) => (r === null ? "—" : r.toFixed(1));
  const fmtMoved = (m: number | null) =>
    m === null ? "—" : Math.abs(m) < 0.05 ? "0.0" : `${m > 0 ? "+" : "−"}${Math.abs(m).toFixed(1)}`;
  const movedTone = (m: number | null) =>
    m === null || Math.abs(m) < 0.005 ? "text-gray-700" : m > 0 ? "text-green-600" : "text-red-600";

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-5">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CopyableTitle title="Google Reviews" targetRef={cardRef} className="text-sm font-semibold text-gray-800" />
            {loading && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
                Loading…
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400">
            New / change over {start && end ? `${mdy(start)} – ${mdy(end)}` : label}
          </div>
        </div>
        <span className="text-xs text-gray-500 shrink-0">
          {latestAsOf ? `Google as of ${mdy(latestAsOf)}` : "No readings yet"}
        </span>
      </div>
      <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: `${STORE_COL_PCT}%` }} />
            {Array.from({ length: DATA_COLS }).map((_, i) => (
              <col key={i} style={{ width: `${(100 - STORE_COL_PCT) / DATA_COLS}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200">
              {header("label", "Store", "left")}
              {header("rating", "Rating")}
              {header("reviews", "Reviews")}
              {header("gained", "New reviews")}
              {header("moved", "Rating change")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const tone = ratingTone(r.rating);
              return (
                <tr key={r.storeId} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.label}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${TONE_TEXT[tone]} ${TONE_BG[tone]}`}>
                    {r.reviewsUri && r.rating !== null ? (
                      <a href={r.reviewsUri} target="_blank" rel="noreferrer" className="hover:underline" title="Open this store's Google reviews">
                        {fmtRating(r.rating)}★
                      </a>
                    ) : (
                      fmtRating(r.rating)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {r.reviews === null ? "—" : r.reviews.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.gained ?? "—"}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${movedTone(r.moved)}`}>{fmtMoved(r.moved)}</td>
                </tr>
              );
            })}
            {rows.length > 0 && (
              <tr className="border-b border-gray-200 border-t-2 border-t-gray-400">
                <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{totalLabel}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-semibold ${TONE_TEXT[ratingTone(total.rating)]} ${TONE_BG[ratingTone(total.rating)]}`}>
                  {total.rating === null ? "—" : total.rating.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                  {total.reviews === null ? "—" : total.reviews.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{total.gained ?? "—"}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-semibold ${movedTone(total.moved)}`}>
                  {total.moved === null ? "—" : `${total.moved > 0 ? "+" : total.moved < 0 ? "−" : ""}${Math.abs(total.moved).toFixed(2)}`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
        Rating and Reviews are Google&apos;s lifetime figures. New reviews and Rating change follow the period picker
        {data?.historyFrom ? `; daily readings start ${mdy(data.historyFrom)}` : ""}
        {noBaseline ? ", so this window has no starting reading yet." : "."}
      </p>
    </div>
  );
}
