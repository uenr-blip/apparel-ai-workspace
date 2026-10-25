import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function storageRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_ROOT ?? path.join(process.cwd(), "storage"));
}

export function resolveStoredPath(relativePath: string) {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("非法存储路径");
  }
  const root = storageRoot();
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("非法存储路径");
  }
  return resolved;
}

export async function putPrivateFile(relativePath: string, bytes: Buffer) {
  const absolutePath = resolveStoredPath(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return absolutePath;
}

export async function readPrivateFile(relativePath: string) {
  return readFile(/* turbopackIgnore: true */ resolveStoredPath(relativePath));
}

export async function deletePrivateFile(relativePath: string) {
  try {
    await unlink(resolveStoredPath(relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
