import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { attachStylePatternFile } from "@/server/services/style-process";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择版次文件" }, { status: 400 });
  }
  try {
    const result = await attachStylePatternFile({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      styleId: id,
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 400 });
  }
}
