"use client";

type Diagnostics = {
  content: string[];
  delivery: string[];
  qa: string[];
};

type DiagnosticCardProps = Readonly<{
  title: string;
  items: string[];
  fallback: string;
}>;

type ReportOverviewDiagnosticsProps = Readonly<{
  diagnostics: Diagnostics;
}>;

function DiagnosticCard({ title, items, fallback }: DiagnosticCardProps) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
        {(items.length > 0 ? items : [fallback]).map((item, index) => (
          <li key={index}>· {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ReportOverviewDiagnostics({
  diagnostics,
}: ReportOverviewDiagnosticsProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <DiagnosticCard
        title="路演内容诊断"
        items={diagnostics.content}
        fallback="暂无更细的内容诊断，建议查看内容覆盖与证据充分性。"
      />
      <DiagnosticCard
        title="表达与节奏诊断"
        items={diagnostics.delivery}
        fallback="暂无更细的表达诊断，建议查看路演表现分析。"
      />
      <DiagnosticCard
        title="答辩表现诊断"
        items={diagnostics.qa}
        fallback="如本轮已完成答辩，可在答辩表现页查看逐题复盘。"
      />
    </section>
  );
}
