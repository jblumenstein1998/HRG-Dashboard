"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import type { Tab } from "@/lib/users/tabs";
import {
  ADMIN_LINK_COUNT,
  ADMIN_LINK_GROUPS,
  faviconDomain,
  linkHost,
  matchesQuery,
  type AdminLink,
} from "@/lib/adminLinks";

/**
 * The Admin tab: every back-office system, grouped, with a filter.
 *
 * The header is the same shape as the other tabs' (logo, tab picker, log out)
 * rather than shared with them — see TabOptions for why only the `<option>`
 * list is lifted.
 *
 * Everything renders from the static catalog with no fetch, so the page is
 * useful the instant it paints. The filter is client state over that same
 * array: at ~50 entries there is nothing to gain from indexing it, and a
 * round trip per keystroke would make finding a link slower than scrolling.
 */
export default function AdminLinksClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  // Groups that still have a match, with their non-matching links dropped. An
  // emptied group disappears entirely rather than showing a bare heading.
  const groups = useMemo(() => {
    const q = query.trim();
    if (!q) return ADMIN_LINK_GROUPS;
    return ADMIN_LINK_GROUPS.map((g) => ({
      ...g,
      links: g.links.filter((l) => matchesQuery(l, q)),
    })).filter((g) => g.links.length > 0);
  }, [query]);

  const shown = groups.reduce((n, g) => n + g.links.length, 0);

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
              {query.trim() ? `${shown} of ${ADMIN_LINK_COUNT}` : `${ADMIN_LINK_COUNT} systems`}
            </span>
            {query.trim() && (
              <button
                onClick={() => setQuery("")}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {groups.length === 0 ? (
          <p className="text-sm text-gray-500 py-12 text-center">
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.title}>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  {group.title}
                </h2>
                <p className="text-xs text-gray-500">{group.blurb}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.links.map((link) => (
                  <LinkCard key={link.label} link={link} />
                ))}
              </div>
            </section>
          ))
        )}

        <p className="text-xs text-gray-400 pt-2">
          Logins aren&apos;t stored here — use your own credentials or the shared password manager.
        </p>
      </main>
    </div>
  );
}

/**
 * One system.
 *
 * `target="_blank"` on purpose: these are sessions people keep open all day,
 * and replacing the dashboard with a vendor portal would cost them whatever
 * they had loaded on another tab. `rel="noopener noreferrer"` goes with it, so
 * the opened page gets neither a handle back on this window nor the referrer.
 */
function LinkCard({ link }: { link: AdminLink }) {
  const host = linkHost(link.url);

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:border-gray-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-gray-300"
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
        <p className="mt-0.5 text-xs leading-snug text-gray-500">{link.note}</p>
        <p className="mt-1 text-[11px] text-gray-400 truncate">{host}</p>
      </div>
    </a>
  );
}

/**
 * The vendor's own favicon, which is how people recognise these portals — far
 * faster to scan than fifty identical tiles.
 *
 * Fetched from Google's favicon service rather than committed to /public: at
 * this count that would be fifty binaries to keep in sync with rebrands, for a
 * page that is already only useful with a network. When it fails — a host with
 * no icon, or the service blocked — `onError` swaps in the label's initials so
 * the card still reads as itself instead of showing a broken-image glyph.
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
