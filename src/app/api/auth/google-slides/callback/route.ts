import { NextRequest, NextResponse } from "next/server";
import { completeWorkspaceAuth, WORKSPACE_OAUTH_COOKIE } from "@/lib/google/workspace";
import { requireAdminApi } from "@/lib/users/adminGuard";

/** Back to the Admin tab, where the WBR panel reads the outcome from the query. */
function back(request: NextRequest, params: Record<string, string>) {
  const url = request.nextUrl.clone();
  url.pathname = "/admin-links";
  url.search = `?${new URLSearchParams(params)}`;
  const res = NextResponse.redirect(url);
  res.cookies.delete(WORKSPACE_OAUTH_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const oauthError = params.get("error");
  if (oauthError) {
    return back(request, { google_error: oauthError === "access_denied" ? "Connection cancelled." : oauthError });
  }

  const code = params.get("code");
  const state = params.get("state");
  const [expectedState, verifier] = (request.cookies.get(WORKSPACE_OAUTH_COOKIE)?.value ?? "").split(".");
  if (!code || !state || !expectedState || !verifier || state !== expectedState) {
    return back(request, { google_error: "Connection expired. Please try again." });
  }

  try {
    const email = await completeWorkspaceAuth({ code, verifier, origin: request.nextUrl.origin });
    return back(request, { google: email });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wbr] Google connect failed: ${message}`);
    return back(request, { google_error: message });
  }
}
