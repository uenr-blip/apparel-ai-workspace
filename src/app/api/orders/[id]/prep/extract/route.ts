import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { extractOrderPrep } from "@/server/services/order-prep";

const Schema = z.object({
  text: z.string().min(2),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请粘贴客户补充消息" }, { status: 400 });
  try {
    const result = await extractOrderPrep({
      organizationId: session.organizationId,
      orderId: id,
      text: parsed.data.text,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "提取失败" }, { status: 400 });
  }
}
