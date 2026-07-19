import type { DiagnosticEvent } from "@/lib/diagnostic-log";
import type { SystemCheckResult } from "./system-status-data";
import {
  CollapsibleSection,
  CommandList,
  ConfigRow,
} from "./system-status-ui";

const operationsCommands = [
  "git status -sb",
  "git pull --ff-only origin internal-test",
  "npm run lint && npm run build",
  "pm2 status",
  "pm2 restart roadshow-training-system --update-env",
  "pm2 restart roadshow-background-worker --update-env",
  "pm2 logs roadshow-training-system --lines 120 --nostream",
  "pm2 logs roadshow-background-worker --lines 120 --nostream",
  "sudo nginx -t && sudo systemctl reload nginx",
  "libreoffice --version || soffice --version",
];

export function SystemOperationsSections({
  backgroundWorkerCheck,
  databaseCheck,
  diagnosticEvents,
  uploadDirectoryCheck,
}: {
  backgroundWorkerCheck: SystemCheckResult;
  databaseCheck: SystemCheckResult;
  diagnosticEvents: DiagnosticEvent[];
  uploadDirectoryCheck: SystemCheckResult;
}) {
  return (
    <>
      <CollapsibleSection
        title="运维提示"
        description="这里展示的是配置状态，不替代真实业务链路测试。"
      >
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>AI Key 未配置时，项目识别、问题生成和报告生成会失败。</li>
          <li>ASR Key 未配置时，录音仍可保存，但转写和报告质量会受影响。</li>
          <li>
            LibreOffice 未配置时，PDF 预览不受影响；PPT/PPTX 只是不生成展示 PDF。
          </li>
          <li>
            如修改服务器环境变量，需要重启应用并确认 PM2 使用了最新环境。
          </li>
          <li>
            external 模式需要 Web 和 Worker 两个进程；Worker 心跳失效时转写会停留在队列中。
          </li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        title="常用运维命令"
        description="用于服务器部署、诊断和回滚前检查。只展示命令，不会自动执行。"
      >
        <CommandList commands={operationsCommands} />
      </CollapsibleSection>

      <CollapsibleSection
        title="基础运行检查"
        description="不调用大模型、不转写音频，只检查基础依赖是否可用。"
      >
        <ConfigRow
          label="数据库连接"
          value={databaseCheck.value}
          ok={databaseCheck.ok}
          note={databaseCheck.ok ? undefined : databaseCheck.note}
        />
        <ConfigRow
          label="上传目录"
          value={uploadDirectoryCheck.value}
          ok={uploadDirectoryCheck.ok}
          note={uploadDirectoryCheck.ok ? undefined : uploadDirectoryCheck.note}
        />
        <ConfigRow
          label="后台 Worker"
          value={backgroundWorkerCheck.value}
          ok={backgroundWorkerCheck.ok}
          note={backgroundWorkerCheck.ok ? undefined : backgroundWorkerCheck.note}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="最近诊断事件"
        description="记录 AI、ASR、PPT 预览和系统测试中的最近异常或测试结果。"
      >
        {diagnosticEvents.length > 0 ? (
          <div className="grid gap-3">
            {diagnosticEvents.map((event, index) => (
              <div
                key={`${event.ts}-${index}`}
                className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                      {event.type}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(event.ts).toLocaleString("zh-CN")}
                    </span>
                  </div>
                </div>
                <p className="mt-2 break-words text-sm leading-6 text-slate-700">
                  {event.message}
                </p>
                {event.meta ? (
                  <pre className="mt-2 overflow-x-auto rounded-md border border-slate-100 bg-white px-3 py-2 text-xs leading-5 text-slate-500">
                    {JSON.stringify(event.meta, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            暂无诊断事件。
          </p>
        )}
      </CollapsibleSection>
    </>
  );
}
