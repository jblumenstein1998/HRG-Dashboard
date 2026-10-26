"use client";

import { useState } from "react";
import type { WbrWeekOption } from "@/lib/wbr/weeks";

/**
 * The Weekly Business Review button, at the top of the Admin tab.
 *
 * Builds the deck from the WBR template and downloads it as PowerPoint. From
 * there it's upload to Drive (which opens it as Google Slides) and share — the
 * dashboard never touches anyone's Drive, so anyone with the tab can use it.
 */

type Result = { fileName: string; warnings: string[] };

/**
 * `weeks` comes from the server (Central time, newest first) rather than being
 * worked out here, so the server render and the browser can't disagree about
 * which Sunday was last when the page loads near midnight.
 */
export default function WbrPanel({ weeks }: { weeks: WbrWeekOption[] }) {
  const [weekEnd, setWeekEnd] = useState(weeks[0]?.weekEnd ?? "");
  const [style, setStyle] = useState<"classic" | "district">("classic");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/wbr/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekEnd, style }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      const fileName =
        decodeURIComponent(res.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "") ||
        "Weekly Business Review.pptx";
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

  const reset = () => {
    setResult(null);
    setError(null);
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Weekly Business Review</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Downloads the deck as PowerPoint, with the sales and productivity slides built from PAR for the chosen week.
          </p>
        </div>
        <select
          value={weekEnd}
          onChange={(e) => {
            setWeekEnd(e.target.value);
            reset();
          }}
          disabled={busy}
          aria-label="Week"
          className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 cursor-pointer"
        >
          {weeks.map((w) => (
            <option key={w.weekEnd} value={w.weekEnd}>
              {w.label}
            </option>
          ))}
        </select>
        <select
          value={style}
          onChange={(e) => {
            setStyle(e.target.value as "classic" | "district");
            reset();
          }}
          disabled={busy}
          aria-label="Layout"
          className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 cursor-pointer"
        >
          <option value="classic">Classic layout</option>
          <option value="district">By district (new)</option>
        </select>
        <button
          onClick={generate}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition"
        >
          {busy ? "Building deck…" : "Download deck"}
        </button>
      </div>

      {busy && <p className="mt-3 text-xs text-gray-500">This takes about a minute.</p>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {result && (
        <div className="mt-3 text-xs text-gray-700 space-y-1">
          <p>
            Downloaded <span className="font-medium text-gray-900">{result.fileName}</span>. Upload it to the WBR folder in
            Google Drive — it opens as Google Slides — and share from there.
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
