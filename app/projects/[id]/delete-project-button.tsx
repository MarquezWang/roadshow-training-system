"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function deleteProject() {
    if (!window.confirm("确定删除该项目及其训练、录音和报告吗？此操作不可恢复。")) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/projects/${projectId}/delete`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        window.alert(data?.error || "项目删除失败。");
        return;
      }

      router.push("/projects");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={deleteProject}
      disabled={deleting}
      className="inline-flex h-10 items-center justify-center rounded-md border border-rose-300 bg-white px-4 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-rose-300"
    >
      {deleting ? "正在删除…" : "删除项目"}
    </button>
  );
}
