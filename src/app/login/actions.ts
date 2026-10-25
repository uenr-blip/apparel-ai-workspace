"use server";

import { redirect } from "next/navigation";
import { loginWithPassword } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await loginWithPassword(email, password);
  } catch (error) {
    redirect(`/login?error=${encodeURIComponent(error instanceof Error ? error.message : "登录失败")}`);
  }
  redirect("/workspace");
}
