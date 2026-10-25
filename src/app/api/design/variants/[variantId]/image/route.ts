import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { DesignStudioError, readDesignVariantImage } from "@/server/services/design-studio";

export async function GET(_request: Request, context: { params: Promise<{ variantId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { variantId } = await context.params;
  try {
    const image = await readDesignVariantImage({ organizationId: session.organizationId, variantId });
    return new NextResponse(Uint8Array.from(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof DesignStudioError ? error.message : "读取失败";
    return NextResponse.json({ error: message }, { status: message.includes("不存在") ? 404 : 400 });
  }
}
