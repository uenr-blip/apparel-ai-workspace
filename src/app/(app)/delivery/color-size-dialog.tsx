"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ProductionBoardRow } from "@/server/services/production-board";
import { BoardDialog } from "./board-dialog";
import { ColorSizeNestedTable } from "./color-size-table";

export function ColorSizeDialog({ row }: { row: ProductionBoardRow }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  return (
    <>
      <Button type="button" size="sm" variant="secondary" aria-label={`${row.orderNo} 色尺`} onClick={() => setOpen(true)}>
        色尺
      </Button>
      <BoardDialog
        open={open}
        title={`${row.orderNo} 色尺`}
        note={row.colorSize.note}
        titleId={titleId}
        closeLabel="关闭色尺弹窗"
        onClose={() => setOpen(false)}
      >
        {row.colorSize.matrix.length ? (
          <ColorSizeNestedTable
            colorSize={row.colorSize}
            orderTotals={{ started: row.started, good: row.good, shipped: row.shipped, leftover: row.leftover }}
          />
        ) : (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            这一单还没有颜色件数。{" "}
            <Link href={`/orders/${row.orderId}`} className="text-[var(--brand-strong)]">
              打开订单补色尺
            </Link>
          </p>
        )}
        <p className="mt-4 text-xs text-[var(--ink-muted)]">
          本单产量合计：投产 {row.started} · 报废 {row.scrapped} · 在制 {row.wip} · 合格 {row.good} · 发运 {row.shipped} · 余货 {row.leftover}。
        </p>
      </BoardDialog>
    </>
  );
}
