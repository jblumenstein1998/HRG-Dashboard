import { NextRequest, NextResponse } from "next/server";

// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
// /api/cron/ is invoked by Vercel Cron, which never sends the berry_token
// cookie — those routes protect themselves individually via CRON_SECRET.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/smg/", "/api/cron/", "/api/slack"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = request.cookies.get("berry_token")?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.ico|.*\\.webp).*)"],
};
