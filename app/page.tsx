import Image from "next/image";
import Link from "next/link";
import { BeianLink } from "@/components/beian-link";
import { HomeAuthAction } from "@/components/home-auth-action";
import { RotatingJudgeQuestion } from "@/components/rotating-judge-question";

const cockpitRows = [
  { label: "项目叙事完整度", value: "86", tone: "bg-cyan-300" },
  { label: "技术壁垒表达", value: "79", tone: "bg-emerald-300" },
  { label: "商业化路径", value: "72", tone: "bg-amber-300" },
  { label: "证据支撑密度", value: "68", tone: "bg-sky-300" },
  { label: "答辩准备度", value: "75", tone: "bg-teal-300" },
];

const highlights = [
  {
    title: "读材料",
    description: "识别项目关键信息",
  },
  {
    title: "练路演",
    description: "模拟陈述与追问",
  },
  {
    title: "看复盘",
    description: "定位短板与改法",
  },
];

const reviewSignals = [
  "技术可行性",
  "产业匹配度",
  "落地路径",
  "市场验证",
  "风险应对",
];

const focusItems = [
  {
    label: "证据链",
    action: "补一条真实客户验证",
    tone: "text-cyan-200",
  },
  {
    label: "落地",
    action: "拆清试点到交付路径",
    tone: "text-emerald-200",
  },
  {
    label: "风险",
    action: "准备被替代时的回答",
    tone: "text-amber-200",
  },
];

export default function Home() {
  return (
    <main className="home-stage min-h-screen overflow-hidden bg-[#05070d] text-white">
      <section className="relative min-h-screen">
        <Image
          src="/images/ai-training-command-center.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="pointer-events-none object-cover opacity-35 mix-blend-screen"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#05070d_0%,rgba(5,7,13,0.92)_32%,rgba(5,7,13,0.6)_62%,#05070d_100%),linear-gradient(180deg,rgba(5,7,13,0.35)_0%,#05070d_94%)]" />
        <div className="home-grid absolute inset-0 opacity-50" />

        <nav className="relative z-10 mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link
            href="/"
            className="text-xs font-semibold text-slate-500 transition hover:text-cyan-200"
          >
            ROADSHOW AI
          </Link>
          <HomeAuthAction />
        </nav>

        <div className="relative z-10 mx-auto grid min-h-[calc(100svh-5rem)] w-full max-w-7xl items-start gap-10 px-5 pb-16 pt-10 sm:px-8 sm:pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:px-12 lg:pt-10">
          <div className="max-w-3xl">
            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.12] text-white sm:text-6xl lg:text-7xl">
              项目有光，
              <span className="block bg-[linear-gradient(90deg,#67e8f9,#a7f3d0,#fef08a)] bg-clip-text text-transparent">
                也得讲得亮！
              </span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              从材料诊断到模拟答辩，帮项目团队提前演练每一次关键表达。
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/projects/new"
                className="inline-flex h-12 items-center justify-center rounded-md bg-cyan-300 px-6 text-sm font-semibold text-slate-950 shadow-[0_16px_42px_rgba(34,211,238,0.25)] transition hover:bg-cyan-200"
              >
                新建项目
              </Link>
              <Link
                href="/projects"
                className="inline-flex h-12 items-center justify-center rounded-md border border-white/20 bg-white/[0.08] px-6 text-sm font-semibold text-white backdrop-blur transition hover:border-white/35 hover:bg-white/[0.12]"
              >
                查看项目
              </Link>
            </div>

            <dl className="mt-11 grid max-w-2xl grid-cols-3 gap-3">
              {highlights.map((item, index) => (
                <div
                  key={item.title}
                  className={`border-l pl-4 ${
                    index === 0
                      ? "border-cyan-300/45"
                      : index === 1
                        ? "border-emerald-300/45"
                        : "border-amber-300/45"
                  }`}
                >
                  <dt className="text-lg font-semibold text-white">
                    {item.title}
                  </dt>
                  <dd className="mt-2 text-sm leading-6 text-slate-400">
                    {item.description}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="home-cockpit relative mx-auto w-full max-w-xl rounded-[28px] border border-white/15 bg-slate-950/65 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="rounded-[22px] border border-white/10 bg-[#080d16]/90 p-5">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-medium uppercase text-cyan-200">
                    Live Training
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    路演表现控制台
                  </h2>
                </div>
                <div className="rounded-full border border-emerald-300/35 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                  训练中
                </div>
              </div>

              <div className="mt-5 grid items-start gap-4 sm:grid-cols-[1fr_0.8fr]">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-200">
                      综合评分预测
                    </p>
                    <span className="text-xs text-slate-500">v2.6</span>
                  </div>
                  <div className="mt-5 flex items-end gap-3">
                    <span className="text-6xl font-semibold leading-none text-white">
                      84
                    </span>
                    <span className="pb-2 text-sm text-cyan-200">/100</span>
                  </div>
                  <div className="mt-5 space-y-2.5">
                    {cockpitRows.map((row) => (
                      <div key={row.label}>
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>{row.label}</span>
                          <span>{row.value}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full ${row.tone}`}
                            style={{ width: `${row.value}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
                    <p className="text-xs text-cyan-100">评委提问</p>
                    <RotatingJudgeQuestion />
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-400">复盘焦点</p>
                      <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] font-medium text-cyan-100">
                        NEXT
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {focusItems.map((item, index) => (
                        <div key={item.label} className="group">
                          <div
                            className="grid grid-cols-[1.6rem_1fr] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-1.5 transition group-hover:border-cyan-300/25 group-hover:bg-white/[0.055]"
                          >
                            <span className={`text-xs font-semibold ${item.tone}`}>
                              0{index + 1}
                            </span>
                            <span>
                              <span className="block text-xs font-semibold text-slate-200">
                                {item.label}
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
                                {item.action}
                              </span>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {reviewSignals.map((signal) => (
                  <div
                    key={signal}
                    className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-3 text-center text-xs font-medium text-slate-300 transition hover:border-cyan-300/25 hover:bg-cyan-300/10 hover:text-cyan-100"
                  >
                    {signal}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#05070d] px-5 py-7 text-sm text-slate-500 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>AI 路演训练系统</span>
          <BeianLink className="transition hover:text-slate-300" />
        </div>
      </footer>
    </main>
  );
}
