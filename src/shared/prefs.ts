// Tiny preference store: chrome.storage.local in the extension, localStorage in the playground harness.
export const HIDDEN_HOSTS_KEY = "lazyboi.hiddenHosts";

const hasChromeStorage = () => typeof chrome !== "undefined" && !!chrome.storage?.local;

export async function getHiddenHosts(): Promise<string[]> {
  try {
    if (hasChromeStorage()) {
      const d = await chrome.storage.local.get(HIDDEN_HOSTS_KEY);
      return (d[HIDDEN_HOSTS_KEY] as string[] | undefined) ?? [];
    }
    return JSON.parse(localStorage.getItem(HIDDEN_HOSTS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export async function setHostHidden(host: string, hidden: boolean): Promise<void> {
  if (!host) return;
  const list = (await getHiddenHosts()).filter((h) => h !== host);
  if (hidden) list.push(host);
  if (hasChromeStorage()) await chrome.storage.local.set({ [HIDDEN_HOSTS_KEY]: list });
  else localStorage.setItem(HIDDEN_HOSTS_KEY, JSON.stringify(list));
}
