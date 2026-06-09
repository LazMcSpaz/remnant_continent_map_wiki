// Collapsible panel dock. Wraps an existing control panel in a header bar with
// a title + minimize chevron, so the cluttered stack of always-open tools can be
// folded down to titles. Non-invasive: the wrapped panel keeps rendering into
// its own element (refreshes/replaceChildren still work); we only add chrome
// around it and toggle a `collapsed` class. Collapsed state persists in
// localStorage, and the wrapper mirrors the panel's own `hidden` (so tools that
// only appear with a backend stay hidden until they're meant to show).

interface DockOptions {
  /** Header label. */
  title: string;
  /** Start collapsed (default false). Overridden by any saved state. */
  collapsed?: boolean | undefined;
  /** localStorage key suffix; defaults to the panel element id. */
  key?: string | undefined;
}

const STORE_PREFIX = "rc.dock.";

function loadCollapsed(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(STORE_PREFIX + key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function saveCollapsed(key: string, collapsed: boolean): void {
  try {
    localStorage.setItem(STORE_PREFIX + key, collapsed ? "1" : "0");
  } catch {
    /* ignore quota/availability errors */
  }
}

/**
 * Wrap `panel` in a collapsible dock card. Returns the wrapper element. Safe to
 * call once per panel at startup; the panel element is moved inside the wrapper.
 */
export function makeCollapsiblePanel(panel: HTMLElement, opts: DockOptions): HTMLElement {
  const key = opts.key ?? panel.id ?? opts.title;
  const wrapper = document.createElement("div");
  wrapper.className = "dock-panel";

  // Header: title + chevron toggle.
  const header = document.createElement("button");
  header.type = "button";
  header.className = "dock-header";
  header.setAttribute("aria-expanded", "true");
  const titleEl = document.createElement("span");
  titleEl.className = "dock-title";
  titleEl.textContent = opts.title;
  const chevron = document.createElement("span");
  chevron.className = "dock-chevron";
  chevron.setAttribute("aria-hidden", "true");
  header.append(titleEl, chevron);

  const body = document.createElement("div");
  body.className = "dock-body";

  // Insert the wrapper where the panel was, then move the panel into the body.
  panel.parentElement?.insertBefore(wrapper, panel);
  body.append(panel);
  wrapper.append(header, body);
  // The panel's own visibility is now managed by the wrapper; let it fill.
  panel.classList.add("dock-managed");

  let collapsed = loadCollapsed(key, opts.collapsed ?? false);
  const apply = (): void => {
    wrapper.classList.toggle("collapsed", collapsed);
    header.setAttribute("aria-expanded", String(!collapsed));
  };
  apply();

  header.addEventListener("click", () => {
    collapsed = !collapsed;
    saveCollapsed(key, collapsed);
    apply();
  });

  // Mirror the panel's `hidden` attribute onto the wrapper, so tools that only
  // appear with a backend don't leave an empty header showing.
  const syncHidden = () => {
    wrapper.hidden = panel.hidden;
  };
  syncHidden();
  new MutationObserver(syncHidden).observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  return wrapper;
}

/** Wrap a set of panels by element id, each with a friendly title. Missing ids
 *  are skipped. Call once after the DOM exists (panels may mount later). */
export function installPanelDock(
  specs: Array<{ id: string; title: string; collapsed?: boolean }>,
): void {
  for (const spec of specs) {
    const el = document.getElementById(spec.id);
    if (el) makeCollapsiblePanel(el, { title: spec.title, collapsed: spec.collapsed, key: spec.id });
  }
}
