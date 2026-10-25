export type MicrophoneIssue = {
  kind: "permission" | "policy" | "insecure" | "unsupported" | "device" | "busy" | "other";
  message: string;
};

type CapturePolicy = { allowsFeature: (name: string) => boolean };

export function microphoneAvailability(recording: boolean): MicrophoneIssue | null {
  if (window.isSecureContext === false) return { kind: "insecure", message: "这个网页地址不支持麦克风。请使用 HTTPS，或在本机通过 127.0.0.1 / localhost 打开。" };
  const page = document as Document & { permissionsPolicy?: CapturePolicy; featurePolicy?: CapturePolicy };
  const policy = page.permissionsPolicy ?? page.featurePolicy;
  if (policy && !policy.allowsFeature("microphone")) return { kind: "policy", message: "当前窗口限制了网页使用麦克风。请把当前网址复制到 Safari 或 Chrome 中打开，再允许麦克风。" };
  if (!navigator.mediaDevices?.getUserMedia || (recording && typeof MediaRecorder === "undefined")) return { kind: "unsupported", message: "当前浏览器不支持这项录音功能。请在 Safari 或 Chrome 中打开当前网址。" };
  return null;
}

export async function microphoneFailure(error: unknown): Promise<MicrophoneIssue> {
  const unavailable = microphoneAvailability(false);
  if (unavailable) return unavailable;
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    let state: PermissionState | undefined;
    try { state = (await navigator.permissions?.query({ name: "microphone" as PermissionName }))?.state; } catch { /* Some browsers cannot query microphone permission. */ }
    return {
      kind: "permission",
      message: state === "granted"
        ? "网站已获许可，但系统或当前窗口仍未能打开麦克风。请检查下方的系统权限，再重新检测。"
        : "当前浏览器或系统拦截了麦克风。请按下方步骤开启权限，再点“重新检测麦克风”。",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return { kind: "device", message: "没有找到可用麦克风。请接好耳机或麦克风，并在系统声音设置中选择输入设备。" };
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return { kind: "busy", message: "麦克风暂时无法打开，可能被其他程序占用或设备未就绪。请关闭其他录音/会议程序，检查输入设备后重试。" };
  return { kind: "other", message: "麦克风启动失败。请检查输入设备和权限后重试。" };
}
