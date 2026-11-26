// Shared playground behavior: nav, live form-state panel, submit counter, optional lazyBoi harness.
(function () {
  const params = new URLSearchParams(location.search);
  const harness = params.has("harness");

  // ----- nav -----
  const pages = [
    ["basic.html", "Basic"],
    ["choices.html", "Choices"],
    ["linkedin.html", "LinkedIn-like"],
    ["job.html", "Job application"],
    ["framework.html", "Framework inputs"],
    ["dynamic.html", "Dynamic / multi-step"],
    ["modal.html", "Modal in shadow DOM"],
    ["richtext.html", "Rich text"],
    ["frames.html", "Iframe + shadow DOM"],
    ["sensitive.html", "Sensitive"],
    ["labels.html", "Odd labels"],
    ["chat.html", "Mock AI chat"],
  ];
  if (window.top === window) {
    const nav = document.createElement("nav");
    nav.className = "top";
    const q = harness ? "?harness" : "";
    nav.innerHTML =
      `<a class="home" href="index.html${q}">lazyBoi playground</a>` +
      pages.map(([href, name]) => `<a href="${href}${q}">${name}</a>`).join("") +
      `<a href="${location.pathname}${harness ? "" : "?harness"}" style="margin-left:auto">${harness ? "Harness: on (turn off)" : "Harness: off (turn on)"}</a>`;
    document.body.prepend(nav);
  }

  // ----- state panel -----
  let submits = 0;
  const initial = new Map();

  function controls(root, out, prefix) {
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("#lazyboi-harness, #state")) continue;
      if (el.matches("input, select, textarea") || (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false")) {
        out.push([prefix, el]);
      }
      if (el.shadowRoot) controls(el.shadowRoot, out, prefix + "shadow›");
      if (el.tagName === "IFRAME") {
        try {
          if (el.contentDocument) controls(el.contentDocument, out, prefix + "iframe›");
        } catch {}
      }
    }
    return out;
  }

  function valueOf(el) {
    if (el.isContentEditable || el.hasAttribute("contenteditable")) return el.textContent.trim();
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? `✔ ${el.value}` : "";
    if (el.type === "file") return el.files?.length ? `${el.files.length} file(s)` : "";
    if (el.tagName === "SELECT" && el.multiple) return Array.from(el.selectedOptions).map((o) => o.value).join(", ");
    return el.value;
  }

  function keyOf(prefix, el, i) {
    const k = el.name || el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase() + i;
    return prefix + k + (el.type === "radio" || el.type === "checkbox" ? `=${el.value}` : "");
  }

  function renderState() {
    if (window.top !== window) return;
    let aside = document.getElementById("state");
    if (!aside) return;
    if (window.customState) {
      aside.querySelector("[data-rows]").innerHTML = window.customState();
    } else {
      const rows = controls(document, [], "")
        .map(([p, el], i) => {
          const k = keyOf(p, el, i);
          const v = valueOf(el);
          if (!initial.has(k)) initial.set(k, v);
          if ((el.type === "radio" || el.type === "checkbox") && !el.checked && !initial.get(k)) return "";
          const changed = initial.get(k) !== v;
          return `<tr class="${changed ? "changed" : ""}"><td>${esc(k)}</td><td>${esc(String(v)) || "<span style=color:#bbb>—</span>"}</td></tr>`;
        })
        .join("");
      aside.querySelector("[data-rows]").innerHTML = rows;
    }
    const s = aside.querySelector(".submits");
    s.textContent = submits ? `⚠ Form submitted ${submits}× (logged only)` : "Not submitted (lazyBoi must never submit)";
    s.classList.toggle("bad", submits > 0);
  }

  function esc(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  if (window.top === window) {
    const main = document.querySelector("main");
    if (main) {
      const layout = document.createElement("div");
      layout.className = "layout";
      main.replaceWith(layout);
      layout.append(main);
      const aside = document.createElement("aside");
      aside.id = "state";
      aside.innerHTML = `<h2>Form state (live)</h2><div class="submits"></div><table><tbody data-rows></tbody></table>`;
      layout.append(aside);
    }
    document.addEventListener("input", renderState, true);
    document.addEventListener("change", renderState, true);
    setInterval(renderState, 400);
    window.addEventListener("load", renderState);
  }

  document.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      submits++;
      console.log("[playground] submit intercepted", e.target);
      renderState();
    },
    true,
  );
  window.playgroundSubmits = () => submits;

  // ----- harness -----
  if (harness && window.top === window) {
    const s = document.createElement("script");
    s.src = "harness/lazyboi-harness.js";
    document.head.append(s);
  }
})();
