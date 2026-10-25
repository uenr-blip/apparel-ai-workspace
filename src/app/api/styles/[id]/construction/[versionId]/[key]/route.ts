import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readConstructionImage } from "@/server/services/style-construction";
export async function GET(_request: Request, context: { params: Promise<{ id: string; versionId: string; key: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { id, versionId, key } = await context.params;
    const image = await readConstructionImage({ organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId, styleId: id, versionId, key });
    return new NextResponse(Uint8Array.from(image.bytes), { headers: { "Content-Type": image.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "图片不存在或无权查看" }, { status: 404 }); }
}
