"use client";

/**
 * Drop in the period P&L — every store at once — and see what was read.
 *
 * Two steps on purpose: dropping a file only previews it (which column became
 * which store, and what Labor %, Controllable Income and EBITDA came to), and
 * nothing counts until Save. A P&L for the wrong period, or a quarter, is
 * caught at the preview and can't be saved — see /api/bonus/pnl.
 *
 * Admin-only, like the route behind it.
 */

import { useEffect, useRef, useState } from "react";
import { BONUS_STORES, storeById } from "@/lib/bonus/storeMap";

type Figures = { storeId: string; laborPct: number | null; controllableIncome: number | null; ebitda: number | null };
type PreviewStore = Figures & { header: string; lines: { totalSales: number | null } };
type Stored = Figures & { totalSales: number | null; sourceFile: string | null; uploadedBy: string | null; uploadedAt: string };
type Preview = {
  fileName: string;
  parsed: {
    title: string[];
    periodFromFile: string | null;
    stores: PreviewStore[];
    skippedColumns: string[];
    missingLines: string[];
  };
  blockers: string[];
};

const money = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

export default function BonusPnlCard({ period, onSaved }: { period: string; onSaved: () => void }) {
  const [stored, setStored] = useState<{ period: string; rows: Stored[] }>({ period: "", rows: [] });
  const [preview, setPreview] = useState<{ period: string; data: Preview; file: File } | null>(null);
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/pnl?period=${encodeURIComponent(period)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        if (!cancelled) setStored({ period, rows: json.financials });
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [period]);

  // A preview belongs to the period it was read for; switching period drops it.
  const shownPreview = preview?.period === period ? preview : null;

  async function send(file: File, mode: "preview" | "save") {
    setBusy(mode === "preview" ? "reading" : "saving");
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("period", period);
      body.set("mode", mode);
      const res = await fetch("/api/bonus/pnl", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (mode === "save" && json.saved) {
        setStored({ period, rows: json.financials });
        setPreview(null);
        onSaved();
      } else {
        setPreview({ period, data: json as Preview, file });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) void send(file, "preview");
  }

  const storedById = new Map((stored.period === period ? stored.rows : []).map((r) => [r.storeId, r]));
  const lastUpload = [...storedById.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">P&amp;L</span>
        <span className="text-[11px] text-gray-400">
          Labor %, Controllable Income and EBITDA for {period}
          {lastUpload && !shownPreview && ` · from ${lastUpload.sourceFile ?? "an upload"}, ${new Date(lastUpload.uploadedAt).toLocaleDateString()}`}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        {!shownPreview && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files); }}
            className={`rounded-lg border-2 border-dashed px-4 py-5 text-center cursor-pointer transition ${
              dragging ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <p className="text-sm text-gray-700">
              {busy === "reading" ? "Reading…" : <>Drop the {period} P&amp;L here, or <span className="underline underline-offset-2">choose a file</span></>}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              The &ldquo;Profit &amp; Loss – Location Side by Side&rdquo; export, as .xlsx. Stores are matched by the store number in each column header.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => { pick(e.target.files); e.target.value = ""; }}
            />
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        {shownPreview ? (
          <PreviewPanel
            preview={shownPreview.data}
            period={period}
            saving={busy === "saving"}
            onSave={() => void send(shownPreview.file, "save")}
            onCancel={() => setPreview(null)}
          />
        ) : (
          <FiguresTable
            rows={BONUS_STORES.map((s) => ({ storeId: s.storeId, label: s.name, figures: storedById.get(s.storeId) ?? null }))}
          />
        )}
      </div>
    </section>
  );
}

function PreviewPanel({
  preview, period, saving, onSave, onCancel,
}: {
  preview: Preview;
  period: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { parsed, blockers } = preview;
  const missingStores = BONUS_STORES.filter((s) => !parsed.stores.some((p) => p.storeId === s.storeId));
  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-600">
        <span className="font-medium text-gray-800">{preview.fileName}</span>
        {parsed.title.length > 0 && <span className="text-gray-400"> · {parsed.title.join(" · ")}</span>}
      </div>

      {blockers.length > 0 && (
        <ul className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 space-y-0.5">
          {blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}
      {parsed.missingLines.length > 0 && (
        <p className="text-xs text-amber-700">
          Not found on the sheet: {parsed.missingLines.join(", ")} — figures that need them are left blank.
        </p>
      )}

      <FiguresTable
        rows={parsed.stores.map((s) => ({
          storeId: s.storeId,
          label: storeById(s.storeId)?.name ?? s.storeId,
          sub: s.header,
          figures: { ...s, totalSales: s.lines.totalSales },
        }))}
      />

      {(missingStores.length > 0 || parsed.skippedColumns.length > 0) && (
        <p className="text-[11px] text-gray-500">
          {missingStores.length > 0 && <>Not in this file: {missingStores.map((s) => s.name).join(", ")}. </>}
          {parsed.skippedColumns.length > 0 && <>Columns skipped (no store number we know): {parsed.skippedColumns.join(", ")}.</>}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving || blockers.length > 0}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition disabled:opacity-50"
        >
          {saving ? "Saving…" : `Save to ${period}`}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FiguresTable({
  rows,
}: {
  rows: { storeId: string; label: string; sub?: string; figures: (Figures & { totalSales: number | null }) | null }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-gray-400 border-b border-gray-100">
            <th className="text-left font-normal py-1 pr-3">Store</th>
            <th className="text-right font-normal py-1 px-2">Sales</th>
            <th className="text-right font-normal py-1 px-2">Labor %</th>
            <th className="text-right font-normal py-1 px-2">Controllable Income</th>
            <th className="text-right font-normal py-1 pl-2">EBITDA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.storeId} className="border-b border-gray-50">
              <td className="py-1 pr-3 text-gray-800">
                {r.label}
                {r.sub && <span className="ml-1.5 text-[10px] text-gray-400">{r.sub}</span>}
              </td>
              <td className="py-1 px-2 text-right text-gray-600">{money(r.figures?.totalSales ?? null)}</td>
              <td className="py-1 px-2 text-right text-gray-800">{pct(r.figures?.laborPct ?? null)}</td>
              <td className="py-1 px-2 text-right text-gray-800">{money(r.figures?.controllableIncome ?? null)}</td>
              <td className={`py-1 pl-2 text-right ${(r.figures?.ebitda ?? 0) < 0 ? "text-red-600" : "text-gray-800"}`}>
                {money(r.figures?.ebitda ?? null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
