import { NextResponse } from "next/server";
import { tradeSession } from "@/server/services/trade-http";
import { readStageImage } from "@/server/services/workflow-stage";
export async function GET(_request: Request, context: { params: Promise<{ id: string; revisionId: string; key: string }> }) {
  try { const actor = await tradeSession(), p = await context.params, image = await readStageImage(actor, p.id, p.revisionId, p.key); return new NextResponse(Uint8Array.from(image.bytes), { headers: { "Content-Type": image.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
  catch { return NextResponse.json({ error: "图片不存在或无权查看" }, { status: 404 }); }
}
