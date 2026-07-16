"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegeneratePreviewButton({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function regenerate() {
    setRunning(true);
    try {
      const response = await fetch(`/api/files/${fileId}/preview`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { previewError?: string; error?: string }
          | null;
        window.alert(data?.previewError || data?.error || "预览生成失败。");
      }
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  return (
    <button
      type="button"
      onClick={regenerate}
      disabled={running}
      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
    >
      {running ? "生成中…" : "重新生成预览"}
    </button>
  );
}
