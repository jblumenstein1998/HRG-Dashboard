"use client";

import { useState } from "react";
import type { WbrWeekOption } from "@/lib/wbr/weeks";

/**
 * The store presentation: pick a store and a week, get that store's overview,
 * sales, labor, drive-thru, food cost, SMG and compliance slides. Or pick an
 * above-store leader (the ribbon's list) for one deck of all their stores,
 * ordered slide by slide (lib/wbr/generateStore). Sits on the Management tab,
 * shown only to people signed in with Google.
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

/** An above-store leader from the ribbon's list, with how many of their stores a deck covers. */
export type DeckLeader = { id: string; name: string; stores: number };

export default function StoreDeckPanel({
  weeks,
  stores,
  leaders,
  driveResult,
  initialStore,
  initialLeader,
  initialWeekEnd,
}: {
  weeks: WbrWeekOption[];
  stores: { label: string; section: string }[];
  leaders: DeckLeader[];
  /** What the last Drive save came back with, if the page was just returned to. */
  driveResult: DriveResult | null;
  initialStore?: string;
  initialLeader?: string;
  initialWeekEnd?: string;
}) {
  // "leader:<id>" or "store:<label>", like the ribbon's store filter.
  const [target, setTarget] = useState(() => {
    if (leaders.some((l) => l.id === initialLeader)) return `leader:${initialLeader}`;
    if (stores.some((s) => s.label === initialStore)) return `store:${initialStore}`;
    return stores[0] ? `store:${stores[0].label}` : "";
  });
  const [weekEnd, setWeekEnd] = useState(weeks.some((w) => w.weekEnd === initialWeekEnd) ? initialWeekEnd! : (weeks[0]?.weekEnd ?? ""));
  const [busy, setBusy] = useState(false);
  // The Drive result stays up until the selection changes.
  const [drive, setDrive] = useState<DriveResult | null>(driveResult);

  const sections = [...new Set(stores.map((s) => s.section))];
  const leader = target.startsWith("leader:") ? leaders.find((l) => l.id === target.slice("leader:".length)) : undefined;

  const reset = () => setDrive(null);

  const saveToDrive = () => {
    setBusy(true);
    reset();
    const pick: Record<string, string> = leader ? { leader: leader.id } : { store: target.slice("store:".length) };
    // A full navigation: Google's permission page, then the build, then back here.
    window.location.href = `/api/wbr/drive/start?${new URLSearchParams({ ...pick, weekEnd })}`;
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
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            reset();
          }}
          disabled={busy}
          aria-label="Store or leader"
          className={select}
        >
          {leaders.length > 0 && (
            <optgroup label="Above-store leader">
              {leaders.map((l) => (
                <option key={l.id} value={`leader:${l.id}`}>
                  {l.name} ({l.stores} {l.stores === 1 ? "store" : "stores"})
                </option>
              ))}
            </optgroup>
          )}
          {sections.map((sec) => (
            <optgroup key={sec} label={sec}>
              {stores
                .filter((s) => s.section === sec)
                .map((s) => (
                  <option key={s.label} value={`store:${s.label}`}>
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
        <button onClick={saveToDrive} disabled={busy || !target} className={primary}>
          {busy ? "Saving to Drive…" : "Save to Google Drive"}
        </button>
      </div>

      {leader && !busy && (
        <p className="mt-3 text-xs text-gray-500">
          One deck for all {leader.stores} of {leader.name}&apos;s stores, with the same slide for every store side by side:
          each store&apos;s overview, then each store&apos;s sales, and so on.
        </p>
      )}
      {busy && <p className="mt-3 text-xs text-gray-500">{leader ? "This can take a few minutes." : "This takes up to a minute."}</p>}

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
