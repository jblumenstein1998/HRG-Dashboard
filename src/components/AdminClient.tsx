"use client";

import { useState } from "react";
import TabPicker from "@/components/TabPicker";
import { TAB_LABELS, type Tab } from "@/lib/users/tabs";
import { ALL_STORES } from "@/lib/stores";
import { formatSyncStamp } from "@/lib/surveyMeta";

type User = {
  id: string;
  /** Null for a shared store account, which signs in by username. */
  email: string | null;
  username: string | null;
  name: string;
  positionId: string;
  disabledAt: string | null;
  lastLoginAt: string | null;
};

type Position = { id: string; label: string; tabs: Tab[]; isAdmin: boolean };

/**
 * An above-store leader and the stores they cover, by display label.
 *
 * Declared here rather than imported from lib/users/leaders, which pulls in
 * `sql` and would blow up in the browser — the same reason User and Position
 * are spelled out above instead of imported from lib/users/store.
 */
type Leader = { id: string; name: string; stores: string[] };

/**
 * Users and access.
 *
 * Adding someone grants an address permission to sign in with Google. No
 * password is issued, so there is nothing to hand over and nothing to reset.
 */
export default function AdminClient({
  initialUsers,
  initialPositions,
  initialLeaders,
  allTabs,
  viewerId,
  viewerTabs,
}: {
  initialUsers: User[];
  initialPositions: Position[];
  initialLeaders: Leader[];
  allTabs: Tab[];
  viewerId: string;
  viewerTabs: Tab[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [positions, setPositions] = useState(initialPositions);
  const [leaders, setLeaders] = useState(initialLeaders);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [usersRes, leadersRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/leaders"),
    ]);
    if (usersRes.ok) {
      const j = await usersRes.json();
      setUsers(j.users);
      setPositions(j.positions);
    }
    if (leadersRes.ok) {
      const j = await leadersRes.json();
      setLeaders(j.leaders);
    }
  }

  async function send(url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(j.error ?? "Something went wrong"));
        return null;
      }
      await refresh();
      return j;
    } catch {
      setError("Network error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <TabPicker tabs={viewerTabs} current="/admin" isAdmin />
            <form action="/api/auth/logout" method="post" className="ml-auto">
              <button
                formAction="/api/auth/logout"
                onClick={async (e) => {
                  e.preventDefault();
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
              >
                Log out
              </button>
            </form>
          </div>
        </header>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <AddUser
          positions={positions}
          busy={busy}
          onAdd={(form) =>
            send("/api/admin/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            })
          }
        />

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <div className="text-sm font-semibold text-gray-800">People</div>
            <div className="text-xs text-gray-400">
              {users.filter((u) => !u.disabledAt).length} active
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2 text-left font-semibold">Name</th>
                  {/* Not "Email": a shared store account signs in with a
                      username, and the column shows whichever it uses. */}
                  <th className="px-4 py-2 text-left font-semibold">Signs in as</th>
                  <th className="px-4 py-2 text-left font-semibold">Position</th>
                  <th className="px-4 py-2 text-left font-semibold">Last sign-in</th>
                  <th className="px-4 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {u.email ?? u.username}
                      {!u.email && (
                        <span className="ml-2 text-[11px] text-gray-400">shared password</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.positionId}
                        disabled={busy}
                        onChange={(e) =>
                          send("/api/admin/users", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id: u.id, positionId: e.target.value }),
                          })
                        }
                        className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white cursor-pointer"
                      >
                        {positions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    {/* The date is the status: it says both that they've been
                        in and when. "Disabled" still leads where it applies,
                        with the last sign-in kept underneath rather than
                        thrown away — it's the useful part when deciding
                        whether an account was ever really used. */}
                    <td className="px-4 py-3 text-xs">
                      {u.disabledAt && <div className="text-red-600">Disabled</div>}
                      {u.lastLoginAt ? (
                        <div className={u.disabledAt ? "text-gray-400" : "text-gray-600"}>
                          {formatSyncStamp(u.lastLoginAt)}
                        </div>
                      ) : (
                        !u.disabledAt && <div className="text-gray-400">Never signed in</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {/* You can't disable or delete yourself — that's a
                          one-way trip out of the admin screen with no way
                          back in. The server refuses it too. */}
                      {u.id !== viewerId && (
                        <UserActions
                          disabled={!!u.disabledAt}
                          busy={busy}
                          onToggle={() =>
                            send("/api/admin/users", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: u.id, disabled: !u.disabledAt }),
                            })
                          }
                          onDelete={() =>
                            send(`/api/admin/users?id=${encodeURIComponent(u.id)}`, {
                              method: "DELETE",
                            })
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Positions
          positions={positions}
          allTabs={allTabs}
          busy={busy}
          onSave={(p) =>
            send("/api/admin/positions", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(p),
            })
          }
        />

        <Leaders
          leaders={leaders}
          busy={busy}
          onAdd={(name) =>
            send("/api/admin/leaders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            })
          }
          onSave={(patch) =>
            send("/api/admin/leaders", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            })
          }
          onRemove={(id) =>
            send(`/api/admin/leaders?id=${encodeURIComponent(id)}`, { method: "DELETE" })
          }
        />
      </main>
    </div>
  );
}

/**
 * Enable/Disable, plus a delete that asks first.
 *
 * The confirm step is inline rather than a window.confirm: the rest of this
 * screen acts immediately on click, so the one irreversible button here needs a
 * beat, and a two-state button gives it one without a modal.
 *
 * Deleting is genuinely gone — no undo, and the person is only re-addable by
 * typing their address in again. Disabling remains the right move for someone
 * who has left; this is for rows that shouldn't exist at all.
 */
function UserActions({
  disabled,
  busy,
  onToggle,
  onDelete,
}: {
  disabled: boolean;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[11px] text-gray-500">Delete for good?</span>
        <button
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            onDelete();
          }}
          className="text-xs px-2.5 py-1 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer disabled:opacity-50"
        >
          Delete
        </button>
        <button
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600 cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        disabled={busy}
        onClick={onToggle}
        className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600 cursor-pointer disabled:opacity-50"
      >
        {disabled ? "Enable" : "Disable"}
      </button>
      <button
        disabled={busy}
        onClick={() => setConfirming(true)}
        className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-gray-500 cursor-pointer disabled:opacity-50"
      >
        Delete
      </button>
    </span>
  );
}

function AddUser({
  positions,
  busy,
  onAdd,
}: {
  positions: Position[];
  busy: boolean;
  onAdd: (f: { name: string; email: string; positionId: string }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [positionId, setPositionId] = useState(positions[0]?.id ?? "");
  const ready = name.trim() && email.trim() && positionId;

  return (
    <section className="bg-white rounded-xl border border-gray-200 px-4 py-3.5">
      <div className="text-sm font-semibold text-gray-800 mb-3">Add someone</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 w-48"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 w-72"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Position</span>
          <select
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer"
          >
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !ready}
          onClick={() => {
            onAdd({ name: name.trim(), email: email.trim(), positionId });
            setName("");
            setEmail("");
          }}
          className="text-sm px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white transition disabled:opacity-50 cursor-pointer"
        >
          Add
        </button>
      </div>
    </section>
  );
}

function Positions({
  positions,
  allTabs,
  busy,
  onSave,
}: {
  positions: Position[];
  allTabs: Tab[];
  busy: boolean;
  onSave: (p: { id: string; label: string; tabs: string[] }) => void;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="text-sm font-semibold text-gray-800">Positions</div>
        <div className="text-xs text-gray-400">
          Which tabs each position can reach. Takes effect on their next page load.
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {positions.map((p) => (
          <div key={p.id} className="px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="w-56">
              <div className="text-sm font-medium text-gray-900">{p.label}</div>
              {p.isAdmin && (
                <div className="text-[11px] text-gray-400">Can manage users</div>
              )}
            </div>
            {allTabs.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={p.tabs.includes(t)}
                  onChange={(e) => {
                    const tabs = e.target.checked
                      ? [...p.tabs, t]
                      : p.tabs.filter((x) => x !== t);
                    onSave({ id: p.id, label: p.label, tabs });
                  }}
                  className="rounded border-gray-300"
                />
                {TAB_LABELS[t]}
              </label>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Above-store leaders, and which stores each of them covers.
 *
 * Not a position and not a user: a leader is a way of slicing the estate, and
 * the people in this list may well have no dashboard login at all. Keeping it
 * separate from the account table means adding one doesn't grant anything and
 * removing one doesn't revoke anything — it only changes what the Drive-Thru
 * filter offers.
 */
function Leaders({
  leaders,
  busy,
  onAdd,
  onSave,
  onRemove,
}: {
  leaders: Leader[];
  busy: boolean;
  onAdd: (name: string) => void;
  onSave: (patch: { id: string; name?: string; stores?: string[] }) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");

  const sections = ["Tennessee", "Virginia"] as const;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="text-sm font-semibold text-gray-800">Above-store leaders</div>
        <div className="text-xs text-gray-400">
          Which stores each leader covers. They become a filter on the Drive-Thru
          tab, alongside the VA and TN boxes. Takes effect on its next page load.
        </div>
      </div>

      <div className="px-4 pb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !busy) {
                onAdd(name.trim());
                setName("");
              }
            }}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 w-56"
          />
        </label>
        <button
          disabled={busy || !name.trim()}
          onClick={() => {
            onAdd(name.trim());
            setName("");
          }}
          className="text-sm px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white transition disabled:opacity-50 cursor-pointer"
        >
          Add
        </button>
      </div>

      {leaders.length === 0 ? (
        <div className="px-4 pb-4 text-xs text-gray-400">
          No leaders yet. Add one above, then tick their stores.
        </div>
      ) : (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {leaders.map((l) => (
            <LeaderRow
              key={l.id}
              leader={l}
              sections={sections}
              busy={busy}
              onSave={onSave}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LeaderRow({
  leader,
  sections,
  busy,
  onSave,
  onRemove,
}: {
  leader: Leader;
  sections: readonly ("Tennessee" | "Virginia")[];
  busy: boolean;
  onSave: (patch: { id: string; name?: string; stores?: string[] }) => void;
  onRemove: (id: string) => void;
}) {
  // Local while typing, saved on blur. Saving per keystroke would round-trip
  // and re-sort the whole list under the cursor on every letter.
  const [draft, setDraft] = useState(leader.name);

  function toggle(label: string, on: boolean) {
    const stores = on
      ? [...leader.stores, label]
      : leader.stores.filter((s) => s !== label);
    onSave({ id: leader.id, stores });
  }

  // Two columns, not one wrapping row: wrapping let the VA group land at the
  // container's left edge, starting well to the left of where TN started. The
  // name is its own fixed column and the two state rows stack in a second one,
  // so both states begin at the same x.
  return (
    <div className="px-4 py-3 flex items-start gap-x-5">
      <div className="w-72 shrink-0 flex items-center gap-2">
        <input
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const next = draft.trim();
            if (!next) { setDraft(leader.name); return; }
            if (next !== leader.name) onSave({ id: leader.id, name: next });
          }}
          className="text-sm font-medium text-gray-900 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded-lg px-2 py-1 w-40 focus:outline-none"
        />
        <button
          disabled={busy}
          onClick={() => onRemove(leader.id)}
          className="text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-500 cursor-pointer disabled:opacity-50"
        >
          Remove
        </button>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-y-2">
        {sections.map((section) => (
          <div key={section} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Fixed width so the first checkbox of each state lines up, rather
                than depending on "TN" and "VA" rendering identically wide. */}
            <span className="w-6 shrink-0 text-[11px] uppercase tracking-wide text-gray-400">
              {section === "Tennessee" ? "TN" : "VA"}
            </span>
            {ALL_STORES.filter((s) => s.section === section).map((s) => (
              <label
                key={s.label}
                className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={leader.stores.includes(s.label)}
                  onChange={(e) => toggle(s.label, e.target.checked)}
                  className="rounded border-gray-300"
                />
                {s.label}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
