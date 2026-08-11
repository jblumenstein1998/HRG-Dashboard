"use client";

import { useState } from "react";
import TabPicker from "@/components/TabPicker";
import { TAB_LABELS, type Tab } from "@/lib/users/tabs";
import { formatSyncStamp } from "@/lib/surveyMeta";

type User = {
  id: string;
  email: string;
  name: string;
  positionId: string;
  disabledAt: string | null;
  lastLoginAt: string | null;
};

type Position = { id: string; label: string; tabs: Tab[]; isAdmin: boolean };

/**
 * Users and access.
 *
 * Adding someone grants an address permission to sign in with Google. No
 * password is issued, so there is nothing to hand over and nothing to reset.
 */
export default function AdminClient({
  initialUsers,
  initialPositions,
  allTabs,
  viewerId,
  viewerTabs,
}: {
  initialUsers: User[];
  initialPositions: Position[];
  allTabs: Tab[];
  viewerId: string;
  viewerTabs: Tab[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [positions, setPositions] = useState(initialPositions);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const j = await res.json();
      setUsers(j.users);
      setPositions(j.positions);
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
                  <th className="px-4 py-2 text-left font-semibold">Email</th>
                  <th className="px-4 py-2 text-left font-semibold">Position</th>
                  <th className="px-4 py-2 text-left font-semibold">Last sign-in</th>
                  <th className="px-4 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
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
                      {/* You can't disable yourself — that's a one-way trip out
                          of the admin screen with no way back in. */}
                      {u.id !== viewerId && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            send("/api/admin/users", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: u.id, disabled: !u.disabledAt }),
                            })
                          }
                          className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600 cursor-pointer disabled:opacity-50"
                        >
                          {u.disabledAt ? "Enable" : "Disable"}
                        </button>
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
      </main>
    </div>
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
