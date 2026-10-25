import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Fresh installations only. Never migrate, seed, or reset an existing business DB.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (!existsSync(".env")) throw new Error("请先复制 .env.example 为 .env。");
process.loadEnvFile(".env");
if (process.env.DATABASE_URL !== "file:./prisma/dev.db") {
  throw new Error("首次演示初始化仅支持模板 DATABASE_URL；其他数据库请单独核验。");
}
const database = path.join(root, "prisma/prisma/dev.db");
mkdirSync(path.dirname(database), { recursive: true });
// wx refuses existing files, including symlinks. Do not delete data on failure.
closeSync(openSync(database, "wx", 0o600));
for (const args of [
  ["node_modules/prisma/build/index.js", "generate"],
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["--import", "tsx", "prisma/seed.ts"],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error("初始化未完成，保留现场供检查；不要对已有业务库重置或重复 seed。");
    process.exit(result.status ?? 1);
  }
}
console.log("演示库初始化完成。运行 npm run dev 后打开 http://localhost:3100。");
