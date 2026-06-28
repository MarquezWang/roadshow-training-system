import { NextRequest, NextResponse } from "next/server";
import {
  authCookieName,
  isAuthenticatedRequest,
  isAuthEnabled,
} from "@/lib/auth";

function isProtectedPath(pathname: string) {
  return (
    pathname === "/projects" ||
    pathname.startsWith("/projects/") ||
    pathname === "/training" ||
    pathname.startsWith("/training/") ||
    pathname.startsWith("/api/files/") ||
    pathname === "/api/projects/material-parse" ||
    pathname === "/api/projects/profile-recognition"
  );
}

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function expectsHtml(request: NextRequest) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const isAuthenticated = await isAuthenticatedRequest(request);

  if (pathname === "/login") {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/projects", request.url));
    }

    return NextResponse.next();
  }

  if (pathname === "/logout") {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(authCookieName);
    return response;
  }

  if (!isProtectedPath(pathname) || isAuthenticated) {
    return NextResponse.next();
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
    "/projects/:path*",
    "/training/:path*",
    "/api/files/:path*",
    "/api/projects/material-parse",
    "/api/projects/profile-recognition",
  ],
};
