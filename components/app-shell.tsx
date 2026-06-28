"use client";

import { usePathname } from "next/navigation";

function isTrainingFlowPath(pathname: string) {
  return /^\/training\/[^/]+\/(prepare|pitch|qa-prepare|qa|report)(?:\/.*)?$/.test(
    pathname,
  );
}

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();

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
          <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
            Dev Ready
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
