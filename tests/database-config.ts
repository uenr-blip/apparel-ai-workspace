import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import path from "node:path";

// Resolve once, without inheriting an application's DATABASE_URL. Never reset dev.db.
const projectRoot = realpathSync(process.cwd());
const databaseDirectory = path.join(projectRoot, "prisma", "prisma");
mkdirSync(databaseDirectory, { recursive: true });
if (realpathSync(databaseDirectory) !== databaseDirectory) throw new Error("测试库目录不允许链接到工作区外");
const databasePath = path.join(databaseDirectory, "test.db");
if (existsSync(databasePath) && lstatSync(databasePath).isSymbolicLink()) throw new Error("测试库不能是符号链接");
closeSync(openSync(databasePath, "a"));
export const TEST_DATABASE_URL = `file:${databasePath}`;
