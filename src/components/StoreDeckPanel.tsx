"use client";

import { useState } from "react";
import type { WbrWeekOption } from "@/lib/wbr/weeks";

/**
 * The single-store deck download: pick a store and a week, get a PowerPoint of
 * that store's sales, labor, food cost and drive-thru. Sits on the Management
 * tab while it's being worked on.
 *
 * `weeks` and `stores` come from the server so the render and the browser
 * agree on which Sunday was last and which stores are on PAR.
 */
export default function StoreDeckPanel({
  weeks,
  stores,
}: {
  weeks: WbrWeekOption[];
  stores: { label: string; section: string }[];
}) {
  const [store, setStore] = useState(stores[0]?.label ?? "");
  const [weekEnd, setWeekEnd] = useState(weeks[0]?.weekEnd ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ fileName: string; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sections = [...new Set(stores.map((s) => s.section))];

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const download = async () => {
    setBusy(true);
    reset();
    try {
      const res = await fetch("/api/wbr/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, weekEnd }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      const fileName =
        decodeURIComponent(res.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "") ||
        `${store} Store Review.pptx`;
      const warnings = JSON.parse(decodeURIComponent(res.headers.get("X-Wbr-Warnings") ?? "%5B%5D")) as string[];
      // A fetch can't trigger a download by itself; hand the bytes to a link.
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setResult({ fileName, warnings });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const select = "text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 cursor-pointer";

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Store presentation</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Downloads a PowerPoint for one store and week: overview, sales, labor, food cost and drive-thru.
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
        <button
          onClick={download}
          disabled={busy || !store}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition"
        >
          {busy ? "Building…" : "Download presentation"}
        </button>
      </div>

      {busy && <p className="mt-3 text-xs text-gray-500">This takes up to half a minute.</p>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 text-xs text-gray-700 space-y-1">
          <p>
            Downloaded <span className="font-medium text-gray-900">{result.fileName}</span>. Open it in PowerPoint, or
            upload it to Google Drive to open it as Google Slides.
          </p>
          {result.warnings.length > 0 && (
            <ul className="list-disc pl-4 text-yellow-700">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
