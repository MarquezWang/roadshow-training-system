"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteMaterialButton({
  projectId,
  fileId,
  fileName,
}: {
  projectId: string;
  fileId: string;
  fileName: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!window.confirm(`确定删除材料“${fileName}”吗？`)) return;
    setDeleting(true);
    try {
      const response = await fetch(
        `/projects/${projectId}/files/${fileId}/remove`,
        { method: "POST" },
      );
      if (!response.ok) {
        window.alert("材料删除失败或已被训练记录引用。");
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={deleting}
      className="rounded-md border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-rose-300"
    >
      {deleting ? "删除中…" : "删除"}
    </button>
  );
}
