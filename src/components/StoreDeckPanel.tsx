"use client";

import { useState } from "react";
import type { WbrWeekOption } from "@/lib/wbr/weeks";
import { ALL_STORES } from "@/lib/stores";
import { StoreFilterPicker, type Leader, type StoreFilterValue } from "@/components/StoreFilter";

/**
 * The store presentation: pick what to cover — the same dropdown as the ribbon
 * (all stores, a market, an above-store leader or one store) — and a week, and
 * get overview, sales, labor, drive-thru, food cost, SMG and compliance slides
 * for each store. A deck of more than one store is ordered slide by slide
 * (lib/wbr/generateStore). Sits on the Management tab, shown only to people
 * signed in with Google.
 *
 * Someone signed in with their HRG Google account saves it straight into their
 * own Google Drive as Google Slides (a "Store Reviews" folder): the button goes
 * to /api/wbr/drive/start, Google asks once for permission, and the page comes
 * back here with the link (`driveResult`). There is no PowerPoint download:
 * the deck only ever goes to the person's own Drive.
 *
 * `weeks` comes from the server so the render and the browser agree on which
 * Sunday was last.
 */

export type DriveResult =
  | { status: "saved"; url: string; name: string; warnings: string[] }
  | { status: "error"; message: string };

export default function StoreDeckPanel({
  weeks,
  leaders,
  driveResult,
  initialTarget,
  initialWeekEnd,
}: {
  weeks: WbrWeekOption[];
  /** The ribbon's leaders. */
  leaders: Leader[];
  /** What the last Drive save came back with, if the page was just returned to. */
  driveResult: DriveResult | null;
  /** A store-filter value, as the ribbon's: "", "va", "leader:<id>", "store:<label>". */
  initialTarget?: string;
  initialWeekEnd?: string;
}) {
  const [target, setTarget] = useState<StoreFilterValue>(initialTarget ?? `store:${ALL_STORES[0]?.label ?? ""}`);
  const [weekEnd, setWeekEnd] = useState(weeks.some((w) => w.weekEnd === initialWeekEnd) ? initialWeekEnd! : (weeks[0]?.weekEnd ?? ""));
  const [busy, setBusy] = useState(false);
  // The Drive result stays up until the selection changes.
  const [drive, setDrive] = useState<DriveResult | null>(driveResult);

  const reset = () => setDrive(null);
  const single = target.startsWith("store:");

  const saveToDrive = () => {
    setBusy(true);
    reset();
    // A full navigation: Google's permission page, then the build, then back here.
    window.location.href = `/api/wbr/drive/start?${new URLSearchParams({ target, weekEnd })}`;
  };

  const select = "text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 cursor-pointer";
  const primary = "text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition";

  const warnings = (list: string[]) =>
    list.length > 0 && (
      <ul className="list-disc pl-4 text-yellow-700">
        {list.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    );

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Store presentation</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Saves to your Google Drive as Google Slides, in a Store Reviews folder: overview, sales, labor, drive-thru, food
            cost, SMG and compliance.
          </p>
        </div>
        <StoreFilterPicker
          leaders={leaders}
          value={target}
          onChange={(v) => {
            setTarget(v);
            reset();
          }}
          disabled={busy}
          className="py-1.5"
          stores
        />
        <select
          value={weekEnd}
          onChange={(e) => {
            setWeekEnd(e.target.value);
            reset();
          }}
          disabled={busy}
          aria-label="Week"
          className={select}
        >
          {weeks.map((w) => (
            <option key={w.weekEnd} value={w.weekEnd}>
              Week of {w.label.split(" · data ")[1] ?? w.label}
            </option>
          ))}
        </select>
        <button onClick={saveToDrive} disabled={busy} className={primary}>
          {busy ? "Saving to Drive…" : "Save to Google Drive"}
        </button>
      </div>

      {!single && !busy && (
        <p className="mt-3 text-xs text-gray-500">
          One deck for every store in this selection, with the same slide for each store side by side: each store&apos;s
          overview, then each store&apos;s sales, and so on.
        </p>
      )}
      {busy && <p className="mt-3 text-xs text-gray-500">{single ? "This takes up to a minute." : "This can take a few minutes."}</p>}

      {drive?.status === "saved" && (
        <div className="mt-3 text-xs text-gray-700 space-y-1">
          <p>
            Saved <span className="font-medium text-gray-900">{drive.name}</span> to your Google Drive, in Store
            Reviews.{" "}
            <a href={drive.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">
              Open in Google Slides →
            </a>
          </p>
          {warnings(drive.warnings)}
        </div>
      )}
      {drive?.status === "error" && <p className="mt-3 text-xs text-red-600">Couldn&apos;t save to Google Drive: {drive.message}</p>}
    </section>
  );
}
