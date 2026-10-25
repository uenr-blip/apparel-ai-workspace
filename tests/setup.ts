import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { TEST_DATABASE_URL } from "./database-config";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.UPLOAD_ROOT = mkdtempSync(path.join(tmpdir(), "yiju-test-uploads-"));
process.env.AI_MODE = "mock";
process.env.AI_PROVIDER = "mock-rules";
process.env.DEMO_LOGIN_ENABLED = "true";
process.env.SESSION_SECRET = "test-session-secret-32chars-minimum";
process.env.DEMO_CLOCK = "2026-09-18T09:00:00+08:00";
process.env.DEMO_TIMEZONE = "Asia/Shanghai";
process.env.PRISMA_SCHEMA_PATH = path.resolve("prisma/schema.prisma");

process.env.AGENT_MODE = "mock";

process.env.AI_IMAGE_MODE = "mock";
process.env.ASR_MODE = "mock";
