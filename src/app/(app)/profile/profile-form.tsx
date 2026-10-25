"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileWell } from "@/components/file-well";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProfileForm({
  name,
  email,
  roleLabel,
  avatarSrc,
}: {
  name: string;
  email: string;
  roleLabel: string;
  avatarSrc: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"name" | "avatar" | "">("");
  const [message, setMessage] = useState("");

  async function saveName(formData: FormData) {
    setPending("name");
    setMessage("");
    const response = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: String(formData.get("name") ?? "") }),
    });
    const body = (await response.json()) as { error?: string };
    setPending("");
    if (!response.ok) {
      setMessage(body.error || "保存失败");
      return;
    }
    setMessage("显示名已更新");
    router.refresh();
  }

  async function saveAvatar(formData: FormData) {
    setPending("avatar");
    setMessage("");
    const response = await fetch("/api/me/avatar", { method: "POST", body: formData });
    const body = (await response.json()) as { error?: string };
    setPending("");
    if (!response.ok) {
      setMessage(body.error || "保存失败");
      return;
    }
    setMessage("头像已更新，不识人");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <form
        className="flex items-center gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void saveAvatar(new FormData(event.currentTarget));
        }}
      >
        <span className="relative flex h-16 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--brand)] text-lg font-semibold text-[var(--on-brand)]">
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarSrc} alt="" data-no-zoom="true" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">{name.slice(0, 1)}</span>
          )}
        </span>
        <FileWell
          compact
          className="min-w-0 flex-1"
          label="头像"
          hint="JPG / PNG，最大 5MB"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          required
        />
        <Button type="submit" size="sm" disabled={pending === "avatar"}>
          {pending === "avatar" ? "保存中" : "换头像"}
        </Button>
      </form>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void saveName(new FormData(event.currentTarget));
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">显示名</span>
          <Input name="name" defaultValue={name} maxLength={40} required />
        </label>
        <p className="text-sm">
          <span className="block text-xs text-[var(--ink-muted)]">登录邮箱</span>
          {email}
        </p>
        <p className="text-sm">
          <span className="block text-xs text-[var(--ink-muted)]">角色</span>
          {roleLabel}
        </p>
        <Button type="submit" size="sm" disabled={pending === "name"}>
          {pending === "name" ? "保存中" : "保存显示名"}
        </Button>
      </form>
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
    </div>
  );
}
