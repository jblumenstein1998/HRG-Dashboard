"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CopyableTitle } from "@/components/CopyImageButton";
import { STORE_LABELS, TONE_BG, TONE_TEXT, type ScoreTone } from "@/lib/surveyMeta";

type Reading = { rating: number; reviews: number; asOf: string };
type StoreRating = { storeId: string; reviewsUri: string | null; current: Reading };
type RatingsResponse = { historyFrom: string | null; stores: StoreRating[]; error?: string };

/**
 * The three bands, best first. Google's averages bunch between 3.5 and 4.5,
 * so the cut-offs sit there rather than at SMG's percentages.
 */
const BANDS: { tone: ScoreTone; label: string; min: number }[] = [
  { tone: "good", label: "4.3+", min: 4.3 },
  { tone: "ok", label: "4.0+", min: 4.0 },
  { tone: "bad", label: "< 4.0", min: -Infinity },
];

const mdy = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
};

/**
 * Google ratings for the SMG tab: each store's current star rating, sorted
 * into three bands.
 *
 * Current only, and so independent of the period picker. The daily readings
 * behind it (lib/googleRatings.ts) are still collected — once there's enough
 * history, change over a window can come back.
 */
export default function GoogleReviewsSection({
  stores,
  refreshKey,
}: {
  /** Store ids the filter allows; null = every store. */
  stores: string[] | null;
  refreshKey: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<RatingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/smg/google-ratings")
      .then((r) => r.json())
      .then((j: RatingsResponse) => !cancelled && setData(j.error ? null : j))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const listed = useMemo(
    () =>
      (data?.stores ?? [])
        .filter((s) => STORE_LABELS[s.storeId] && (!stores || stores.includes(s.storeId)))
        .sort((a, b) => b.current.rating - a.current.rating || STORE_LABELS[a.storeId].localeCompare(STORE_LABELS[b.storeId])),
    [data, stores],
  );

  const columns = BANDS.map((band, i) => ({
    ...band,
    stores: listed.filter((s) => s.current.rating >= band.min && (i === 0 || s.current.rating < BANDS[i - 1].min)),
  }));

  const latestAsOf = listed.reduce<string | null>((m, s) => (m === null || s.current.asOf > m ? s.current.asOf : m), null);

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-5">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <CopyableTitle title="Google Reviews" targetRef={cardRef} className="text-sm font-semibold text-gray-800" />
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
              Loading…
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500 shrink-0">
          {latestAsOf ? `Google as of ${mdy(latestAsOf)}` : loading ? "" : "No readings yet"}
        </span>
      </div>
      <div className="grid grid-cols-3 border-t border-gray-200">
        {columns.map((col, i) => (
          <div key={col.label} className={i > 0 ? "border-l border-gray-200" : ""}>
            <div
              className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide flex justify-between ${TONE_TEXT[col.tone]} ${TONE_BG[col.tone]}`}
            >
              <span>{col.label}</span>
              <span className="tabular-nums">{col.stores.length}</span>
            </div>
            {col.stores.map((s) => (
              <div key={s.storeId} className="px-4 py-2.5 flex justify-between gap-2 text-sm border-b border-gray-100">
                <span className="font-medium text-gray-900 truncate">{STORE_LABELS[s.storeId]}</span>
                {s.reviewsUri ? (
                  <a
                    href={s.reviewsUri}
                    target="_blank"
                    rel="noreferrer"
                    title={`${s.current.reviews.toLocaleString("en-US")} reviews — open on Google`}
                    className={`tabular-nums hover:underline ${TONE_TEXT[col.tone]}`}
                  >
                    {s.current.rating.toFixed(1)}★
                  </a>
                ) : (
                  <span className={`tabular-nums ${TONE_TEXT[col.tone]}`}>{s.current.rating.toFixed(1)}★</span>
                )}
              </div>
            ))}
            {!loading && col.stores.length === 0 && (
              <div className="px-4 py-2.5 text-sm text-gray-400">None</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
