export function locate(text: string, snippet: string) {
  const start = text.indexOf(snippet);
  if (start < 0) {
    return { start: null as number | null, end: null as number | null, sourceText: snippet };
  }
  return { start, end: start + snippet.length, sourceText: snippet };
}

export function hasJailbreakAttempt(text: string) {
  return /忽略现有规则|绕过审批|读取运行环境|已经批准了所有操作|API密钥/.test(text);
}
