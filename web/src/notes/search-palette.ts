// Global search command palette (Ctrl-K / Cmd-K).
//
// A modal overlay with a text input and a keyboard-navigable results list.
// Opens on the global hotkey, closes on Esc / backdrop click / selection.
// Pure DOM — no map references. Callers supply a SearchHost so this module
// stays independent of main.ts internals.

import { searchEntries, type SearchEntry } from "./search-index";

/** Callback interface implemented by main.ts and injected at mount time. */
export interface SearchHost {
  /** Returns a fresh index every time the palette opens. */
  getEntries(): SearchEntry[];
  /** Called when the user confirms a result (Enter / click). */
  onChoose(entry: SearchEntry): void;
}

// ---------------------------------------------------------------------------
// Helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// ---------------------------------------------------------------------------
// Mount

/**
 * Mount the search palette into `container` (the `#search-palette` div from
 * index.html). Registers the Ctrl-K / Cmd-K global keydown listener. Returns
 * a dispose function that tears down the global listener (useful in tests).
 */
export function mountSearchPalette(container: HTMLElement, host: SearchHost): () => void {
  // ---- DOM structure -------------------------------------------------------
  // container is .search-palette (the outer backdrop/overlay)
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", "Search");
  container.setAttribute("aria-modal", "true");

  const dialog = el("div", { className: "sp-dialog" });

  const input = el("input", {
    type: "search",
    className: "sp-input",
    placeholder: "Search locations, factions, routes…",
    autocomplete: "off",
    spellcheck: false,
    // aria
    role: "combobox",
    ariaExpanded: "false",
    ariaAutoComplete: "list",
  });
  input.setAttribute("aria-controls", "sp-results");

  const resultsList = el("ul", {
    id: "sp-results",
    className: "sp-results",
    role: "listbox",
    ariaLabel: "Search results",
  });

  const hint = el("p", { className: "sp-hint" }, "Type to search");

  dialog.append(input, resultsList, hint);
  container.append(dialog);

  // ---- State ---------------------------------------------------------------
  let entries: SearchEntry[] = [];
  let highlighted = -1;

  // ---- Rendering -----------------------------------------------------------

  const renderResults = (query: string): void => {
    const matches = searchEntries(entries, query);
    resultsList.replaceChildren();
    highlighted = -1;

    if (!query.trim()) {
      hint.textContent = "Type to search";
      hint.hidden = false;
      resultsList.hidden = true;
      return;
    }

    if (matches.length === 0) {
      hint.textContent = "No results";
      hint.hidden = false;
      resultsList.hidden = true;
      return;
    }

    hint.hidden = true;
    resultsList.hidden = false;
    input.setAttribute("aria-expanded", "true");

    for (const entry of matches) {
      const li = el("li", {
        className: "sp-result",
        role: "option",
      });
      li.dataset.id = entry.id;

      const kindBadge = el("span", { className: `sp-kind sp-kind-${entry.kind}` }, entry.kind);
      const labelEl = el("span", { className: "sp-label" }, entry.label);
      const subEl = el("span", { className: "sp-sublabel" }, entry.sublabel);

      const text = el("span", { className: "sp-text" }, labelEl, subEl);
      li.append(kindBadge, text);

      li.addEventListener("click", () => choose(entry));
      li.addEventListener("mouseenter", () => {
        setHighlight(indexOfItem(li));
      });

      resultsList.append(li);
    }
  };

  const items = (): HTMLElement[] =>
    Array.from(resultsList.querySelectorAll<HTMLElement>(".sp-result"));

  const indexOfItem = (li: HTMLElement): number => items().indexOf(li);

  const setHighlight = (idx: number): void => {
    const all = items();
    highlighted = Math.max(-1, Math.min(idx, all.length - 1));
    all.forEach((li, i) => {
      const active = i === highlighted;
      li.classList.toggle("sp-result-active", active);
      li.setAttribute("aria-selected", String(active));
      if (active) li.scrollIntoView({ block: "nearest" });
    });
    input.setAttribute(
      "aria-activedescendant",
      highlighted >= 0 ? (all[highlighted]?.id ?? "") : "",
    );
  };

  // ---- Open / close --------------------------------------------------------

  const open = (): void => {
    entries = host.getEntries();
    input.value = "";
    renderResults("");
    container.hidden = false;
    input.focus();
  };

  const close = (): void => {
    container.hidden = true;
    input.value = "";
    resultsList.replaceChildren();
    highlighted = -1;
    input.setAttribute("aria-expanded", "false");
  };

  const choose = (entry: SearchEntry): void => {
    close();
    host.onChoose(entry);
  };

  // ---- Event handlers -------------------------------------------------------

  // Backdrop click (click on the overlay but outside the dialog).
  container.addEventListener("click", (e) => {
    if (e.target === container) close();
  });

  // Live query updates.
  input.addEventListener("input", () => {
    renderResults(input.value);
  });

  // Keyboard navigation inside the palette.
  input.addEventListener("keydown", (e) => {
    const all = items();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(highlighted + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(highlighted - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0 && all[highlighted]) {
        const id = all[highlighted].dataset.id;
        const found = entries.find(
          (en) => en.id === id && searchEntries(entries, input.value).includes(en),
        );
        if (found) choose(found);
      }
    } else if (e.key === "Escape") {
      close();
    }
  });

  // Global hotkey: Ctrl-K or Cmd-K.
  const onKeydown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      if (container.hidden) {
        open();
      } else {
        close();
      }
    }
    // Also close on Escape even if focus has moved away.
    if (e.key === "Escape" && !container.hidden) {
      close();
    }
  };
  document.addEventListener("keydown", onKeydown);

  // Return a dispose fn (removes the global listener).
  return () => document.removeEventListener("keydown", onKeydown);
}
