"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type TrainingRecordItem = Readonly<{
  id: string;
  statusLabel: string;
  statusClassName: string;
  createdAtText: string;
  durationText: string;
  pageText: string;
  trainingHref: string;
  replayHref: string;
  deleteUrl: string;
}>;

type TrainingRecordsPanelProps = Readonly<{
  records: TrainingRecordItem[];
}>;

const COLLAPSED_COUNT = 5;

export function TrainingRecordsPanel({ records }: TrainingRecordsPanelProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [recordPendingDeletion, setRecordPendingDeletion] =
    useState<TrainingRecordItem | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const hasMoreRecords = records.length > COLLAPSED_COUNT;
  const visibleRecords = isExpanded ? records : records.slice(0, COLLAPSED_COUNT);

  async function deleteRecord(record: TrainingRecordItem) {
    setDeletingRecordId(record.id);
    setDeleteError("");

    try {
      const response = await fetch(record.deleteUrl, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "删除训练记录失败。");
      }

      setRecordPendingDeletion(null);
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除训练记录失败。");
    } finally {
      setDeletingRecordId(null);
    }
  }

  return (
    <>
      {recordPendingDeletion ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-training-record-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[2px]"
        >
          <div className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="px-5 pb-3 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3
                    id="delete-training-record-title"
                    className="text-lg font-semibold text-slate-950"
                  >
                    删除这次训练记录？
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {recordPendingDeletion.createdAtText} 的训练将被永久删除。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRecordPendingDeletion(null);
                    setDeleteError("");
                  }}
                  disabled={deletingRecordId === recordPendingDeletion.id}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xl leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
                  aria-label="关闭删除确认"
                >
                  ×
                </button>
              </div>

              {deleteError ? (
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {deleteError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 px-5 pb-5 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => void deleteRecord(recordPendingDeletion)}
                disabled={deletingRecordId === recordPendingDeletion.id}
                className="inline-flex h-10 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-semibold text-white shadow-sm shadow-red-600/20 transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                {deletingRecordId === recordPendingDeletion.id
                  ? "删除中..."
                  : "确认删除"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecordPendingDeletion(null);
                  setDeleteError("");
                }}
                disabled={deletingRecordId === recordPendingDeletion.id}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section
        id="records"
        className="mt-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">训练记录</h2>
          <p className="text-sm text-slate-600">
            按时间倒序展示，默认先看最近 5 次。
          </p>
        </div>
        <span className="text-sm font-medium text-slate-500">
          共 {records.length} 次
        </span>
      </div>

      {records.length > 0 ? (
        <>
          <div className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {visibleRecords.map((record) => (
              <article
                key={record.id}
                className="grid gap-4 p-4 transition-colors hover:bg-slate-50 lg:grid-cols-[minmax(0,1fr)_320px]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${record.statusClassName}`}
                    >
                      {record.statusLabel}
                    </span>
                    <time className="text-sm font-medium text-slate-900">
                      {record.createdAtText}
                    </time>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                    <p>
                      <span className="text-slate-400">路演用时</span>
                      <span className="ml-2 font-medium text-slate-900">
                        {record.durationText}
                      </span>
                    </p>
                    <p>
                      <span className="text-slate-400">当前页码</span>
                      <span className="ml-2 font-medium text-slate-900">
                        {record.pageText}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Link
                    href={record.trainingHref}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-medium text-white transition-colors hover:bg-teal-800"
                  >
                    查看训练
                  </Link>
                  <Link
                    href={record.replayHref}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    路演回放
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setRecordPendingDeletion(record);
                      setDeleteError("");
                    }}
                    disabled={deletingRecordId === record.id}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  >
                    {deletingRecordId === record.id ? "删除中" : "删除"}
                  </button>
                </div>
              </article>
            ))}
          </div>

          {hasMoreRecords ? (
            <div className="mt-4 flex items-center justify-center">
              <button
                type="button"
                onClick={() => setIsExpanded((current) => !current)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                {isExpanded
                  ? "收起记录"
                  : `展开全部 ${records.length} 次训练记录`}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
          <h3 className="text-sm font-semibold text-slate-950">
            还没有训练记录
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            点击上方“开始路演训练”创建第一次模拟路演。
          </p>
        </div>
      )}
      </section>
    </>
  );
}
