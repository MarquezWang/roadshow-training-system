import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedRequest,
  authCookieName,
  isAuthEnabled,
} from "@/lib/auth";

function isProtectedPath(pathname: string) {
  return (
    pathname === "/projects" ||
    pathname.startsWith("/projects/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/training" ||
    pathname.startsWith("/training/") ||
    pathname.startsWith("/api/files/") ||
    pathname.startsWith("/api/projects/") ||
    pathname.startsWith("/api/admin/")
  );
}

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function expectsHtml(request: NextRequest) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

function applyRotatedAuthCookie(
  response: NextResponse,
  authResult: Awaited<ReturnType<typeof getAuthenticatedRequest>>,
) {
  if (!authResult?.rotatedCookieValue) {
    return response;
  }

  response.cookies.set(authCookieName, authResult.rotatedCookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(
      1,
      authResult.session.exp - Math.floor(Date.now() / 1000),
    ),
  });
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const authResult = await getAuthenticatedRequest(request);
  const isAuthenticated = Boolean(authResult);

  if (pathname === "/login") {
    // The database-backed login page decides whether the account/session is
    // still active. This avoids a redirect loop after password reset or disable.
    return applyRotatedAuthCookie(NextResponse.next(), authResult);
  }

  if (pathname === "/logout") {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(authCookieName);
    return response;
  }

  if (!isProtectedPath(pathname) || isAuthenticated) {
    return applyRotatedAuthCookie(NextResponse.next(), authResult);
  }

  if (isApiPath(pathname) || !expectsHtml(request)) {
    return NextResponse.json({ error: "未登录或登录已过期。" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/login",
    "/logout",
    "/admin/:path*",
    "/projects/:path*",
    "/training",
    // The recording POST route streams up to 100MB directly to disk and performs
    // its own ownership check. Excluding only that exact route prevents Proxy
    // from cloning and buffering the entire recording body in memory.
    "/training/((?![^/]+/recordings/?$).*)",
    "/api/files/:path*",
    "/api/projects/:path*",
    "/api/admin/:path*",
  ],
};
