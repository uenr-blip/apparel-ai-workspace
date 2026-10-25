"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileWell } from "@/components/file-well";
import { Button } from "@/components/ui/button";

export function MaterialImageForm({ materialId, canEdit }: { materialId: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(formData: FormData) {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/materials/${materialId}/image`, {
      method: "POST",
      body: formData,
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "保存失败");
      return;
    }
    setMessage(body.message || "已换色卡图，未识料");
    router.refresh();
  }

  if (!canEdit) {
    return <p className="mt-2 text-xs text-[var(--ink-muted)]">当前角色不能换材料图。</p>;
  }

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save(new FormData(event.currentTarget));
      }}
    >
      <FileWell
        id="material-image-file"
        label="色卡图"
        hint="JPG / PNG，最大 5MB"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "保存中" : "保存色卡图"}
      </Button>
      <p className="text-xs text-[var(--ink-muted)]">只存附件，不识料，也不能替代手感终审。有图不是库存。</p>
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
    </form>
  );
}
