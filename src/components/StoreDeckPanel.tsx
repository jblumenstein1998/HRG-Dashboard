"use client";

import { useState } from "react";
import type { WbrWeekOption } from "@/lib/wbr/weeks";

/**
 * The store presentation: pick a store and a week, get that store's overview,
 * sales, labor, drive-thru, food cost, SMG and compliance slides. Sits on the
 * Management tab, shown only to people signed in with Google.
 *
 * Someone signed in with their HRG Google account saves it straight into their
 * own Google Drive as Google Slides (a "Store Reviews" folder): the button goes
 * to /api/wbr/drive/start, Google asks once for permission, and the page comes
 * back here with the link (`driveResult`). There is no PowerPoint download:
 * the deck only ever goes to the person's own Drive.
 *
 * `weeks` and `stores` come from the server so the render and the browser
 * agree on which Sunday was last and which stores are on PAR.
 */

export type DriveResult =
  | { status: "saved"; url: string; name: string; warnings: string[] }
  | { status: "error"; message: string };

export default function StoreDeckPanel({
  weeks,
  stores,
  driveResult,
  initialStore,
  initialWeekEnd,
}: {
  weeks: WbrWeekOption[];
  stores: { label: string; section: string }[];
  /** What the last Drive save came back with, if the page was just returned to. */
  driveResult: DriveResult | null;
  initialStore?: string;
  initialWeekEnd?: string;
}) {
  const [store, setStore] = useState(stores.some((s) => s.label === initialStore) ? initialStore! : (stores[0]?.label ?? ""));
  const [weekEnd, setWeekEnd] = useState(weeks.some((w) => w.weekEnd === initialWeekEnd) ? initialWeekEnd! : (weeks[0]?.weekEnd ?? ""));
  const [busy, setBusy] = useState(false);
  // The Drive result stays up until the selection changes.
  const [drive, setDrive] = useState<DriveResult | null>(driveResult);

  const sections = [...new Set(stores.map((s) => s.section))];

  const reset = () => setDrive(null);

  const saveToDrive = () => {
    setBusy(true);
    reset();
    // A full navigation: Google's permission page, then the build, then back here.
    window.location.href = `/api/wbr/drive/start?${new URLSearchParams({ store, weekEnd })}`;
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
        <select
          value={store}
          onChange={(e) => {
            setStore(e.target.value);
            reset();
          }}
          disabled={busy}
          aria-label="Store"
          className={select}
        >
          {sections.map((sec) => (
            <optgroup key={sec} label={sec}>
              {stores
                .filter((s) => s.section === sec)
                .map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
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
        <button onClick={saveToDrive} disabled={busy || !store} className={primary}>
          {busy ? "Saving to Drive…" : "Save to Google Drive"}
        </button>
      </div>

      {busy && <p className="mt-3 text-xs text-gray-500">This takes up to a minute.</p>}

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
