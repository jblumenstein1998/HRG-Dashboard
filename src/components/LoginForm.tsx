/**
 * The sign-in card.
 *
 * Google is the only way in. There is no password to type, forget or reset —
 * see lib/users/google.ts. A server component renders this and passes any
 * message the Google callback came back with.
 */
export default function LoginForm({ callbackError }: { callbackError?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hrglogo.png" alt="HRG" className="h-20 w-auto mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-gray-900">HRG Dashboard</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {callbackError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-5">
              {callbackError}
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
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 italic">
          Take care of the little things to accomplish the big things
        </p>
      </div>
    </div>
  );
}
