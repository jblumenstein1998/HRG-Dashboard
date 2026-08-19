"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import type { Tab } from "@/lib/users/tabs";
import {
  iconUrl,
  isSafeUrl,
  linkHost,
  matchesQuery,
  type AdminLink,
  type AdminLinkGroup,
} from "@/lib/adminLinks";

/**
 * The Admin tab: every back-office system, grouped, with a filter — and, for
 * admins, the controls to add, edit and remove cards.
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
 * Cards deliberately carry no prose: a mark, a name, the host, nothing else.
 * The descriptions that used to sit under each name and the subtitle under
 * each group heading were what you had to read past to find what you came for.
 * With the words gone the logo does most of the recognising, which is why
 * Favicon works as hard as it does to find a real one.
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
  // The card and the group it currently sits in. The group travels alongside
  // rather than on the link, because the server nests links inside groups
  // instead of repeating the title on all fifty-one rows — so the only place
  // that knows a card's group is the section rendering it.
  const [editing, setEditing] = useState<{ link: AdminLink; groupTitle: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLDivElement>(null);

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

  const closeForm = () => {
    setAdding(false);
    setEditing(null);
  };

  /**
   * Editing opens the same panel adding uses, at the top of the list. The
   * alternative — an editor inside the card — has to fit five fields into a
   * quarter-width tile, and the group field is the one that most needs room
   * since recategorising is the reason the button exists at all. The scroll is
   * what makes that bearable: the panel is above the fold and the card you
   * clicked may not be, so jumping to the form keeps the two connected.
   */
  const openEdit = (link: AdminLink, groupTitle: string) => {
    setAdding(false);
    setEditing({ link, groupTitle });
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };

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
              {/* The placeholder names examples that still work. It used to
                  read "payroll, food cost, insurance", which was true while
                  cards carried hidden aliases and became a lie when they
                  stopped: "food cost" now matches nothing, and a placeholder
                  suggesting a search that returns nothing reads as a broken
                  filter rather than an empty result. */}
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name — ADP, Olo, Steritech…"
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
                onClick={() => {
                  setEditing(null);
                  setAdding((v) => !v);
                }}
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
        <div ref={formRef}>
          {isAdmin && (adding || editing) && (
            <LinkForm
              // Remounts when the target changes, so switching straight from
              // one card's editor to another's refills the fields instead of
              // leaving the first card's values in place.
              key={editing?.link.id ?? "new"}
              link={editing?.link ?? null}
              initialGroup={editing?.groupTitle ?? groupTitles[0] ?? ""}
              groupTitles={groupTitles}
              onDone={() => {
                closeForm();
                refresh();
              }}
              onCancel={closeForm}
            />
          )}
        </div>

        {shownGroups.length === 0 ? (
          <p className="text-sm text-gray-500 py-12 text-center">
            {total === 0 ? "No systems yet." : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : (
          shownGroups.map((group) => (
            <section key={group.title}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-900">
                {group.title}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.links.map((link) => (
                  <LinkCard
                    key={link.id}
                    link={link}
                    canEdit={isAdmin}
                    isEditing={editing?.link.id === link.id}
                    onEdit={() => openEdit(link, group.title)}
                  />
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
 * The add / edit panel. One component for both, because the fields and the
 * validation are identical and the only real difference is which verb the
 * button uses and whether Remove is offered.
 *
 * Group is a `<select>` of the groups in use plus one "New group…" entry.
 *
 * It was an `<input list=…>` over a `<datalist>`, which reads well and is
 * wrong: browsers treat a datalist as autocomplete, so they filter the
 * suggestions against whatever the input already contains. That is invisible
 * while adding — the box is empty, so every option shows — and useless while
 * editing, where the box is prefilled with the card's current group and the
 * only suggestion offered is therefore the group it is already in. Which is
 * precisely the list you don't need: recategorising means choosing one of the
 * others, and none of the others were reachable.
 *
 * A select always shows every option, at the cost of not accepting a name that
 * isn't in it — hence the explicit "New group…" entry, which swaps in a text
 * box. Inventing a group is now a deliberate act rather than a side effect of
 * mistyping an existing one, which is the better default anyway.
 *
 * The validation shown is a courtesy — the button greys out on an unusable URL
 * so nobody fills in four fields to be told no. The server validates
 * independently, and its answer is what gets rendered on failure.
 */
function LinkForm({
  link,
  initialGroup,
  groupTitles,
  onDone,
  onCancel,
}: {
  link: AdminLink | null;
  initialGroup: string;
  groupTitles: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = link !== null;

  // A card always starts in a group that exists, so "pick" is the normal case;
  // "new" is only reachable by choosing it. The initial split still handles an
  // initialGroup that isn't in the list, which is what a card whose group was
  // emptied by a concurrent edit would look like.
  const known = groupTitles.includes(initialGroup);
  const [choosingNew, setChoosingNew] = useState(initialGroup !== "" && !known);
  const [picked, setPicked] = useState(known ? initialGroup : groupTitles[0] ?? "");
  const [newGroup, setNewGroup] = useState(known ? "" : initialGroup);
  const groupTitle = choosingNew ? newGroup : picked;

  const [label, setLabel] = useState(link?.label ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = groupTitle.trim() !== "" && label.trim() !== "" && isSafeUrl(url);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin-links", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: link?.id, groupTitle, label, url }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Couldn't save that card.");
      setBusy(false);
      return;
    }
    onDone();
  }

  async function remove() {
    if (!link) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin-links?id=${encodeURIComponent(link.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Couldn't remove that card.");
      setBusy(false);
      setConfirmingRemove(false);
      return;
    }
    onDone();
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">
        {editing ? `Edit ${link.label}` : "Add a link"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Group" hint="Pick where it belongs, or start a new group.">
          <select
            value={choosingNew ? NEW_GROUP : picked}
            onChange={(e) => {
              const v = e.target.value;
              if (v === NEW_GROUP) {
                setChoosingNew(true);
              } else {
                setChoosingNew(false);
                setPicked(v);
              }
            }}
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
          >
            {groupTitles.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={NEW_GROUP}>New group…</option>
          </select>
          {choosingNew && (
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              autoFocus
              placeholder="Name the new group"
              className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          )}
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
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={!ready || busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Add link"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
        >
          Cancel
        </button>
        {!ready && url.trim() !== "" && !isSafeUrl(url) && (
          <span className="text-xs text-gray-400">Needs a full http:// or https:// address.</span>
        )}

        {/* Removal lives at the far end of the row, behind a second click.
            It is the one action here that can't be undone, and the row is
            otherwise all safe verbs. */}
        {editing && (
          <span className="ml-auto flex items-center gap-2">
            {confirmingRemove ? (
              <>
                <span className="text-xs text-gray-600">Remove this card?</span>
                <button
                  onClick={remove}
                  disabled={busy}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 transition"
                >
                  {busy ? "Removing…" : "Remove"}
                </button>
                <button
                  onClick={() => setConfirmingRemove(false)}
                  disabled={busy}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmingRemove(true)}
                disabled={busy}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition"
              >
                Remove
              </button>
            )}
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * The select's stand-in for "not one of these".
 *
 * The empty string, because the store rejects an empty group name outright —
 * so this is the one value that provably cannot also be a real title. A
 * plausible-looking sentinel ("__new__", "new-group") only looks safe until
 * someone names a group that.
 */
const NEW_GROUP = "";

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
 * One system: its mark, its name, the host it points at.
 *
 * `target="_blank"` on purpose: these are sessions people keep open all day,
 * and replacing the dashboard with a vendor portal would cost them whatever
 * they had loaded on another tab. `rel="noopener noreferrer"` goes with it, so
 * the opened page gets neither a handle back on this window nor the referrer.
 *
 * The edit control is a sibling of the anchor rather than a child: a button
 * inside an `<a>` is invalid HTML, and browsers resolve it by firing the
 * navigation too — which would open the vendor's site every time someone tried
 * to edit the card.
 */
function LinkCard({
  link,
  canEdit,
  isEditing,
  onEdit,
}: {
  link: AdminLink;
  canEdit: boolean;
  isEditing: boolean;
  onEdit: () => void;
}) {
  const host = linkHost(link.url);

  return (
    <div className="group relative">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-3 rounded-lg border bg-white p-3 shadow-sm transition hover:shadow focus:outline-none focus:ring-2 focus:ring-gray-300 ${
          isEditing ? "border-gray-900" : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <Favicon src={iconUrl(link.url)} label={link.label} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900">{link.label}</span>
            <svg
              className="h-3 w-3 shrink-0 text-gray-300 transition group-hover:text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-8 8M17 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h4" />
            </svg>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-gray-400">{host}</p>
        </div>
      </a>

      {canEdit && (
        <button
          onClick={onEdit}
          aria-label={`Edit ${link.label}`}
          title={`Edit ${link.label}`}
          className={`absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-gray-300 transition hover:bg-gray-100 hover:text-gray-700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-300 group-hover:opacity-100 ${
            isEditing ? "opacity-100 text-gray-700" : "opacity-0"
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49a2.1 2.1 0 112.97 2.97L8.5 18.79l-4 1 1-4 11.36-11.3z" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * The vendor's own favicon, which is how people recognise these portals — far
 * faster to scan than fifty identical tiles, and the only thing distinguishing
 * one card from another now that the descriptions are gone.
 *
 * Fetched rather than committed to /public: at this count that would be fifty
 * binaries to keep in sync with rebrands, for a page that is already only
 * useful with a network.
 *
 * The src points at our own /api/icon, not at a favicon service directly. The
 * choice of service has to be made where the bytes can be inspected — both
 * public services answer an unknown domain with a placeholder image sent under
 * a 404, and browsers render a 404's body when it decodes, so nothing here
 * could tell a logo from an apology. See app/api/icon/route.ts.
 *
 * That leaves this component with one job: the route 404s with an empty body
 * when no service has a real icon, which does fire `error`, and the card falls
 * back to the label's initials — which reads as the card rather than as a
 * broken image.
 */
function Favicon({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const initials = label
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  if (failed) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[11px] font-semibold text-gray-500">
        {initials || "?"}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-8 w-8 shrink-0 rounded-md bg-gray-50 object-contain p-1"
    />
  );
}
