import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createDevelopmentProject } from "@/server/services/development-create";
import { ExecutionError } from "@/server/services/execution";

const Schema = z.object({
  name: z.string(),
  styleId: z.string().optional(),
  materialIds: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写项目名称" }, { status: 400 });
  try {
    const result = await createDevelopmentProject({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "新建开发失败";
    const status = error instanceof ExecutionError && /无权/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
