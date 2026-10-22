"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { WbrWeekOption } from "@/lib/wbr/weeks";

/**
 * The Weekly Business Review button, at the top of the Admin tab for admins.
 *
 * Two states: no Google account connected yet (offer to connect — the deck is
 * written as that person, in their Drive), or connected (offer to generate).
 * The outcome of a connect round trip arrives in the query string, which is
 * read once and then cleared so a reload doesn't repeat the message.
 */

type Result = { url: string; title: string; sourceTitle: string; week: { start: string; end: string }; warnings: string[] };
type Mode = "new" | "replace" | "copy";

/**
 * `weeks` comes from the server (Central time, newest first) rather than being
 * worked out here, so the server render and the browser can't disagree about
 * which Sunday was last when the page loads near midnight.
 */
export default function WbrPanel({ connectedAs, weeks }: { connectedAs: string | null; weeks: WbrWeekOption[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const [weekEnd, setWeekEnd] = useState(weeks[0]?.weekEnd ?? "");
  const [style, setStyle] = useState<"classic" | "district">("classic");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ name: string; url: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const ok = search.get("google");
    const bad = search.get("google_error");
    if (!ok && !bad) return;
    if (ok) setNotice(`Connected as ${ok}.`);
    if (bad) setError(bad);
    router.replace("/admin-links");
  }, [search, router]);

  const generate = async (mode: Mode = "new") => {
    setBusy(true);
    setError(null);
    setExisting(null);
    setResult(null);
    try {
      const res = await fetch("/api/wbr/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, weekEnd, style }),
      });
      const body = await res.json();
      if (res.status === 409 && body.existing) setExisting(body.existing);
      else if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
      else setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await fetch("/api/wbr/connection", { method: "DELETE" });
    router.refresh();
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Weekly Business Review</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Copies the previous deck and rebuilds the sales and productivity slides from PAR for the chosen week.
          </p>
        </div>
        {connectedAs ? (
          <>
            <span className="text-xs text-gray-500">
              As {connectedAs} ·{" "}
              <button onClick={disconnect} className="underline hover:text-gray-700">
                disconnect
              </button>
            </span>
            <select
              value={weekEnd}
              onChange={(e) => {
                setWeekEnd(e.target.value);
                setExisting(null);
                setResult(null);
                setError(null);
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
                setExisting(null);
                setResult(null);
              }}
              disabled={busy}
              aria-label="Layout"
              className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 cursor-pointer"
            >
              <option value="classic">Classic layout</option>
              <option value="district">By district (new)</option>
            </select>
            <button
              onClick={() => generate()}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition"
            >
              {busy ? "Building deck…" : "Generate deck"}
            </button>
          </>
        ) : (
          <a
            href="/api/auth/google-slides/start"
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-gray-900 text-white hover:bg-gray-700 transition"
          >
            Connect Google
          </a>
        )}
      </div>

      {notice && <p className="mt-3 text-xs text-green-700">{notice}</p>}
      {busy && <p className="mt-3 text-xs text-gray-500">This takes about a minute.</p>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {existing && (
        <div className="mt-3 text-xs text-gray-700 flex flex-wrap items-center gap-2">
          <span>
            <a href={existing.url} target="_blank" rel="noreferrer" className="font-medium underline">
              {existing.name}
            </a>{" "}
            already exists.
          </span>
          <button
            onClick={() => generate("copy")}
            className="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 transition"
          >
            Make a copy
          </button>
          <button
            onClick={() => generate("replace")}
            className="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 transition"
          >
            Replace it
          </button>
          <span className="text-gray-400">Both keep its hand-filled slides and rebuild only sales and productivity.</span>
        </div>
      )}

      {result && (
        <div className="mt-3 text-xs text-gray-700 space-y-1">
          <p>
            <a href={result.url} target="_blank" rel="noreferrer" className="font-medium text-gray-900 underline">
              {result.title}
            </a>{" "}
            — built from {result.sourceTitle}, data for {result.week.start} to {result.week.end}.
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
