export const MAX_AGENT_STEPS = 25;
export const MAX_GOAL_LENGTH = 2000;
export const DANGEROUS_WORDS = "\\b(buy|pay|payment|order|purchase|send|delete|remove|confirm|sign[ -]?in|log[ -]?in|account|security|password|checkout|subscribe|unsubscribe|publish|post|save|transfer|upload|download|install|submit)\\b";

export function safeAgentUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) ||
      /(?:^|\.)(localhost|local|internal|test|invalid|example)$/i.test(url.hostname) ||
      new RegExp(DANGEROUS_WORDS, "i").test(decodeURIComponent(url.pathname))) return null;
    return url.href;
  } catch { return null; }
}

export function taskCandidates(goal: string): { urls: string[]; values: string[] } {
  const urls = [...new Set((goal.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((url) => safeAgentUrl(url.replace(/[),.;]+$/, ""))).filter((url): url is string => url !== null))].slice(0, 5);
  const quotes = [...goal.matchAll(/["“]([^"”]{1,120})["”]|'([^']{1,120})'/g)].map((match) => match[1] ?? match[2] ?? "");
  const tokens = goal.replace(/https?:\/\/\S+/gi, " ").match(/[\p{L}\p{N}][\p{L}\p{N} ._-]{1,119}/gu) ?? [];
  const values = [...new Set([...quotes, ...tokens.map((value) => value.trim())])].filter((value) => value.length > 0 && !/\b(?:password|secret|token|api.?key|credit.?card)\b/i.test(value)).slice(0, 6);
  return { urls, values };
}
