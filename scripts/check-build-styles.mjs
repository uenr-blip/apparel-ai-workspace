import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Check the emitted CSS, not just HTTP status or presence of a stylesheet. */
export function assertCompiledStyles(chunks) {
  const css = chunks.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@(?:tailwind|theme|source|utility|apply|variant|custom-variant)\b/.test(css)) {
    throw new Error("Uncompiled Tailwind directives in production CSS; check PostCSS configuration.");
  }
  const selectors = [".flex", ".grid", ".hidden", ".min-h-screen", ".w-full", ".md\\:flex", ".md\\:hidden"];
  for (const selector of selectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`${escaped}\\s*\\{`).test(css)) {
      throw new Error(`Required layout utility missing from production CSS: ${selector}`);
    }
  }
  if (!/--paper\s*:/.test(css) || !/\.app-frame\b/.test(css)) {
    throw new Error("Application theme/layout CSS is missing.");
  }
  return { cssBytes: Buffer.byteLength(css), requiredLayoutUtilities: selectors.length };
}

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? cssFiles(location) : entry.name.endsWith(".css") ? [location] : [];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2] || ".next/static/css");
  const files = cssFiles(directory);
  if (!files.length) throw new Error("No production stylesheets emitted.");
  const result = assertCompiledStyles(files.map(file => readFileSync(file, "utf8")));
  console.log(JSON.stringify({ state: "BUILD_CSS_OK", files: files.length, ...result }));
}
