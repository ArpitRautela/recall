import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Reachable without a session. Legal pages are here so they work both for a signed-out
// visitor following the link on /register and for a signed-in user.
const PUBLIC_PATHS = ["/login", "/register", "/callback", "/terms", "/privacy"];

// Public *and* pointless once you're signed in — these bounce to the dashboard.
// /callback is deliberately absent: it must still run its code exchange.
const SIGNED_OUT_ONLY = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get("recall_session");

  // Unauthenticated user trying to reach a protected page → login
  if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p)) && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated user hitting login/register → dashboard
  if (session && SIGNED_OUT_ONLY.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
