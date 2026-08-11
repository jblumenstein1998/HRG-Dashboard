"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Where a temporary password gets exchanged for a real one.
 *
 * Reachable two ways: forced, straight after signing in with a password an
 * admin issued (the proxy sends every other path here until it's done), or
 * voluntarily from the tab bar.
 */
const MIN_LENGTH = 10;

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== newPassword;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't change the password");
        return;
      }
      // Same as login: the root picks the landing tab for this position.
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hrglogo.png" alt="HRG" className="h-20 w-auto mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-gray-900">Choose a password</h1>
          <p className="text-sm text-gray-500 mt-2">
            Set your own password to finish signing in.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <Field
              id="current"
              label="Current password"
              autoComplete="current-password"
              autoFocus
              value={currentPassword}
              onChange={setCurrent}
            />
            <Field
              id="new"
              label="New password"
              autoComplete="new-password"
              value={newPassword}
              onChange={setNew}
              hint={`At least ${MIN_LENGTH} characters.`}
              problem={tooShort ? `At least ${MIN_LENGTH} characters.` : null}
            />
            <Field
              id="confirm"
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              problem={mismatch ? "Doesn't match." : null}
            />

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || tooShort || mismatch || !currentPassword || !newPassword}
              className="w-full bg-red-700 hover:bg-red-800 text-white font-medium text-sm rounded-lg px-4 py-2.5 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? "Saving…" : "Save password"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 italic">
          Take care of the little things to accomplish the big things
        </p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  hint,
  problem,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  hint?: string;
  problem?: string | null;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3.5 py-2.5 rounded-lg border text-gray-900 text-sm focus:outline-none focus:ring-2 transition ${
          problem
            ? "border-red-300 focus:ring-red-500"
            : "border-gray-300 focus:ring-red-600 focus:border-transparent"
        }`}
      />
      {(problem || hint) && (
        <p className={`text-xs mt-1 ${problem ? "text-red-600" : "text-gray-400"}`}>
          {problem ?? hint}
        </p>
      )}
    </div>
  );
}
