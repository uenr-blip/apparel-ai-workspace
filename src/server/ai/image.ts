import { getImageConfig, imageLiveConfigured } from "@/lib/ai-config";
import { responseBytes } from "./bounded-response";

export class ImageModelError extends Error {
  constructor(message: string) { super(message); this.name = "ImageModelError"; }
}
export type DesignImageRequest = { prompt: string; instruction?: string; intent: string; count: number; references: Array<{ bytes: Buffer; mime: string }> };
export type DesignImageResult = { images: Array<{ bytes: Buffer; mime: string; label?: string }>; provider: string; model: string };
export type DesignImageProvider = (input: DesignImageRequest) => Promise<DesignImageResult>;
const MAX_IMAGE = 5 * 1024 * 1024;
function raster(bytes: Buffer) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  throw new ImageModelError("模型图片或参考图片不是有效 JPG/PNG，请更换图片");
}
function secureUrl(raw: string, image = false) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new ImageModelError("图像服务地址必须是 HTTPS");
  if (image && !url.hostname.endsWith(".aliyuncs.com") && !url.hostname.endsWith(".alicdn.com")) throw new ImageModelError("图像下载地址不在已支持的服务域名内");
  return url;
}
export const generateLiveDesignImages: DesignImageProvider = async input => {
  if (!imageLiveConfigured()) throw new ImageModelError("真实图像模型未启用或密钥未齐，不能生成");
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4 || input.references.length > 9) throw new ImageModelError("每次生成 1–4 张，最多使用 9 张参考图");
  if (input.references.reduce((n,r) => n + r.bytes.length,0) > 20 * 1024 * 1024) throw new ImageModelError("参考图片合计超过 20MB");
  const prompt = [input.prompt, input.instruction, `意图：${input.intent}`].filter(Boolean).join("\n");
  if (!input.prompt.trim() || prompt.length > 5000) throw new ImageModelError("图像要求含业务参考合计不能超过 5000 字，请精简后重试");
  const config = getImageConfig();
  if (config.provider !== "bailian-native") throw new ImageModelError("本轮只支持百炼原生图像接口，请配置 AI_IMAGE_PROVIDER=bailian-native");
  const base = secureUrl(config.baseUrl.replace(/\/$/, ""));
  if (!base.hostname.endsWith(".aliyuncs.com")) throw new ImageModelError("百炼原生地址必须属于阿里云服务");
  const content: Array<{image: string} | {text: string}> = input.references.map(r => {
    const mime = raster(r.bytes);
    if (r.bytes.length > MAX_IMAGE) throw new ImageModelError("单张参考图超过 5MB");
    return { image: `data:${mime};base64,${r.bytes.toString("base64")}` };
  });
  content.push({ text: prompt });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${base.href.replace(/\/$/, "")}/services/aigc/multimodal-generation/generation`, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, input: { messages: [{ role: "user", content }] }, parameters: { n: input.count, size: "1K", watermark: true, thinking_mode: false } }),
    });
    if (!response.ok) throw new ImageModelError(response.status === 401 || response.status === 403 ? "百炼图像鉴权失败，请核对密钥地域和模型权限" : `百炼图像请求失败（${response.status}），请核对模型可用性；未自动重试`);
    const body = JSON.parse((await responseBytes(response, 128 * 1024)).toString("utf8")) as { code?: string; output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> } };
    if (body.code) throw new ImageModelError("百炼未完成图像生成，请核对服务配置和输入内容");
    const urls = body.output?.choices?.flatMap(c => c.message?.content ?? []).flatMap(c => c.image ? [c.image] : []) ?? [];
    if (!urls.length || urls.length > input.count) throw new ImageModelError("图像模型返回的图片数量异常");
    const images: DesignImageResult["images"] = [];
    for (const raw of urls) {
      const url = secureUrl(raw, true);
      const remote = await fetch(url, { signal: controller.signal, redirect: "error" });
      if (!remote.ok) throw new ImageModelError("图像已生成但下载失败，未自动重复生成");
      const bytes = await responseBytes(remote, MAX_IMAGE);
      images.push({ bytes, mime: raster(bytes) });
    }
    return { images, provider: config.provider, model: config.model };
  } catch (e) {
    if (e instanceof ImageModelError) throw e;
    throw new ImageModelError(controller.signal.aborted ? "图像请求超时；远端可能已生成，请先核对服务记录，不要连续重试" : "图像服务连接或返回格式异常，未自动重复生成");
  } finally { clearTimeout(timer); }
};
