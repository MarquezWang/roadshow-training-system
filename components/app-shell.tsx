"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BeianLink } from "@/components/beian-link";

type AuthUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

type AuthState = {
  authEnabled: boolean;
  user: AuthUser | null;
};

function isTrainingFlowPath(pathname: string) {
  return /^\/training\/[^/]+\/(prepare|pitch|qa-prepare|qa|report|replay)(?:\/.*)?$/.test(
    pathname,
  );
}

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const [authState, setAuthState] = useState<AuthState | null>(null);

  useEffect(() => {
    let ignore = false;

    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: AuthState | null) => {
        if (!ignore) {
          setAuthState(data);
        }
      })
      .catch(() => {
        if (!ignore) {
          setAuthState(null);
        }
      });

    return () => {
      ignore = true;
    };
  }, [pathname]);

  if (pathname === "/" || pathname === "/login" || isTrainingFlowPath(pathname)) {
    return children;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 sm:px-8 lg:px-10">
          <div>
            <p className="text-sm font-semibold text-slate-950">
              Roadshow Training System
            </p>
            <p className="text-xs text-slate-500">项目管理与路演训练</p>
          </div>

          <div className="flex items-center gap-3">
            {authState?.authEnabled ? (
              authState.user ? (
                <>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">当前用户</p>
                    <p className="text-sm font-medium text-slate-900">
                      {authState.user.name || authState.user.email}
                    </p>
                  </div>
                  <a
                    href="/logout"
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    退出登录
                  </a>
                </>
              ) : (
                <a
                  href="/login"
                  className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 transition hover:border-teal-300 hover:bg-teal-100"
                >
                  登录
                </a>
              )
            ) : (
              <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
                Dev Ready
              </div>
            )}
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-slate-200 bg-white px-6 py-4 text-center text-xs text-slate-500 sm:px-8 lg:px-10">
        <BeianLink className="transition hover:text-slate-800" />
      </footer>
    </div>
  );
}
