import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateLiveDesignImages } from "@/server/ai/image";
import { encodeMonoWav } from "@/lib/audio-wav";
import { transcribeWav } from "@/server/ai/transcribe";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("真实图像适配器的协议与边界（不联网）",()=>{
  beforeEach(()=>{vi.stubEnv("AI_IMAGE_MODE","live");vi.stubEnv("AI_IMAGE_PROVIDER","bailian-native");vi.stubEnv("AI_IMAGE_API_KEY","test-only");vi.stubEnv("AI_IMAGE_BASE_URL","https://dashscope.aliyuncs.com/api/v1");});
  it("实际传递参考图并保存返回原图字节，下载不携带模型密钥",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({output:{choices:[{message:{content:[{image:"https://dashscope-output.oss-cn-beijing.aliyuncs.com/test.png"}]}}]}}))).mockResolvedValueOnce(new Response(png));vi.stubGlobal("fetch",fetcher);
    const result=await generateLiveDesignImages({prompt:"保留领型改藏青",intent:"edit",count:1,references:[{bytes:png,mime:"image/png"}]});
    const body=JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.input.messages[0].content[0].image).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(body.parameters.n).toBe(1);expect(result.images[0].bytes).toEqual(png);expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
  });
  it("拒绝不可信下载地址和缺配置，不退回假图",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({output:{choices:[{message:{content:[{image:"https://127.0.0.1/internal"}]}}]}})));vi.stubGlobal("fetch",fetcher);
    const input={prompt:"卫衣参考",intent:"reference",count:1,references:[]};
    await expect(generateLiveDesignImages(input)).rejects.toThrow(/域名/);expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubEnv("AI_IMAGE_MODE","mock");await expect(generateLiveDesignImages(input)).rejects.toThrow(/未启用/);expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
it("录音编码为单声道PCM，转写只返回文本，拒绝假音频",async()=>{
  vi.stubEnv("ASR_MODE","live");vi.stubEnv("ASR_API_KEY","test-asr");
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:"给北岸建单"}}]})));vi.stubGlobal("fetch",fetcher);
  const bytes=Buffer.from(encodeMonoWav(new Float32Array([0,0.5,-0.5,1,-1])));
  expect(bytes.toString("ascii",0,4)).toBe("RIFF");expect(bytes.readUInt32LE(24)).toBe(16000);
  expect((await transcribeWav(bytes)).text).toBe("给北岸建单");
  const body=JSON.parse(fetcher.mock.calls[0][1].body);expect(body.messages[0].content[0].input_audio.data).toContain("data:audio/wav;base64,");
  await expect(transcribeWav(Buffer.from("not audio"))).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
});
