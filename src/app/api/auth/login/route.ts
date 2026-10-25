import { NextResponse } from "next/server";
import { z } from "zod";
import { loginWithPassword } from "@/lib/auth";

const Schema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  if (process.env.PILOT_LOGIN_ENABLED === "true") {
    let expected: string;
    try { expected = new URL(process.env.APP_URL ?? "").origin; } catch { return NextResponse.json({ error: "登录尚未配置" }, { status: 503 }); }
    if (request.headers.get("origin") !== expected) return NextResponse.json({ error: "请从试用网站登录" }, { status: 403 });
  }
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }
  try {
    const user = await loginWithPassword(parsed.data.email, parsed.data.password);
    return NextResponse.json({ ok: true, role: user.role });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "登录失败" }, { status: 401 });
  }
}
