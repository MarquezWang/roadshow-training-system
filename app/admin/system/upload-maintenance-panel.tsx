"use client";

import { useState } from "react";

type MaintenanceOverview = {
  automaticMaintenanceEnabled: boolean;
  latestJob: {
    status: string;
    attempt: number;
    updatedAt: string;
    leaseExpiresAt: string | null;
    errorMessage: string | null;
  } | null;
  jobCounts: Record<string, number>;
  staleRunningCount: number;
  scan: {
    referencedFileCount: number;
    missingReferenceCount: number;
    unsafeReferenceCount: number;
    orphanFileCount: number;
    recentUnreferencedFileCount: number;
    staleTemporaryFileCount: number;
    staleAttemptDirectoryCount: number;
    staleTrashEntryCount: number;
    retentionHours: {
      orphan: number;
      temporary: number;
      attempt: number;
      trash: number;
    };
  } | null;
};

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function UploadMaintenancePanel() {
  const [overview, setOverview] = useState<MaintenanceOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(
    "点击“只读扫描”读取任务状态和上传目录概况。",
  );
  const [error, setError] = useState<string | null>(null);

  async function loadOverview(includeScan: boolean) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/system/upload-maintenance?scan=${includeScan ? "1" : "0"}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => ({}))) as
        | MaintenanceOverview
        | { error?: string };
      if (!response.ok || !("jobCounts" in data)) {
        throw new Error("error" in data ? data.error : "读取维护状态失败。");
      }
      setOverview(data);
      setMessage(includeScan ? "只读扫描已完成。" : "维护任务状态已更新。");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取维护状态失败。");
    } finally {
      setLoading(false);
    }
  }

  async function runMaintenance() {
    if (
      !window.confirm(
        "将清理超过保留期的孤儿文件、临时文件、失败尝试目录和回收站内容；仍被数据库引用的文件不会删除。确认继续吗？",
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    setMessage("正在执行上传目录维护...");
    try {
      const response = await fetch("/api/admin/system/upload-maintenance", {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        executionState?: string;
        deletedCount?: number;
        overview?: MaintenanceOverview;
      };
      if (!response.ok || !data.overview) {
        throw new Error(data.error || "上传目录维护执行失败。");
      }
      setOverview(data.overview);
      setMessage(
        data.executionState === "busy"
          ? "已有维护任务正在运行，本次没有重复执行。"
          : `维护完成，共清理 ${data.deletedCount ?? 0} 个过期条目。`,
      );
    } catch (maintenanceError) {
      setError(
        maintenanceError instanceof Error
          ? maintenanceError.message
          : "上传目录维护执行失败。",
      );
    } finally {
      setLoading(false);
    }
  }

  const scan = overview?.scan;
  const latestJob = overview?.latestJob;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            上传目录与异步任务治理
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            只读扫描不会修改文件；执行维护只清理超过保留期且未被数据库引用的条目，并修正已确认丢失的材料、预览和录音状态。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadOverview(true)}
            disabled={loading}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "处理中..." : "只读扫描"}
          </button>
          <button
            type="button"
            onClick={() => void runMaintenance()}
            disabled={loading}
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            执行清理
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full border px-2.5 py-1 ${
            overview?.automaticMaintenanceEnabled
              ? "border-teal-200 bg-teal-50 text-teal-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          自动维护：
          {overview?.automaticMaintenanceEnabled ? "已启用" : "未启用"}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
          最近任务：{latestJob?.status ?? "尚未运行"}
        </span>
        {latestJob ? (
          <span className="text-slate-400">
            {new Date(latestJob.updatedAt).toLocaleString("zh-CN")}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="运行中任务" value={overview?.jobCounts.RUNNING ?? 0} />
        <Metric label="等待重试" value={overview?.jobCounts.RETRY_WAIT ?? 0} />
        <Metric label="失败任务" value={overview?.jobCounts.FAILED ?? 0} />
        <Metric label="已完成任务" value={overview?.jobCounts.COMPLETED ?? 0} />
        <Metric label="过期租约" value={overview?.staleRunningCount ?? 0} />
      </div>

      {scan ? (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="有效文件引用" value={scan.referencedFileCount} />
            <Metric label="缺失引用" value={scan.missingReferenceCount} />
            <Metric label="过期孤儿文件" value={scan.orphanFileCount} />
            <Metric
              label="过期临时文件"
              value={scan.staleTemporaryFileCount}
            />
            <Metric
              label="过期尝试目录"
              value={scan.staleAttemptDirectoryCount}
            />
            <Metric label="过期回收站条目" value={scan.staleTrashEntryCount} />
            <Metric
              label="近期未引用文件"
              value={scan.recentUnreferencedFileCount}
            />
            <Metric label="不安全引用" value={scan.unsafeReferenceCount} />
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">
            保留期：孤儿 {scan.retentionHours.orphan} 小时、临时文件 {scan.retentionHours.temporary} 小时、失败尝试 {scan.retentionHours.attempt} 小时、回收站 {scan.retentionHours.trash} 小时。
          </p>
        </div>
      ) : null}

      <p
        className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
          error
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-100 bg-slate-50 text-slate-600"
        }`}
      >
        {error ?? message}
      </p>
      {latestJob?.errorMessage ? (
        <p className="mt-2 text-xs leading-5 text-rose-600">
          最近错误：{latestJob.errorMessage}
        </p>
      ) : null}
    </section>
  );
}
