import type { ReactNode } from "react";

export type RiskLevel = "正常" | "注意" | "风险";

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
        ok
          ? "border-teal-200 bg-teal-50 text-teal-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {ok ? "正常" : "需配置"}
    </span>
  );
}

export function ConfigRow({
  label,
  value,
  ok = true,
  note,
}: {
  label: string;
  value: string;
  ok?: boolean;
  note?: string;
}) {
  return (
    <div className="grid gap-y-2 border-b border-slate-100 py-3 last:border-b-0 md:grid-cols-[240px_minmax(0,1fr)_auto] md:items-start md:gap-x-6">
      <div className="min-w-0 break-all text-sm font-medium text-slate-600">
        {label}
      </div>
      <div className="min-w-0 break-all font-mono text-sm leading-6 text-slate-950">
        {value}
      </div>
      <div className="md:text-right">
        <StatusBadge ok={ok} />
      </div>
      {note ? (
        <p className="min-w-0 text-sm leading-6 text-slate-500 md:col-start-2 md:col-end-4">
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="border-b border-slate-100 pb-4">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      <div className="pt-2">{children}</div>
    </section>
  );
}

function RiskPill({ level }: { level: RiskLevel }) {
  const className =
    level === "正常"
      ? "border-teal-200 bg-teal-50 text-teal-700"
      : level === "注意"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-rose-200 bg-rose-50 text-rose-700";

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {level}
    </span>
  );
}

export function RiskRow({
  title,
  detail,
  level,
}: {
  title: string;
  detail: string;
  level: RiskLevel;
}) {
  return (
    <div className="grid gap-2 border-b border-slate-100 py-3 last:border-b-0 md:grid-cols-[160px_minmax(0,1fr)_auto] md:items-start md:gap-x-4">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="text-sm leading-6 text-slate-600">{detail}</p>
      <div className="md:text-right">
        <RiskPill level={level} />
      </div>
    </div>
  );
}

export function CommandList({ commands }: { commands: string[] }) {
  return (
    <div className="grid gap-2">
      {commands.map((command) => (
        <code
          key={command}
          className="block overflow-x-auto rounded-md border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
        >
          {command}
        </code>
      ))}
    </div>
  );
}

export function CollapsibleSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
        <span>
          <span className="block text-base font-semibold text-slate-950">
            {title}
          </span>
          <span className="mt-1 block text-sm leading-6 text-slate-500">
            {description}
          </span>
        </span>
        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 transition group-open:bg-slate-50">
          <span className="group-open:hidden">展开</span>
          <span className="hidden group-open:inline">收起</span>
        </span>
      </summary>
      <div className="mt-4 border-t border-slate-100 pt-2">{children}</div>
    </details>
  );
}
