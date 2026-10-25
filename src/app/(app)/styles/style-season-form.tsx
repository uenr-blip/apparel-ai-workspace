"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function StyleSeasonForm({
  styleId,
  linkedCodes,
  availableSeasons,
  canEdit,
}: {
  styleId: string;
  linkedCodes: string[];
  availableSeasons: Array<{ id: string; code: string; name: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const options = availableSeasons.filter((season) => !linkedCodes.includes(season.code));
  const [seasonId, setSeasonId] = useState(options[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/styles/${styleId}/seasons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seasonId }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "挂接失败");
      return;
    }
    setMessage(body.reused ? "已经挂过这个季节，未复制主档" : `已挂上 ${body.seasonCode}，未复制主档`);
    router.refresh();
  }

  if (!canEdit) {
    return <p className="text-sm text-[var(--ink-muted)]">当前角色不能挂接季节。</p>;
  }
  if (options.length === 0) {
    return <p className="text-sm text-[var(--ink-muted)]">没有可再挂的季节，或尚未配置季节主数据。</p>;
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="mb-1 block text-[var(--ink-muted)]">挂上季节（关系，不是新款号）</span>
        <select
          value={seasonId}
          onChange={(event) => setSeasonId(event.target.value)}
          className="h-10 rounded-lg border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
        >
          {options.map((season) => (
            <option key={season.id} value={season.id}>
              {season.code} {season.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" disabled={pending || !seasonId} onClick={() => void save()}>
        {pending ? "保存中" : "挂上季节"}
      </Button>
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
    </div>
  );
}
