import { prisma } from "@/lib/db";
import { readPrivateFile } from "@/server/storage/local";
import { requireTrade } from "@/server/services/trade-db";
import { tradeSession, tradeHttpError } from "@/server/services/trade-http";
import { TradeError } from "@/lib/trade-money";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await tradeSession(); await requireTrade(actor);
    const { id } = await context.params;
    const [doc] = await prisma.$queryRaw<Array<{ filename: string | null; storagePath: string | null; mimeType: string | null }>>`SELECT filename,storagePath,mimeType FROM TradeDocument WHERE organizationId=${actor.organizationId} AND id=${id}`;
    if (!doc?.storagePath || !doc.mimeType || !doc.filename) throw new TradeError("附件不存在或未登记", 404);
    const inline = new URL(request.url).searchParams.get("preview") === "1" && ["application/pdf", "image/jpeg", "image/png"].includes(doc.mimeType);
    const bytes = await readPrivateFile(doc.storagePath);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": doc.mimeType, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return tradeHttpError(error); }
}
