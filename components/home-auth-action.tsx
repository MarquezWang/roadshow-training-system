"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

export function HomeAuthAction() {
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
  }, []);

  if (!authState?.authEnabled || !authState.user) {
    return (
      <Link
        href="/login"
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-white px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
      >
        登录
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-xs text-slate-500">当前用户</p>
        <p className="max-w-40 truncate text-sm font-medium text-slate-100">
          {authState.user.name || authState.user.email}
        </p>
      </div>
      <a
        href="/logout"
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 px-4 text-sm font-medium text-slate-100 transition hover:border-cyan-300/45 hover:bg-cyan-300/10"
      >
        退出登录
      </a>
    </div>
  );
}
