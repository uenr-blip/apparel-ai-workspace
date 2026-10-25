import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { saveStyleProcessDraft } from "@/server/services/style-process";

const Schema = z.object({
  processNotes: z.string(),
  patternRevision: z.string(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写工艺说明或版次" }, { status: 400 });
  try {
    const result = await saveStyleProcessDraft({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      styleId: id,
      processNotes: parsed.data.processNotes,
      patternRevision: parsed.data.patternRevision,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
