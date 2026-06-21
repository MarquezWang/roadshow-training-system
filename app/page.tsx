import Link from "next/link";

const features = [
  {
    number: "01",
    title: "材料诊断",
    description: "梳理项目材料中的关键信息，发现内容缺口与表达风险。",
    accent: "border-cyan-400/40 text-cyan-300",
  },
  {
    number: "02",
    title: "模拟路演",
    description: "按真实路演节奏完成演练，记录时间、讲述与页面进度。",
    accent: "border-emerald-400/40 text-emerald-300",
  },
  {
    number: "03",
    title: "智能答辩",
    description: "结合项目内容生成评委问题，并根据现场表达动态追问。",
    accent: "border-violet-400/40 text-violet-300",
  },
  {
    number: "04",
    title: "评分报告",
    description: "输出结构化评分、逐题复盘与可以直接执行的优化建议。",
    accent: "border-amber-400/40 text-amber-300",
  },
];

const steps = ["创建项目", "上传材料", "开始路演", "模拟答辩", "查看报告"];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#080b12] text-white">
      <div className="relative border-b border-white/10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_24%,rgba(34,211,238,0.12),transparent_34%),radial-gradient(ellipse_at_22%_72%,rgba(16,185,129,0.08),transparent_38%),linear-gradient(180deg,#0d1320_0%,#080b12_72%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,transparent,rgba(8,11,18,0.92)),repeating-linear-gradient(90deg,transparent_0,transparent_79px,rgba(255,255,255,0.025)_80px)]"
        />

        <nav className="relative z-10 mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-xs font-semibold text-cyan-200">
              AI
            </span>
            <span className="truncate text-sm font-semibold text-white sm:text-base">
              AI 路演训练系统
            </span>
          </Link>
          <Link
            href="/projects"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 px-4 text-sm font-medium text-slate-100 transition-colors hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-white"
          >
            进入我的项目
          </Link>
        </nav>

        <section className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-7xl flex-col justify-center px-5 pb-24 pt-16 sm:px-8 sm:pb-28 lg:px-12 lg:pt-20">
          <div className="max-w-4xl">
            <p className="mb-5 flex items-center gap-3 text-xs font-medium uppercase text-cyan-200 sm:text-sm">
              <span className="h-px w-8 bg-cyan-300/70" />
              面向真实路演场景的 AI 训练
            </p>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.08] tracking-normal text-white sm:text-6xl lg:text-7xl">
              AI 路演训练系统
            </h1>
            <p className="mt-7 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
              上传项目材料，模拟真实路演与评委答辩，生成结构化评分报告和优化建议。
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/projects"
                className="inline-flex h-12 items-center justify-center rounded-md bg-cyan-300 px-6 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200"
              >
                开始训练
              </Link>
              <Link
                href="/projects"
                className="inline-flex h-12 items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white transition-colors hover:border-white/35 hover:bg-white/10"
              >
                查看示例报告
              </Link>
            </div>
          </div>

          <div className="absolute bottom-7 left-5 right-5 flex items-center gap-4 text-xs text-slate-500 sm:left-8 sm:right-8 lg:left-12 lg:right-12">
            <span>PROJECT REVIEW</span>
            <span className="h-px flex-1 bg-white/10" />
            <span>ROADSHOW · Q&amp;A · REPORT</span>
          </div>
        </section>
      </div>

      <section className="border-b border-white/10 bg-[#0b0f18] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
        <div className="mx-auto w-full max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-cyan-300">训练能力</p>
            <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
              从材料准备到答辩复盘
            </h2>
            <p className="mt-4 leading-7 text-slate-400">
              围绕一次完整路演训练组织内容、演练过程与反馈结果。
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <article
                key={feature.title}
                className="rounded-lg border border-white/10 bg-white/[0.035] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.055]"
              >
                <span
                  className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${feature.accent}`}
                >
                  {feature.number}
                </span>
                <h3 className="mt-6 text-lg font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#080b12] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
        <div className="mx-auto w-full max-w-7xl">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium text-emerald-300">训练流程</p>
              <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
                五步完成一次路演训练
              </h2>
            </div>
            <Link
              href="/projects"
              className="inline-flex h-10 w-fit items-center justify-center rounded-md border border-white/15 px-4 text-sm font-medium text-slate-200 transition-colors hover:border-emerald-300/40 hover:text-white"
            >
              创建训练项目
            </Link>
          </div>

          <ol className="mt-12 grid gap-0 border-y border-white/10 md:grid-cols-5">
            {steps.map((step, index) => (
              <li
                key={step}
                className="flex min-h-28 items-center gap-4 border-b border-white/10 px-1 py-6 last:border-b-0 md:border-b-0 md:border-r md:px-5 md:last:border-r-0"
              >
                <span className="text-sm font-medium text-cyan-300">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-medium text-slate-100">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#080b12] px-5 py-7 text-sm text-slate-500 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>AI 路演训练系统</span>
          <span>让每一次路演都有清晰反馈</span>
        </div>
      </footer>
    </main>
  );
}
