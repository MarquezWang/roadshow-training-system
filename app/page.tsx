import Link from "next/link";

const foundations = [
  "Next.js App Router",
  "TypeScript",
  "Tailwind CSS",
  "Prisma + SQLite",
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 sm:px-8 lg:px-10">
      <section className="grid flex-1 items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-w-2xl">
          <p className="mb-4 text-sm font-medium text-teal-700">
            Roadshow Training System
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl">
            路演培训系统
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">
            项目基础环境已就绪。这里将作为后续训练内容、项目材料、评审规则和答辩反馈的统一入口。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {foundations.map((item) => (
              <span
                key={item}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                {item}
              </span>
            ))}
          </div>
          <div className="mt-8">
            <Link
              href="/projects"
              className="inline-flex h-11 items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              进入项目管理
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">基础目录</h2>
          <dl className="mt-5 grid gap-4 text-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <dt className="text-slate-500">应用页面</dt>
              <dd className="font-medium text-slate-900">app/</dd>
            </div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <dt className="text-slate-500">通用组件</dt>
              <dd className="font-medium text-slate-900">components/</dd>
            </div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <dt className="text-slate-500">数据配置</dt>
              <dd className="font-medium text-slate-900">prisma/</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">资料与文档</dt>
              <dd className="font-medium text-slate-900">uploads/ docs/</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
