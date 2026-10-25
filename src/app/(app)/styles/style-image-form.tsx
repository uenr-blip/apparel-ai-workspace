"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileWell } from "@/components/file-well";
import { Button } from "@/components/ui/button";

export function StyleImageForm({ styleId, canEdit }: { styleId: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(formData: FormData) {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/styles/${styleId}/image`, {
      method: "POST",
      body: formData,
    });
    const body = (await response.json()) as { error?: string; message?: string; recognized?: boolean };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "保存失败");
      return;
    }
    setMessage(body.message || "已换图，未识款");
    router.refresh();
  }

  if (!canEdit) {
    return <p className="mt-2 text-xs text-[var(--ink-muted)]">当前角色不能换图。</p>;
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
        id="style-image-file"
        label="款式图"
        hint="JPG / PNG，最大 5MB"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "保存中" : "保存款式图"}
      </Button>
      <p className="text-xs text-[var(--ink-muted)]">
        挂在这一款上，换图不是新款。只存附件，不会识款，也不能替代颜色、手感、版型终审。不必先填品牌、品类或年份。
      </p>
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
    </form>
  );
}
