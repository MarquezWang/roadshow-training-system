import { randomUUID } from "node:crypto";
import { formatFileSize } from "@/lib/file-upload";
import { DeleteMaterialButton } from "./delete-material-button";
import { RegeneratePreviewButton } from "./regenerate-preview-button";

type ProjectMaterial = Readonly<{
  id: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  parseStatus: string;
  parseError: string | null;
  previewStatus: string;
  previewError: string | null;
  includeInAIContext: boolean;
  createdAt: Date;
}>;

const statusClass: Record<string, string> = {
  SUCCESS: "border-emerald-200 bg-emerald-50 text-emerald-800",
  FAILED: "border-rose-200 bg-rose-50 text-rose-800",
  PENDING: "border-amber-200 bg-amber-50 text-amber-800",
};

export function ProjectMaterialsPanel({
  projectId,
  files,
}: Readonly<{
  projectId: string;
  files: readonly ProjectMaterial[];
}>) {
  return (
    <section
      id="project-materials"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">项目材料</h2>
          <p className="mt-1 text-sm text-slate-600">
            管理参与 AI 分析的 PDF、PPTX、DOCX 和 TXT 文件。
          </p>
        </div>
        <form
          action={`/projects/${projectId}/files`}
          method="post"
          encType="multipart/form-data"
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input type="hidden" name="idempotencyKey" value={`material:${randomUUID()}`} />
          <input
            type="file"
            name="file"
            accept=".pdf,.pptx,.docx,.txt"
            required
            className="block max-w-xs text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
          />
          <button
            type="submit"
            className="h-10 rounded-md bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800"
          >
            上传并解析
          </button>
        </form>
      </div>

      {files.length === 0 ? (
        <p className="mt-5 rounded-md bg-slate-50 px-4 py-5 text-sm text-slate-600">
          当前没有项目材料。
        </p>
      ) : (
        <ul className="mt-5 grid gap-3">
          {files.map((file) => (
            <li key={file.id} className="rounded-md border border-slate-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950">
                    {file.originalName}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 px-2 py-1 uppercase text-slate-600">
                      {file.fileType}
                    </span>
                    <span className="rounded-full border border-slate-200 px-2 py-1 text-slate-600">
                      {formatFileSize(file.fileSize)}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-1 ${statusClass[file.parseStatus] ?? statusClass.PENDING}`}
                    >
                      解析：{file.parseStatus}
                    </span>
                    <span className="rounded-full border border-slate-200 px-2 py-1 text-slate-600">
                      AI：{file.includeInAIContext ? "已纳入" : "已排除"}
                    </span>
                  </div>
                  {file.parseError ? (
                    <p className="mt-2 text-xs leading-5 text-rose-700">
                      {file.parseError}
                    </p>
                  ) : null}
                  {file.previewStatus === "FAILED" && file.previewError ? (
                    <p className="mt-1 text-xs leading-5 text-amber-700">
                      预览：{file.previewError}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {file.parseStatus !== "SUCCESS" ? (
                    <form
                      action={`/projects/${projectId}/files/${file.id}/parse`}
                      method="post"
                    >
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        重新解析
                      </button>
                    </form>
                  ) : null}
                  {file.fileType === "pptx" && file.previewStatus !== "READY" ? (
                    <RegeneratePreviewButton fileId={file.id} />
                  ) : null}
                  <form
                    action={`/projects/${projectId}/files/${file.id}/toggle-context`}
                    method="post"
                  >
                    <button
                      type="submit"
                      disabled={file.parseStatus !== "SUCCESS"}
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      {file.includeInAIContext ? "排除 AI" : "纳入 AI"}
                    </button>
                  </form>
                  <DeleteMaterialButton
                    projectId={projectId}
                    fileId={file.id}
                    fileName={file.originalName}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
