import { z } from "zod";

export const DEMO_PASSWORD = "DemoPass!2026";
export type LoginPolicy = { mode: "demo" } | { mode: "pilot"; emails: string[] };

export function normalizeLoginEmail(value: string) {
  return value.trim().toLowerCase();
}

export function getLoginPolicy(): LoginPolicy {
  if (process.env.PILOT_LOGIN_ENABLED === "true") {
    if (process.env.DEMO_LOGIN_ENABLED === "true") throw new Error("试用登录不能同时启用演示登录");
    const secret = process.env.SESSION_SECRET ?? "";
    if (secret.length < 32 || /change-me|replace-me|example/i.test(secret)) {
      throw new Error("试用环境需要独立的至少32位会话密钥");
    }
    let origin: URL;
    try { origin = new URL(process.env.APP_URL ?? ""); } catch { throw new Error("试用环境需要配置 HTTPS 访问地址"); }
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
      throw new Error("试用环境需要配置 HTTPS 根地址");
    }
    const emails = [...new Set((process.env.PILOT_LOGIN_EMAILS ?? "").split(",").map(normalizeLoginEmail).filter(Boolean))];
    if (!emails.length || emails.length > 50 || emails.some(email => !z.email().safeParse(email).success || email.endsWith("@demo.local"))) {
      throw new Error("请配置明确的试用账号名单，不能使用演示账号");
    }
    return { mode: "pilot", emails };
  }
  if (process.env.NODE_ENV === "production") throw new Error("生产环境禁止演示登录，请配置独立试用账号");
  if (process.env.DEMO_LOGIN_ENABLED !== "true") throw new Error("登录尚未启用");
  return { mode: "demo" };
}

export function getLoginPresentation(): "demo" | "pilot" | "disabled" {
  try { return getLoginPolicy().mode; } catch { return "disabled"; }
}

export function validatePilotPassword(password: string) {
  if (password === DEMO_PASSWORD || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("试用口令至少12个字符、至多72字节，不能使用演示口令");
  }
}
