import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createStyleMaster } from "@/server/services/style-create";
import { constructionForm } from "@/server/services/style-construction-http";
import { ExecutionError } from "@/server/services/execution";
import { tradeHttpError } from "@/server/services/trade-http";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { form, rows, uploads } = await constructionForm(request);
    const file = form.get("file");
    const result = await createStyleMaster({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      construction: rows,
      constructionUploads: uploads,
      code: String(form.get("code") ?? ""),
      name: String(form.get("name") ?? ""),
      category: String(form.get("category") ?? ""),
      silhouette: String(form.get("silhouette") ?? ""),
      designerId: String(form.get("designerId") ?? "") || null,
      brandOptionId: String(form.get("brandOptionId") ?? "") || null,
      categoryOptionId: String(form.get("categoryOptionId") ?? "") || null,
      typeOptionId: String(form.get("typeOptionId") ?? "") || null,
      yearOptionId: String(form.get("yearOptionId") ?? "") || null,
      seasonId: String(form.get("seasonId") ?? "") || null,
      bytes: file instanceof File && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : undefined,
      filename: file instanceof File ? file.name : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ExecutionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return tradeHttpError(error);
  }
}
