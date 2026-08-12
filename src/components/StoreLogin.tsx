"use client";

import { useRef, useState } from "react";

/**
 * The username-and-password path, for shared store accounts.
 *
 * Presented as a second way in, under an "or" rule and carrying the same visual
 * weight as the Google button, because the people who need it are working a
 * shift on a back-office machine and shouldn't have to hunt for it.
 *
 * Still collapsed until asked for, though: the fields themselves stay hidden
 * behind the button. Two open forms would invite someone with a work account to
 * type their email into the wrong one and fail for reasons the generic error
 * can't explain — the route resolves usernames only, so an address can never
 * work here. Prominent entry, deliberate expansion.
 *
 * A client component, so the login page itself stays a server component and the
 * Google button still arrives fully rendered.
 */
export default function StoreLogin() {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(j.error ?? "Sign-in failed"));
        return;
      }
      // A full navigation, not a router push: the session cookie was just set
      // on this response and the root has to be re-resolved on the server to
      // route to the right landing tab for the position.
      window.location.href = "/";
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  // Separates the two ways in. Rendered in both states so the card doesn't
  // reflow when the form opens.
  const divider = (
    <div className="flex items-center gap-3 my-5">
      <div className="h-px flex-1 bg-gray-200" />
      <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  );

  if (!open) {
    return (
      <>
        {divider}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            // Focus after paint, so the field exists to receive it.
            requestAnimationFrame(() => usernameRef.current?.focus());
          }}
          className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition cursor-pointer"
        >
          <svg
            className="w-4 h-4 text-gray-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* A storefront: awning over a shopfront with a door. */}
            <path d="M3 9.5 4.5 4h15L21 9.5" />
            <path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
            <path d="M4.5 12v8h15v-8" />
            <path d="M10 20v-5h4v5" />
          </svg>
          Sign in with a store account
        </button>

        <p className="text-xs text-gray-400 text-center mt-3">
          For shared store devices.
        </p>
      </>
    );
  }

  return (
    <>
      {divider}
      <form onSubmit={submit} className="space-y-3">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Username</span>
          <input
            ref={usernameRef}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            // Tablets and phones in a back office capitalise the first letter by
            // default, which would silently mangle a credential typed correctly.
            // The lookup is case-insensitive anyway, but the field shouldn't be
            // fighting the person using it.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
        </label>

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="w-full text-sm px-3 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white transition disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        {/* A way back for anyone who opened this and meant to use Google. */}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError("");
            setPassword("");
          }}
          className="w-full text-xs text-gray-400 hover:text-gray-600 transition cursor-pointer"
        >
          Cancel
        </button>
      </form>
    </>
  );
}
