import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getFactoryTransferBoard } from "@/server/services/factory-transfer";
import { TransferForm } from "./form";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession(); if (!["manager", "salesperson"].includes(user.role)) notFound();
  const board = await getFactoryTransferBoard({ organizationId: user.organizationId, userId: user.id, role: user.role }, (await params).id);
  return <div className="space-y-5"><PageHeader eyebrow="生产交接" title={`${board.order.orderNo} · 转厂`} description={`客户 PO：${board.order.po || "未填"} · 原厂：${board.order.factoryName}`} actions={<Link className="underline text-sm" href={`/orders/${board.order.id}`}>返回生产订单</Link>} /><Card className="sheet-pad"><TransferForm board={board} manager={user.role === "manager"} /></Card></div>;
}
