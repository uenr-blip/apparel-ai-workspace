import { boundedBody, checkTradeOrigin } from "./trade-http";
import { parseConstruction, type ConstructionUpload } from "./style-construction";

export async function constructionForm(request: Request) {
  checkTradeOrigin(request);
  const bytes = await boundedBody(request, 26 * 1024 * 1024);
  const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
  const rows = parseConstruction(JSON.parse(String(form.get("construction") || "[]")));
  const uploads: ConstructionUpload[] = [];
  for (const [key, file] of form.entries()) {
    if (key.startsWith("construction-image-") && file instanceof File && file.size) uploads.push({ key: key.slice("construction-image-".length), bytes: Buffer.from(await file.arrayBuffer()), name: file.name });
  }
  return { form, rows, uploads };
}
