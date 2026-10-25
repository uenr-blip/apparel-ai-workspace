import { responseBytes } from "./bounded-response";
export async function transcribeWav(bytes: Buffer) {
  if(bytes.length<46 || bytes.toString("ascii",0,4)!=="RIFF" || bytes.toString("ascii",8,12)!=="WAVE" || bytes.toString("ascii",36,40)!=="data" || bytes.readUInt16LE(20)!==1 || bytes.readUInt16LE(22)!==1 || bytes.readUInt32LE(24)!==16000 || bytes.readUInt16LE(34)!==16 || bytes.readUInt32LE(40)!==bytes.length-44 || bytes.length>992044) throw new Error("请使用话筒录制30秒以内的语音");
  const key=process.env.ASR_API_KEY?.trim() || process.env.AGENT_API_KEY?.trim();
  if(!key) throw new Error("语音转写待配置百炼密钥");
  if((process.env.ASR_MODE || process.env.AGENT_MODE)!=="live") throw new Error("语音转写未开启真实模型");
  const base=process.env.ASR_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const url=new URL(base);if(url.protocol!=="https:" || url.username || url.password)throw new Error("语音服务地址不正确");
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),30000);
  try {
    const response=await fetch(`${base.replace(/\/$/,"")}/chat/completions`,{method:"POST",signal:abort.signal,redirect:"error",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({model:process.env.ASR_MODEL || "qwen3-asr-flash",messages:[{role:"user",content:[{type:"input_audio",input_audio:{data:`data:audio/wav;base64,${bytes.toString("base64")}`}}]}],stream:false,asr_options:{enable_itn:false}})});
    if(!response.ok)throw new Error(`语音转写失败（${response.status}），请检查百炼权限或稍后重试`);
    const data=JSON.parse((await responseBytes(response,32000)).toString("utf8"));const content=data.choices?.[0]?.message?.content;
    const text=typeof content==="string" ? content : Array.isArray(content) ? content.map(c=>typeof c.text==="string"?c.text:"").join("") : "";
    if(!text.trim())throw new Error("没有识别到清晰语音，请重录或打字");
    if(text.length>1000)throw new Error("转写文字过长，请分段录音");
    return {text:text.trim(),model:process.env.ASR_MODEL || "qwen3-asr-flash"};
  } catch(e) {if(abort.signal.aborted)throw new Error("语音转写超时，请重试");if(e instanceof TypeError || e instanceof SyntaxError)throw new Error("语音服务暂时不可用");throw e;} finally {clearTimeout(timer);}
}
