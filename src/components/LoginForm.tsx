"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * The sign-in form.
 *
 * A client component only because it owns form state. The page around it is a
 * server component that reads ?error= and passes it in — reading it here with
 * useSearchParams would force the whole page behind a Suspense boundary, which
 * shipped an empty shell to production that only filled in after hydration.
 */
export default function LoginForm({ callbackError }: { callbackError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);


  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      router.push(data.mustReset ? "/change-password" : "/");
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
          <h1 className="text-2xl font-semibold text-gray-900">HRG Dashboard</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {(callbackError || error) && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-5">
              {callbackError || error}
            </div>
          )}

          <a
            href="/api/auth/google/start"
            className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
              <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
              <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14Z" />
            </svg>
            Sign in with Google
          </a>

          <p className="text-xs text-gray-400 text-center mt-3">
            Use your @hudsonrestaurantgroup.com account.
          </p>

          {!showPassword ? (
            <button
              onClick={() => setShowPassword(true)}
              className="w-full text-xs text-gray-400 hover:text-gray-600 mt-6 cursor-pointer transition"
            >
              Sign in with a password instead
            </button>
          ) : (
            <>
              <div className="flex items-center gap-3 my-6">
                <div className="h-px bg-gray-200 flex-1" />
                <span className="text-xs text-gray-400">or</span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-red-700 hover:bg-red-800 text-white font-medium text-sm rounded-lg px-4 py-2.5 transition disabled:opacity-50 cursor-pointer"
                >
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 italic">
          Take care of the little things to accomplish the big things
        </p>
      </div>
    </div>
  );
}
