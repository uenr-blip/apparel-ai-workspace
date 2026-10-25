import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { MaterialImageError, readMaterialImage, replaceMaterialImage } from "@/server/services/material-image";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    const image = await readMaterialImage({ organizationId: session.organizationId, materialId: id });
    return new NextResponse(Uint8Array.from(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof MaterialImageError ? error.message : "读取失败";
    const status = message.includes("不存在") || message.includes("还没有") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择 JPG 或 PNG" }, { status: 400 });
  }
  try {
    const result = await replaceMaterialImage({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      materialId: id,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
