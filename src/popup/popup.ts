// Popup: just a description, plus a per-site switch for the floating widget.
import { getHiddenHosts, setHostHidden } from "../shared/prefs";

async function init() {
  const showDock = document.getElementById("show-dock") as HTMLInputElement;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostName = "";
  try {
    hostName = new URL(tab?.url ?? "").hostname;
  } catch {
    /* no readable URL (browser pages) */
  }
  if (!hostName) {
    showDock.disabled = true;
    return;
  }
  showDock.checked = !(await getHiddenHosts()).includes(hostName);
  showDock.addEventListener("change", () => void setHostHidden(hostName, !showDock.checked));
}

void init();
