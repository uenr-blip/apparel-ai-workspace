import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createHash, randomUUID } from "node:crypto";
import { DEMO_PASSWORD, getLoginPolicy, normalizeLoginEmail } from "@/lib/login-policy";

const COOKIE = "apparel_session";
// The pilot runs one application process. Reserve an account before async work;
// failed attempts also live in AuditEvent so a restart does not clear the limit.
const pilotLoginsInFlight = new Set<string>();
const credentialVersion = (hash: string) => createHash("sha256").update(hash).digest("hex");

export type SessionUser = {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: string;
  factoryId: string | null;
};

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error("SESSION_SECRET 未配置或过短");
  }
  return new TextEncoder().encode(value);
}

export async function createSession(user: SessionUser, verifiedPasswordHash?: string) {
  let version: string | undefined;
  let currentUser = user;
  if (process.env.PILOT_LOGIN_ENABLED === "true" || process.env.NODE_ENV === "production") {
    const policy = getLoginPolicy();
    const current = await prisma.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, active: true } });
    if (policy.mode !== "pilot" || !current || !policy.emails.includes(normalizeLoginEmail(current.email))) throw new Error("账号未获准试用");
    if (verifiedPasswordHash && current.passwordHash !== verifiedPasswordHash) throw new Error("账号资料已更新，请重新登录");
    version = credentialVersion(current.passwordHash);
    currentUser = { id: current.id, organizationId: current.organizationId, email: current.email, name: current.name, role: current.role, factoryId: current.factoryId };
  }
  const token = await new SignJWT({ ...currentUser, ...(version ? { credentialVersion: version } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production" || process.env.PILOT_LOGIN_ENABLED === "true",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.id !== "string" || typeof payload.organizationId !== "string") return null;
    const current = await prisma.user.findFirst({
      where: { id: payload.id, organizationId: payload.organizationId, active: true },
      select: { id: true, organizationId: true, email: true, name: true, role: true, factoryId: true, passwordHash: true },
    });
    if (!current) return null;
    if (process.env.PILOT_LOGIN_ENABLED === "true" || process.env.NODE_ENV === "production") {
      const policy = getLoginPolicy();
      if (policy.mode !== "pilot" || !policy.emails.includes(normalizeLoginEmail(current.email)) || payload.credentialVersion !== credentialVersion(current.passwordHash)) return null;
    }
    return { id: current.id, organizationId: current.organizationId, email: current.email, name: current.name, role: current.role, factoryId: current.factoryId };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function loginWithPassword(email: string, password: string) {
  const policy = getLoginPolicy();
  email = normalizeLoginEmail(email);
  if (email.length > 254 || !password || Buffer.byteLength(password, "utf8") > 72) throw new Error("账号或密码不正确");
  if (policy.mode === "pilot" && !policy.emails.includes(email)) throw new Error("账号或密码不正确");
  const { compare } = await import("bcryptjs");
  if (policy.mode === "pilot") {
    if (pilotLoginsInFlight.has(email)) throw new Error("登录请求处理中，请稍后再试");
    pilotLoginsInFlight.add(email);
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) throw new Error("账号或密码不正确");
    if (policy.mode === "pilot") {
      const attempts = await prisma.auditEvent.count({ where: {
        organizationId: user.organizationId, entityType: "User", entityId: user.id,
        action: "auth.pilot_login_failed", createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
      } });
      if (attempts >= 5) throw new Error("尝试次数过多，请15分钟后再试");
    }
    const valid = await compare(password, user.passwordHash);
    if (!valid || (policy.mode === "pilot" && (password === DEMO_PASSWORD || password.length < 12))) {
      if (policy.mode === "pilot") await prisma.auditEvent.create({ data: {
        id: randomUUID(), organizationId: user.organizationId, actorType: "anonymous", actorUserId: null,
        action: "auth.pilot_login_failed", entityType: "User", entityId: user.id,
        summary: "试用账号登录校验失败", payloadJson: JSON.stringify({ outcome: "denied" }),
      } });
      throw new Error("账号或密码不正确");
    }
    const session: SessionUser = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      role: user.role,
      factoryId: user.factoryId,
    };
    await createSession(session, user.passwordHash);
    if (policy.mode === "pilot") {
      try {
        await prisma.auditEvent.create({ data: {
          id: randomUUID(), organizationId: user.organizationId, actorType: "user", actorUserId: user.id,
          action: "auth.pilot_login", entityType: "User", entityId: user.id,
          summary: "试用账号通过口令校验", payloadJson: JSON.stringify({ before: null, after: { authenticated: true }, basis: "password_and_allowlist" }),
        } });
      } catch (error) {
        await clearSession();
        throw error;
      }
    }
    return session;
  } finally {
    if (policy.mode === "pilot") pilotLoginsInFlight.delete(email);
  }
}
