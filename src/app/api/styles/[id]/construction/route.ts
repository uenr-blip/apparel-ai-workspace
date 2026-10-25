import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveStyleConstruction } from "@/server/services/style-construction";
import { constructionForm } from "@/server/services/style-construction-http";
import { ExecutionError } from "@/server/services/execution";
import { tradeHttpError } from "@/server/services/trade-http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { form, rows, uploads } = await constructionForm(request);
    const { id } = await context.params;
    return NextResponse.json(await saveStyleConstruction({ organizationId: session.organizationId, userId: session.id, role: session.role, styleId: id, expectedStamp: String(form.get("expectedStamp") || ""), rows, uploads }));
  } catch (error) {
    if (error instanceof ExecutionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return tradeHttpError(error);
  }
}
