import Link from "next/link";
import { requireAdminUser } from "@/lib/auth-server";
import { SystemConfigSections } from "./system-config-sections";
import { SystemOperationsSections } from "./system-operations-sections";
import { SystemOverviewSection } from "./system-overview-section";
import { loadSystemStatusData } from "./system-status-data";
import { SystemTestPanel } from "./system-test-panel";
import { UploadMaintenancePanel } from "./upload-maintenance-panel";

export const dynamic = "force-dynamic";

export default async function AdminSystemPage() {
  await requireAdminUser();
  const status = await loadSystemStatusData();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">管理员工具</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            系统状态
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            只读查看关键外部依赖与环境配置，不展示密钥明文。
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          返回
        </Link>
      </div>

      <div className="mt-6 grid gap-6">
        <SystemTestPanel />
        <UploadMaintenancePanel />
        <SystemOverviewSection
          configuration={status.configuration}
          libreOffice={status.libreOffice}
          runtimeVersion={status.runtimeVersion}
        />
        <SystemConfigSections
          configuration={status.configuration}
          libreOffice={status.libreOffice}
        />
        <SystemOperationsSections
          backgroundWorkerCheck={status.backgroundWorkerCheck}
          databaseCheck={status.databaseCheck}
          diagnosticEvents={status.diagnosticEvents}
          uploadDirectoryCheck={status.uploadDirectoryCheck}
        />
      </div>
    </main>
  );
}
