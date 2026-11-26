// Chat sites lazyBoi knows. Keep in sync with host_permissions in extension/manifest.json (a test checks it).
export const CHAT_HOSTS = [
  "claude.ai",
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "chat.deepseek.com",
  "grok.com",
  "chat.mistral.ai",
  "poe.com",
];

export function isChatHost(host: string): boolean {
  return CHAT_HOSTS.some((h) => host === h || host.endsWith("." + h));
}
