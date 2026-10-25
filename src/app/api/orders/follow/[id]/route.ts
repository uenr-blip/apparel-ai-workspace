import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { saveFollowSheet } from "@/server/services/order-merch";

const Schema = z.object({
  expectedUpdatedAt: z.string(),
  idempotencyKey: z.string().min(1),
  seasonCode: z.unknown().optional(),
  factoryName: z.string().optional(),
  factoryId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  styles: z.array(z.unknown()).max(40),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { checkTradeOrigin(request); } catch { return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 }); }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(JSON.parse((await boundedBody(request,120000)).toString("utf8")));
  if (!parsed.success) return NextResponse.json({ error: "销售样和大货没有提交完整" }, { status: 400 });
  try {
    const result = await saveFollowSheet({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      sheetId: id,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
