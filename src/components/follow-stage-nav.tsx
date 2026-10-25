"use client";
import Link from "next/link";
import { useState } from "react";
import { useFollowEditState } from "@/app/(app)/orders/follow-edit-state";
export function FollowStageNav({ sheetId, current, rows }: { sheetId: string; current: number; rows: Array<{ rowId?: string; styleCode: string; styleName: string }> }) {
  const edits = useFollowEditState(), [message, setMessage] = useState("");
  return <nav className="flex flex-wrap gap-3 text-sm" aria-label="选择款式用料">{rows.length > 1 ? rows.map((row, i) => <Link key={row.rowId || i} className={i === current ? "font-semibold underline" : "underline"} href={`/orders/follow/${sheetId}?row=${i}#stage-materials`} onClick={e => { if (edits?.dirty || edits?.stageEditing) { e.preventDefault(); setMessage("请先保存或取消当前修改，再切换款式"); } }}>{row.styleCode || row.styleName || `第 ${i + 1} 款`}</Link>) : null}{message ? <p role="status">{message}</p> : null}</nav>;
}
