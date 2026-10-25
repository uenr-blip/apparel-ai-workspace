"use client";

import Link from "next/link";
import { BulkMasterBoard } from "./bulk-master-board";
import type { FollowProductLists } from "@/server/services/order-merch";

export function FollowProductList({ lists, side, viewerKey }: { lists: FollowProductLists; side: "sales" | "bulk"; viewerKey?: string }) {
  return <><BulkMasterBoard lists={lists} side={side} viewerKey={viewerKey} />{lists.emptySheets.filter(sheet => side === "sales" ? sheet.kindLabel === "销售样" : sheet.kindLabel !== "销售样").map(sheet => <p key={sheet.id} className="mt-3 text-sm"><Link href={sheet.href} className="text-[var(--brand-strong)]">{sheet.title}</Link> · 尚未填写款式</p>)}</>;
}
