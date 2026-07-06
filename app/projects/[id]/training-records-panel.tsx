"use client";

import Link from "next/link";
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
}>;

type TrainingRecordsPanelProps = Readonly<{
  records: TrainingRecordItem[];
}>;

const COLLAPSED_COUNT = 5;

export function TrainingRecordsPanel({ records }: TrainingRecordsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMoreRecords = records.length > COLLAPSED_COUNT;
  const visibleRecords = isExpanded ? records : records.slice(0, COLLAPSED_COUNT);

  return (
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
                className="grid gap-4 p-4 transition-colors hover:bg-slate-50 lg:grid-cols-[minmax(0,1fr)_220px]"
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

                <div className="flex items-center gap-2 lg:justify-end">
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
  );
}
