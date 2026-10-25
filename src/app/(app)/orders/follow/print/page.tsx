import { requireSession } from "@/lib/auth";
import { listFollowProducts } from "@/server/services/order-merch";
import { BulkMasterBoard } from "../../bulk-master-board";

export default async function FollowPrintPage({ searchParams }: { searchParams: Promise<{ sheet?: string; season?: string; factory?: string; q?: string; from?: string; to?: string; columns?: string }> }) {
  const session = await requireSession();
  const params = await searchParams;
  const lists = await listFollowProducts(session.organizationId, { role: session.role, factoryId: session.factoryId });
  return <BulkMasterBoard lists={lists} side={params.sheet === "sales" ? "sales" : "bulk"} printMode initial={{ ...params, query: params.q }} />;
}
