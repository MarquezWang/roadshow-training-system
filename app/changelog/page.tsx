import Link from "next/link";

const changelogItems = [
  {
    version: "v0.6.0",
    date: "2026-06-28",
    title: "多用户登录与管理员能力",
    items: [
      "新增登录与退出登录能力，启用后项目页、训练页和文件预览需要登录访问。",
      "新增用户归属隔离：普通用户只能查看和训练自己的项目。",
      "新增管理员全局视角：ADMIN 可查看所有项目、训练记录，并在项目列表和详情中看到所属用户。",
      "新增管理员用户管理页，可创建内测账号、修改显示名和角色、重置密码。",
      "新增用户创建命令行工具，便于服务器或本地快速创建测试账号。",
      "用户管理页增加账号状态展示，可区分可登录账号、不可登录历史账号，并标记 team@roadshow.local 为历史项目账号。",
    ],
  },
  {
    version: "v0.5.0",
    date: "2026-06-28",
    title: "转写与答辩体验优化",
    items: [
      "新增腾讯云 ASR 转写接入，可通过环境变量在讯飞云与腾讯云之间切换。",
      "新增腾讯云录音文件识别极速版 provider，可用于降低训练录音转写等待时间。",
      "增加 ASR 调用耗时日志，便于判断当前转写服务商、耗时和识别文本长度。",
      "优化 QA 准备页等待策略，极速版转写场景下更快进入答辩。",
      "限制动态追问等待转写时的重试次数，避免 QA 页面持续请求。",
      "优化动态追问展示时机：追问生成动画完成后，再展示题目文本并进入准备倒计时。",
      "新增更新日志页，用于集中记录阶段版本内容，减少频繁服务器同步。",
    ],
  },
  {
    version: "v0.4.0",
    date: "2026-06",
    title: "路演材料展示能力",
    items: [
      "支持 PPT/PPTX 在服务端转换为展示用 PDF，并复用现有 PDF 预览与翻页链路。",
      "增加 LibreOffice 部署自检与 PPT 预览诊断日志，便于服务器环境排查。",
      "为 PDF 预览接口增加短期私有缓存，降低 pitch 进入 QA 时的重复加载成本。",
      "简化路演与答辩页面右侧信息栏，让材料展示区域更接近全屏训练体验。",
    ],
  },
  {
    version: "v0.3.0",
    date: "2026-06",
    title: "稳定性与可观测性",
    items: [
      "新增 AI 调用耗时日志，记录 task、model、elapsedMs 与失败摘要。",
      "报告生成等待态增加阶段提示，明确报告通常需要 1-3 分钟。",
      "新增内部测试关键路径验收清单，覆盖新建项目、训练、答辩、报告等主流程。",
      "增加双模型配置：轻量任务使用 fast 模型，关键任务使用 strong 模型。",
    ],
  },
  {
    version: "v0.2.0",
    date: "2026-06",
    title: "新建项目与 TRL 档案",
    items: [
      "新建项目流程调整为上传材料并确认档案、合作需求与转化对接两步。",
      "TRL 判断改为结构化证据提取与后端规则约束，降低随机误判。",
      "增加项目创建前端提交中状态与后端防重复创建保护。",
      "优化 AI 识别失败分级提示，基础档案与 TRL 判断解耦。",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">管理员工具</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              更新日志
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              这里记录内部测试阶段的关键版本变化。后续开发建议先在本地完成一组较完整的改动与验收，再统一提交、推送并同步服务器。
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            返回
          </Link>
        </div>

        <div className="space-y-5">
          {changelogItems.map((item) => (
            <article
              key={item.version}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
                  {item.version}
                </span>
                <span className="text-sm text-slate-500">{item.date}</span>
              </div>
              <h2 className="mt-4 text-xl font-semibold text-slate-950">
                {item.title}
              </h2>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                {item.items.map((change) => (
                  <li key={change} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    <span>{change}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
