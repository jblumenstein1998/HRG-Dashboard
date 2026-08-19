"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import type { Tab } from "@/lib/users/tabs";
import {
  faviconDomain,
  isSafeUrl,
  linkHost,
  matchesQuery,
  type AdminLink,
  type AdminLinkGroup,
} from "@/lib/adminLinks";

/**
 * The Admin tab: every back-office system, grouped, with a filter — and, for
 * admins, the controls to add and remove cards.
 *
 * The header is the same shape as the other tabs' (logo, tab picker, log out)
 * rather than shared with them — see TabOptions for why only the `<option>`
 * list is lifted.
 *
 * `groups` arrives from the server component already grouped and ordered, so
 * this file never decides what the directory contains — only how it looks and
 * which of it the filter is currently showing. After a write it calls
 * `router.refresh()` and lets the same server read produce the new list, which
 * is why there is no client-side copy of the directory to keep in step.
 *
 * The filter is client state over the props: at ~50 entries there is nothing to
 * gain from indexing, and a round trip per keystroke would make finding a link
 * slower than scrolling.
 */
export default function AdminLinksClient({
  tabs,
  isAdmin,
  groups,
  groupTitles,
}: {
  tabs: Tab[];
  isAdmin: boolean;
  groups: AdminLinkGroup[];
  groupTitles: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const total = useMemo(() => groups.reduce((n, g) => n + g.links.length, 0), [groups]);

  // Groups that still have a match, with their non-matching links dropped. An
  // emptied group disappears entirely rather than showing a bare heading.
  const shownGroups = useMemo(() => {
    const q = query.trim();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, links: g.links.filter((l) => matchesQuery(l, q)) }))
      .filter((g) => g.links.length > 0);
  }, [groups, query]);

  const shown = shownGroups.reduce((n, g) => n + g.links.length, 0);

  const refresh = () => startTransition(() => router.refresh());

  return (
    <div className="min-h-screen bg-gray-50">
      {/* banner: nav + filter, locked to the top together */}
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 shrink-0">
              <img src="/hrglogo.png" alt="HRG" className="h-8 w-auto" />
              <div className="relative w-fit">
                <select
                  value="/admin-links"
                  onChange={(e) => router.push(e.target.value)}
                  aria-label="Switch tab"
                  className="text-base font-semibold text-gray-900 bg-transparent border-0 p-0 m-0 pr-5 appearance-none cursor-pointer focus:outline-none focus:ring-0"
                >
                  <TabOptions tabs={tabs} isAdmin={isAdmin} />
                </select>
                <svg
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/login");
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
              >
                Log out
              </button>
            </div>
          </div>
        </header>

        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative flex-1 min-w-[14rem] max-w-md">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search systems — payroll, food cost, insurance…"
                aria-label="Filter systems"
                className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
              />
            </div>
            <span className="text-xs text-gray-500 tabular-nums">
              {query.trim() ? `${shown} of ${total}` : `${total} systems`}
            </span>
            {query.trim() && (
              <button
                onClick={() => setQuery("")}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
              >
                Clear
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setAdding((v) => !v)}
                aria-expanded={adding}
                className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-gray-900 text-white hover:bg-gray-700 transition"
              >
                {adding ? "Cancel" : "Add link"}
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {isAdmin && adding && (
          <AddLinkForm
            groupTitles={groupTitles}
            onDone={() => {
              setAdding(false);
              refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {shownGroups.length === 0 ? (
          <p className="text-sm text-gray-500 py-12 text-center">
            {total === 0
              ? "No systems yet."
              : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : (
          shownGroups.map((group) => (
            <section key={group.title}>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  {group.title}
                </h2>
                {group.blurb && <p className="text-xs text-gray-500">{group.blurb}</p>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.links.map((link) => (
                  <LinkCard key={link.id} link={link} canEdit={isAdmin} onRemoved={refresh} />
                ))}
              </div>
            </section>
          ))
        )}

        <p className="text-xs text-gray-400 pt-2">
          Logins aren&apos;t stored here — use your own credentials or the shared password manager.
          {pending && <span className="ml-2 text-gray-400">Updating…</span>}
        </p>
      </main>
    </div>
  );
}

/**
 * The add-a-card form.
 *
 * Group is a free-text input backed by a `<datalist>` of the groups already in
 * use, rather than a `<select>`. A select would make inventing a group
 * impossible and a text box alone would make typos silently create near-
 * duplicate headings; the datalist is the one control that offers the existing
 * answers without refusing a new one.
 *
 * Validation shown here is a courtesy — the button greys out on an unusable
 * URL so nobody fills in four fields to be told no. The server validates
 * independently, and its answer is what gets rendered on failure.
 */
function AddLinkForm({
  groupTitles,
  onDone,
  onCancel,
}: {
  groupTitles: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [groupTitle, setGroupTitle] = useState(groupTitles[0] ?? "");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = groupTitle.trim() !== "" && label.trim() !== "" && isSafeUrl(url);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupTitle, label, url, note, search }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't add that card.");
      return;
    }
    onDone();
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Add a link</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Group">
          <input
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
            list="admin-link-groups"
            placeholder="Pick one or type a new name"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
          <datalist id="admin-link-groups">
            {groupTitles.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Name">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What people call it"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </Field>
        <Field label="Address">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </Field>
        <Field label="Description" hint="One line, shown under the name.">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What it's for"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </Field>
        <Field label="Also search for" hint="Other names people might type.">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="vendor name, nickname, what it does"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!ready || busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
        >
          {busy ? "Adding…" : "Add link"}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
        >
          Cancel
        </button>
        {!ready && url.trim() !== "" && !isSafeUrl(url) && (
          <span className="text-xs text-gray-400">Needs a full http:// or https:// address.</span>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-gray-400">{hint}</span>}
    </label>
  );
}

/**
 * One system.
 *
 * `target="_blank"` on purpose: these are sessions people keep open all day,
 * and replacing the dashboard with a vendor portal would cost them whatever
 * they had loaded on another tab. `rel="noopener noreferrer"` goes with it, so
 * the opened page gets neither a handle back on this window nor the referrer.
 *
 * The remove control is a sibling of the anchor rather than a child: a button
 * inside an `<a>` is invalid HTML, and browsers resolve it by firing the
 * navigation too — which would open the vendor's site every time someone tried
 * to delete the card.
 *
 * Removal confirms in place instead of through `confirm()`. A native dialog
 * blocks the page, and this is a destructive action a mis-aimed click can
 * reach, so it's worth the second click.
 */
function LinkCard({
  link,
  canEdit,
  onRemoved,
}: {
  link: AdminLink;
  canEdit: boolean;
  onRemoved: () => void;
}) {
  const host = linkHost(link.url);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin-links?id=${encodeURIComponent(link.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Couldn't remove that card.");
      setBusy(false);
      setConfirming(false);
      return;
    }
    // Left busy on purpose: the card stays disabled until the refresh replaces
    // it, rather than flicking back to normal for the frame before it vanishes.
    onRemoved();
  }

  return (
    <div className="group relative">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:border-gray-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        <Favicon domain={faviconDomain(link.url)} label={link.label} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-gray-900 truncate">{link.label}</span>
            <svg
              className="w-3 h-3 text-gray-300 shrink-0 transition group-hover:text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-8 8M17 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h4" />
            </svg>
          </div>
          {link.note && <p className="mt-0.5 text-xs leading-snug text-gray-500">{link.note}</p>}
          <p className="mt-1 text-[11px] text-gray-400 truncate">{host}</p>
        </div>
      </a>

      {canEdit && !confirming && (
        <button
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${link.label}`}
          title={`Remove ${link.label}`}
          className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-200 group-hover:opacity-100"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {canEdit && confirming && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-white/95 px-3 text-center">
          <p className="text-xs text-gray-700">
            {error ?? (
              <>
                Remove <span className="font-semibold">{link.label}</span>?
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={remove}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 transition"
            >
              {busy ? "Removing…" : "Remove"}
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The vendor's own favicon, which is how people recognise these portals — far
 * faster to scan than fifty identical tiles.
 *
 * Fetched from Google's favicon service rather than committed to /public: at
 * this count that would be fifty binaries to keep in sync with rebrands, for a
 * page that is already only useful with a network. When it fails — a domain
 * with no icon, or the service blocked — `onError` swaps in the label's
 * initials so the card still reads as itself instead of showing a broken-image
 * glyph.
 */
function Favicon({ domain, label }: { domain: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const initials = label
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  if (!domain || failed) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[11px] font-semibold text-gray-500">
        {initials || "?"}
      </span>
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-8 w-8 shrink-0 rounded-md bg-gray-50 object-contain p-1"
    />
  );
}
