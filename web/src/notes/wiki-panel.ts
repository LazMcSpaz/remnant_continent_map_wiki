// The wiki panel: a tabbed detail view for a clicked location.
//
// Tabs separate categories of information (Overview, Population, Resources,
// Connections, Notes). Data comes from the authored layer (LocationDetail), the
// derived network graph (Connections), and the notes table (Notes). The panel
// is pure DOM — it owns no map state and is opened/closed by main.ts.

import type { LocationDetail } from "../layers/features";
import { loadNotesFor, addNote, deleteNote } from "../layers/features";
import type { NetworkGraph } from "../derived/network-graph";
import { edgeTravelHours } from "../derived/network-graph";
import type { Note } from "../state/db-types";

type TabId = "overview" | "population" | "resources" | "connections" | "notes";

interface Tab {
  id: TabId;
  label: string;
  render: (host: HTMLElement, ctx: PanelContext) => void;
}

interface PanelContext {
  detail: LocationDetail;
  graph: NetworkGraph;
  /** Called after a notes mutation so the app can refresh if needed. */
  onNotesChanged: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

// --- Tab renderers ----------------------------------------------------------

function renderOverview(host: HTMLElement, { detail }: PanelContext): void {
  const rows: Array<[string, string]> = [
    ["Type", detail.type || "—"],
    ["New-world name", detail.name],
    ["Old-world name", detail.oldWorldName ?? "—"],
    ["Faction", detail.factionName ?? "Unaligned"],
  ];
  if (detail.lngLat) {
    rows.push(["Coordinates", `${detail.lngLat[1].toFixed(3)}, ${detail.lngLat[0].toFixed(3)}`]);
  }
  host.append(buildDefList(rows));
  if (detail.factionName) {
    host.append(
      el("p", { className: "wiki-faction-chip" }, [
        el("span", {
          className: "wiki-swatch",
          // inline color is data-driven, not user-authored markup
        }),
        ` ${detail.factionName}`,
      ]),
    );
    const swatch = host.querySelector<HTMLElement>(".wiki-swatch");
    if (swatch) swatch.style.background = detail.factionColor;
  }
}

function renderPopulation(host: HTMLElement, { detail }: PanelContext): void {
  if (detail.population == null) {
    host.append(emptyNote("No population recorded for this settlement."));
    return;
  }
  host.append(
    el("p", { className: "wiki-bignum" }, [fmtNumber(detail.population)]),
    el("p", { className: "wiki-muted" }, ["residents (authored)"]),
  );
}

function renderResources(host: HTMLElement, { detail }: PanelContext): void {
  const entries = Object.entries(detail.resources);
  if (entries.length === 0) {
    host.append(
      emptyNote("No resource values set. These will also be derivable from geography (Phase 2)."),
    );
    return;
  }
  const list = el("div", { className: "wiki-bars" });
  for (const [key, value] of entries) {
    const pct = Math.max(0, Math.min(100, value));
    const bar = el("div", { className: "wiki-bar" });
    const fill = el("div", { className: "wiki-bar-fill" });
    fill.style.width = `${pct}%`;
    bar.append(fill);
    list.append(
      el("div", { className: "wiki-bar-row" }, [
        el("span", { className: "wiki-bar-label" }, [titleCase(key)]),
        bar,
        el("span", { className: "wiki-bar-val" }, [String(value)]),
      ]),
    );
  }
  host.append(list);
  host.append(el("p", { className: "wiki-muted" }, ["Override values (0–100). Pinned as authored."]));
}

function renderConnections(host: HTMLElement, { detail, graph }: PanelContext): void {
  const nodeId = `loc:${detail.id}`;
  const edges = graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
  if (edges.length === 0) {
    host.append(emptyNote("No routes connect to this location."));
    return;
  }
  const nameOf = (id: string): string => graph.nodes.find((n) => n.id === id)?.name ?? id;
  const list = el("ul", { className: "wiki-conn-list" });
  for (const e of edges) {
    const otherId = e.from === nodeId ? e.to : e.from;
    const hrs = edgeTravelHours(e);
    const time = hrs === null ? "severed" : `${hrs.toFixed(1)} h`;
    const statusClass = e.status === "intact" ? "ok" : e.status === "damaged" ? "warn" : "bad";
    list.append(
      el("li", { className: "wiki-conn" }, [
        el("span", { className: "wiki-conn-to" }, [nameOf(otherId)]),
        el("span", { className: `wiki-tag wiki-${statusClass}` }, [e.status]),
        el("span", { className: "wiki-muted" }, [`${e.lengthKm.toFixed(0)} km · ${time}`]),
      ]),
    );
  }
  host.append(list);
}

function renderNotes(host: HTMLElement, ctx: PanelContext): void {
  const { detail } = ctx;
  const listEl = el("div", { className: "wiki-notes" }, [
    el("p", { className: "wiki-muted" }, ["Loading notes…"]),
  ]);
  host.append(listEl);

  const refresh = async () => {
    try {
      const notes = await loadNotesFor("location", detail.id);
      renderNoteList(listEl, notes, ctx, refresh);
    } catch (err) {
      listEl.replaceChildren(emptyNote(err instanceof Error ? err.message : String(err)));
    }
  };

  // Add-note form
  const input = el("textarea", {
    className: "wiki-note-input",
    placeholder: "Add a note… (Markdown-ish text)",
    rows: 2,
  });
  const addBtn = el("button", { type: "button", className: "wiki-btn" }, ["Add note"]);
  addBtn.addEventListener("click", () => {
    const body = input.value.trim();
    if (!body) return;
    addBtn.disabled = true;
    addNote("location", detail.id, body)
      .then(() => {
        input.value = "";
        ctx.onNotesChanged();
        return refresh();
      })
      .catch((err: unknown) => {
        listEl.prepend(emptyNote(err instanceof Error ? err.message : String(err)));
      })
      .finally(() => {
        addBtn.disabled = false;
      });
  });
  host.append(el("div", { className: "wiki-note-form" }, [input, addBtn]));

  void refresh();
}

function renderNoteList(
  container: HTMLElement,
  notes: Note[],
  ctx: PanelContext,
  refresh: () => void | Promise<void>,
): void {
  if (notes.length === 0) {
    container.replaceChildren(emptyNote("No notes yet. Add the first one below."));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const note of notes) {
    const del = el("button", { type: "button", className: "wiki-note-del", title: "Delete note" }, ["×"]);
    del.addEventListener("click", () => {
      del.disabled = true;
      deleteNote(note.id)
        .then(() => {
          ctx.onNotesChanged();
          return refresh();
        })
        .catch((err: unknown) => {
          container.prepend(emptyNote(err instanceof Error ? err.message : String(err)));
          del.disabled = false;
        });
    });
    const tagEls = (note.tags ?? []).map((t) =>
      el("span", { className: "wiki-tag" }, [t]),
    );
    frag.append(
      el("div", { className: "wiki-note" }, [
        el("div", { className: "wiki-note-body" }, [note.body]),
        el("div", { className: "wiki-note-meta" }, [
          ...tagEls,
          el("span", { className: "wiki-muted" }, [
            new Date(note.created_at).toLocaleDateString(),
          ]),
          del,
        ]),
      ]),
    );
  }
  container.replaceChildren(frag);
}

// --- Helpers ----------------------------------------------------------------

function buildDefList(rows: Array<[string, string]>): HTMLElement {
  const dl = el("dl", { className: "wiki-dl" });
  for (const [k, v] of rows) {
    dl.append(el("dt", {}, [k]), el("dd", {}, [v]));
  }
  return dl;
}

function emptyNote(text: string): HTMLElement {
  return el("p", { className: "wiki-muted" }, [text]);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const TABS: Tab[] = [
  { id: "overview", label: "Overview", render: renderOverview },
  { id: "population", label: "Population", render: renderPopulation },
  { id: "resources", label: "Resources", render: renderResources },
  { id: "connections", label: "Connections", render: renderConnections },
  { id: "notes", label: "Notes", render: renderNotes },
];

// --- Panel controller -------------------------------------------------------

export class WikiPanel {
  private root: HTMLElement;
  private tabsEl: HTMLElement;
  private bodyEl: HTMLElement;
  private titleEl: HTMLElement;
  private active: TabId = "overview";
  private ctx: PanelContext | null = null;

  constructor(mount: HTMLElement) {
    this.titleEl = el("h2", { className: "wiki-title" });
    const closeBtn = el("button", { type: "button", className: "wiki-close", title: "Close" }, ["×"]);
    closeBtn.addEventListener("click", () => this.close());

    this.tabsEl = el("div", { className: "wiki-tabs", role: "tablist" });
    this.bodyEl = el("div", { className: "wiki-body" });

    this.root = el("aside", { className: "wiki-panel", hidden: true }, [
      el("header", { className: "wiki-header" }, [this.titleEl, closeBtn]),
      this.tabsEl,
      this.bodyEl,
    ]);
    this.root.setAttribute("aria-label", "Location details");
    mount.append(this.root);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  /** Open the panel for a location, keeping the current tab if possible. */
  open(detail: LocationDetail, graph: NetworkGraph, onNotesChanged: () => void): void {
    this.ctx = { detail, graph, onNotesChanged };
    this.titleEl.textContent = detail.name;
    this.buildTabs();
    this.root.hidden = false;
    this.select(this.active);
  }

  close(): void {
    this.root.hidden = true;
    this.ctx = null;
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  private buildTabs(): void {
    this.tabsEl.replaceChildren();
    for (const tab of TABS) {
      const btn = el("button", {
        type: "button",
        className: "wiki-tab",
        role: "tab",
      }, [tab.label]);
      btn.dataset.tab = tab.id;
      btn.addEventListener("click", () => this.select(tab.id));
      this.tabsEl.append(btn);
    }
  }

  private select(id: TabId): void {
    if (!this.ctx) return;
    this.active = id;
    for (const btn of this.tabsEl.querySelectorAll<HTMLButtonElement>(".wiki-tab")) {
      btn.setAttribute("aria-selected", String(btn.dataset.tab === id));
    }
    this.bodyEl.replaceChildren();
    const tab = TABS.find((t) => t.id === id);
    tab?.render(this.bodyEl, this.ctx);
  }
}
