import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchKnowledge } from "@/server/services/reuse";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q") || "";
  if (query.trim().length < 2) return NextResponse.json({ error: "请输入检索条件" }, { status: 400 });
  const result = await searchKnowledge({ organizationId: session.organizationId, query });
  return NextResponse.json(result);
}
