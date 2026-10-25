import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { attachDesignAsset } from "@/server/services/design-studio";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "请选择 JPG 或 PNG 参考图" }, { status: 400 });
  }
  try {
    const result = await attachDesignAsset({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      projectId: id,
      bytes: Buffer.from(await file.arrayBuffer()),
      label: String(form.get("label") ?? file.name),
      note: String(form.get("note") ?? ""),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 400 });
  }
}
