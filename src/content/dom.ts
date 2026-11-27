// Small DOM helpers shared by the overlay and the widget.

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

const ICONS = {
  // Stroke icons on a 24px grid (Lucide-style), built with createElementNS so strict-CSP / Trusted Types pages allow them.
  bolt: ["M13 2 3 14h8l-1 8 10-12h-8l1-8z"],
  copy: ["M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z", "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2", "M8.5 12h7", "M8.5 16h4.5"],
  paste: ["M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z", "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2", "M12 10.5v6", "m9.5 14 2.5 2.5 2.5-2.5"],
  sparkle: ["M12 3c.5 4.6 2.4 6.5 7 7-4.6.5-6.5 2.4-7 7-.5-4.6-2.4-6.5-7-7 4.6-.5 6.5-2.4 7-7z"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  grip: [],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (name === "grip") {
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("stroke", "none");
    for (const cx of [9, 15]) for (const cy of [6, 12, 18]) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", "1.4");
      svg.append(c);
    }
    return svg;
  }
  for (const d of ICONS[name]) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** Copy text; falls back to a hidden textarea when the async clipboard API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
