// The wiki panel: a tabbed, editable detail view for a clicked location.
//
// Tabs separate categories (Overview, Population, Resources, Connections,
// Notes). Data spans the three layers: LocationDetail (authored), the
// NetworkGraph (derived), and the notes table. The panel never holds map or
// data state itself — it talks to a WikiHost, so navigation, edits, and
// reloads stay owned by main.ts and the layers stay cleanly separated.

import type { LocationDetail } from "../layers/features";
import {
  loadNotesFor,
  addNote,
  deleteNote,
  updateLocationFields,
  updateLocationResources,
} from "../layers/features";
import type { NetworkGraph } from "../derived/network-graph";
import { edgeTravelHours } from "../derived/network-graph";
import type { CityResources } from "../derived/resources";
import { RESOURCE_KINDS, type ResourceKind } from "../derived/resources";
import type { Note } from "../state/db-types";
import { renderInlineMarkdown, relativeTime } from "./markdown";
import { formatTempF } from "../derived/climate";

type TabId = "overview" | "population" | "resources" | "climate" | "connections" | "notes";

/** Derived climate readout for a location, computed by the host. */
export interface LocationClimate {
  tempC: number;
  warmth: number;
  precip: number;
  effLat: number;
  elevationM: number | null;
  isWater: boolean;
  biomeLabel: string;
  windBand: string;
  windBearing: number;
  seasonLabel: string;
}

/** The panel's window into app state — implemented by main.ts. */
export interface WikiHost {
  getDetail(id: string): LocationDetail | undefined;
  getGraph(): NetworkGraph;
  /** Derived climate at a location — async (samples the elevation DEM). */
  getClimate(detail: LocationDetail): Promise<LocationClimate | null>;
  /** Derived resource baselines + pins for a location — async (samples the DEM). */
  getResources(detail: LocationDetail): Promise<CityResources | null>;
  /** Simulation pressure (0..100) at this location, or null if sim isn't running. */
  getPressure(detail: LocationDetail): { pressure: number; turn: number } | null;
  /** Fly to and select another location, re-opening the panel on it. */
  navigateTo(id: string): void;
  /** Reload authored data + rebuild the graph after an edit. */
  reloadData(): Promise<void>;
  /** Whether authored edits are possible (backend present). */
  canEdit(): boolean;
  setStatus(text: string, kind?: "info" | "error"): void;
}

interface Tab {
  id: TabId;
  label: string;
  render: (host: HTMLElement, ctx: RenderCtx) => void;
}

interface RenderCtx {
  detail: LocationDetail;
  panel: WikiPanel;
  host: WikiHost;
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
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function emptyNote(text: string): HTMLElement {
  return el("p", { className: "wiki-muted" }, [text]);
}
function buildDefList(rows: Array<[string, string]>): HTMLElement {
  const dl = el("dl", { className: "wiki-dl" });
  for (const [k, v] of rows) dl.append(el("dt", {}, [k]), el("dd", {}, [v]));
  return dl;
}

// --- Overview (editable) ----------------------------------------------------

function renderOverview(hostEl: HTMLElement, ctx: RenderCtx): void {
  const { detail, host, panel } = ctx;
  const view = () => {
    const rows: Array<[string, string]> = [
      ["Type", detail.type || "—"],
      ["New-world name", detail.name],
      ["Old-world name", detail.oldWorldName ?? "—"],
      ["Faction", detail.factionName ?? "Unaligned"],
    ];
    if (detail.lngLat) {
      rows.push(["Coordinates", `${detail.lngLat[1].toFixed(3)}, ${detail.lngLat[0].toFixed(3)}`]);
    }
    const dl = el("dl", { className: "wiki-dl" });
    for (const [k, v] of rows) dl.append(el("dt", {}, [k]), el("dd", {}, [v]));
    hostEl.replaceChildren(dl);
    if (detail.factionName) {
      const chip = el("p", { className: "wiki-faction-chip" }, [
        el("span", { className: "wiki-swatch" }),
        ` ${detail.factionName}`,
      ]);
      hostEl.append(chip);
      const sw = chip.querySelector<HTMLElement>(".wiki-swatch");
      if (sw) sw.style.background = detail.factionColor;
    }
    if (host.canEdit()) hostEl.append(editButton(edit));
  };

  const edit = () => {
    const nameIn = textField("New-world name", detail.name);
    const oldIn = textField("Old-world name", detail.oldWorldName ?? "");
    const typeIn = textField("Type", detail.type);
    hostEl.replaceChildren(
      nameIn.row,
      oldIn.row,
      typeIn.row,
      saveCancel(
        async () => {
          await updateLocationFields(detail.id, {
            name: nameIn.input.value.trim() || detail.name,
            old_world_name: oldIn.input.value.trim() || null,
            type: typeIn.input.value.trim() || detail.type,
          });
          await host.reloadData();
          panel.rerenderActive();
        },
        view,
        host,
      ),
    );
    nameIn.input.focus();
  };

  view();
}

// --- Population (editable) --------------------------------------------------

function renderPopulation(hostEl: HTMLElement, ctx: RenderCtx): void {
  const { detail, host, panel } = ctx;
  const view = () => {
    if (detail.population == null) {
      hostEl.replaceChildren(emptyNote("No population recorded for this settlement."));
    } else {
      hostEl.replaceChildren(
        el("p", { className: "wiki-bignum" }, [fmtNumber(detail.population)]),
        el("p", { className: "wiki-muted" }, ["residents (authored)"]),
      );
    }
    if (host.canEdit()) hostEl.append(editButton(edit));
  };
  const edit = () => {
    const pop = textField("Population", detail.population?.toString() ?? "", "number");
    hostEl.replaceChildren(
      pop.row,
      saveCancel(
        async () => {
          const raw = pop.input.value.trim();
          const value = raw === "" ? null : Math.max(0, Math.round(Number(raw)));
          await updateLocationFields(detail.id, { population: Number.isNaN(value as number) ? null : value });
          await host.reloadData();
          panel.rerenderActive();
        },
        view,
        host,
      ),
    );
    pop.input.focus();
  };
  view();
}

// --- Resources (derived baselines, overrides shown as pins) -----------------

function renderResources(hostEl: HTMLElement, ctx: RenderCtx): void {
  const { detail, host } = ctx;
  hostEl.replaceChildren(emptyNote("Computing resources (sampling elevation)…"));
  void host.getResources(detail).then((res) => {
    if (!res) {
      hostEl.replaceChildren(
        emptyNote("No coordinates — resources are derived from the climate beneath a city."),
      );
      return;
    }
    renderResourceView(hostEl, ctx, res);
  });
}

function renderResourceView(hostEl: HTMLElement, ctx: RenderCtx, res: CityResources): void {
  const { detail, host, panel } = ctx;

  /** Persist the pin map (resource_overrides), then reload + recompute. */
  const commitPins = async (pins: Record<string, number>) => {
    await updateLocationResources(detail.id, pins);
    await host.reloadData();
    panel.rerenderActive();
  };

  const view = () => {
    hostEl.replaceChildren();
    if (res.regionName) {
      hostEl.append(
        el("p", { className: "wiki-muted" }, [`Baselines derived from the climate model (${res.regionName}).`]),
      );
    }
    const bars = el("div", { className: "wiki-bars" });
    for (const kind of RESOURCE_KINDS) {
      const v = res.values[kind];
      // Bar shows the effective value; baseline tick shown when a pin overrides it.
      const fill = el("div", { className: "wiki-bar-fill" });
      fill.style.width = `${Math.max(0, Math.min(100, v.effective))}%`;
      if (v.isPinned) fill.classList.add("wiki-bar-pinned");
      const bar = el("div", { className: "wiki-bar" }, [fill]);
      if (v.isPinned && v.baseline != null) {
        const tick = el("div", { className: "wiki-bar-tick" });
        tick.style.left = `${Math.max(0, Math.min(100, v.baseline))}%`;
        tick.title = `geographic baseline ${v.baseline}`;
        bar.append(tick);
      }
      const valLabel = v.isPinned
        ? `${v.effective} 📌`
        : v.baseline == null ? "—" : String(v.effective);
      bars.append(
        el("div", { className: "wiki-bar-row" }, [
          el("span", { className: "wiki-bar-label" }, [titleCase(kind)]),
          bar,
          el("span", { className: "wiki-bar-val" }, [valLabel]),
        ]),
      );
    }
    hostEl.append(bars);

    const anyPinned = RESOURCE_KINDS.some((k) => res.values[k].isPinned);
    hostEl.append(
      el("p", { className: "wiki-muted" }, [
        anyPinned
          ? "📌 = pinned override (survives recompute). Tick marks the geographic baseline."
          : "Values derived from geography. Pin any to override (survives recompute).",
      ]),
    );
    if (host.canEdit()) hostEl.append(editButton(editPins));
  };

  const editPins = () => {
    const inputs = new Map<ResourceKind, HTMLInputElement>();
    const rows: HTMLElement[] = [];
    for (const kind of RESOURCE_KINDS) {
      const v = res.values[kind];
      const placeholder = v.baseline == null ? "—" : `baseline ${v.baseline}`;
      const f = textField(titleCase(kind), v.pinned?.toString() ?? "", "number");
      f.input.min = "0";
      f.input.max = "100";
      f.input.placeholder = placeholder;
      inputs.set(kind, f.input);
      rows.push(f.row);
    }
    hostEl.replaceChildren(
      el("p", { className: "wiki-muted" }, ["Enter a value to pin it; leave blank to use the geographic baseline."]),
      ...rows,
      saveCancel(
        async () => {
          const pins: Record<string, number> = {};
          for (const [kind, input] of inputs) {
            const raw = input.value.trim();
            if (raw === "") continue; // blank = unpinned → falls back to baseline
            const n = Number(raw);
            if (Number.isFinite(n)) pins[kind] = Math.max(0, Math.min(100, Math.round(n)));
          }
          await commitPins(pins);
        },
        view,
        host,
      ),
    );
    inputs.get("food")?.focus();
  };

  view();
}

// --- Climate (derived, read-only) -------------------------------------------

function renderClimate(hostEl: HTMLElement, ctx: RenderCtx): void {
  const { detail, host } = ctx;
  hostEl.replaceChildren(emptyNote("Computing climate (sampling elevation)…"));
  void host.getClimate(detail).then((c) => {
    if (!c) {
      hostEl.replaceChildren(emptyNote("No climate — this location has no coordinates."));
      return;
    }
    const bar = (label: string, value: number): HTMLElement => {
      const fill = el("div", { className: "wiki-bar-fill" });
      fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
      return el("div", { className: "wiki-bar-row" }, [
        el("span", { className: "wiki-bar-label" }, [label]),
        el("div", { className: "wiki-bar" }, [fill]),
        el("span", { className: "wiki-bar-val" }, [String(Math.round(value))]),
      ]);
    };
    const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(c.windBearing / 45) % 8];
    hostEl.replaceChildren(
      el("p", { className: "wiki-bignum" }, [formatTempF(c.tempC)]),
      el("p", { className: "wiki-muted" }, [`mean temperature · ${c.seasonLabel}`]),
      buildDefList([
        ["Biome", c.isWater ? "Submerged (below new sea level)" : c.biomeLabel],
        ["Effective latitude", `${Math.abs(c.effLat).toFixed(0)}° ${c.effLat >= 0 ? "N" : "S"}`],
        ["Elevation", c.elevationM == null ? "— (DEM unavailable)" : `${Math.round(c.elevationM)} m`],
        ["Prevailing wind", `${c.windBand} → ${compass}`],
      ]),
      el("div", { className: "wiki-bars" }, [bar("Precipitation", c.precip), bar("Growing", c.warmth)]),
      el("p", { className: "wiki-muted" }, [
        "Rule-based from the new pole (Peru): latitude band, real elevation, maritime moderation, orographic rain-shadow, and the post-shift sea level. Scrub the season (bottom-left) to watch it shift.",
      ]),
    );
  });
}

// --- Connections (clickable) ------------------------------------------------

function renderConnections(hostEl: HTMLElement, ctx: RenderCtx): void {
  const { detail, host } = ctx;
  const graph = host.getGraph();
  const nodeId = `loc:${detail.id}`;
  const edges = graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);

  // Simulation pressure badge (when the sim is running), above the routes list.
  const header: HTMLElement[] = [];
  const sim = host.getPressure(detail);
  if (sim) {
    const level = sim.pressure >= 70 ? "bad" : sim.pressure >= 35 ? "warn" : "ok";
    const word = sim.pressure >= 70 ? "starving" : sim.pressure >= 35 ? "strained" : "supplied";
    header.push(
      el("div", { className: "wiki-conn-pressure" }, [
        el("span", { className: "wiki-bar-label" }, [`Turn ${sim.turn} pressure`]),
        el("span", { className: `wiki-tag wiki-${level}` }, [`${Math.round(sim.pressure)} · ${word}`]),
      ]),
    );
  }

  if (edges.length === 0) {
    hostEl.replaceChildren(...header, emptyNote("No routes connect to this location."));
    return;
  }
  const nodeFor = (id: string) => graph.nodes.find((n) => n.id === id);
  const list = el("ul", { className: "wiki-conn-list" });
  for (const e of edges) {
    const otherId = e.from === nodeId ? e.to : e.from;
    const other = nodeFor(otherId);
    const hrs = edgeTravelHours(e);
    const time = hrs === null ? "severed" : `${hrs.toFixed(1)} h`;
    const statusClass = e.status === "intact" ? "ok" : e.status === "damaged" ? "warn" : "bad";

    const label = el("span", { className: "wiki-conn-to" }, [other?.name ?? otherId]);
    const meta = el("span", { className: "wiki-muted" }, [`${e.lengthKm.toFixed(0)} km · ${time}`]);
    const tag = el("span", { className: `wiki-tag wiki-${statusClass}` }, [e.status]);

    // Clickable when the other end is a real location we can open.
    const canHop = other?.locationId != null;
    const li = el("li", { className: canHop ? "wiki-conn wiki-conn-link" : "wiki-conn" }, [label, tag, meta]);
    if (canHop && other?.locationId) {
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      const go = () => host.navigateTo(other.locationId as string);
      li.addEventListener("click", go);
      li.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          go();
        }
      });
    }
    list.append(li);
  }
  hostEl.replaceChildren(...header, list);
}

// --- Notes (tags, markdown, relative time) ----------------------------------

function renderNotes(hostEl: HTMLElement, ctx: RenderCtx): void {
  const { detail, host } = ctx;
  const listEl = el("div", { className: "wiki-notes" }, [emptyNote("Loading notes…")]);

  const refresh = async () => {
    try {
      const notes = await loadNotesFor("location", detail.id);
      renderNoteList(listEl, notes, refresh, host);
    } catch (err) {
      listEl.replaceChildren(emptyNote(err instanceof Error ? err.message : String(err)));
    }
  };

  hostEl.replaceChildren(listEl);

  if (host.canEdit()) {
    const bodyIn = el("textarea", {
      className: "wiki-note-input",
      placeholder: "Add a note… **markdown**, [[wiki-links]] supported",
      rows: 2,
    });
    const tagsIn = el("input", {
      className: "wiki-note-tags",
      type: "text",
      placeholder: "tags (comma-separated)",
    });
    const addBtn = el("button", { type: "button", className: "wiki-btn" }, ["Add note"]);
    addBtn.addEventListener("click", () => {
      const body = bodyIn.value.trim();
      if (!body) return;
      const tags = tagsIn.value.split(",").map((t) => t.trim()).filter(Boolean);
      addBtn.disabled = true;
      addNote("location", detail.id, body, tags)
        .then(() => {
          bodyIn.value = "";
          tagsIn.value = "";
          return refresh();
        })
        .catch((err: unknown) => host.setStatus(err instanceof Error ? err.message : String(err), "error"))
        .finally(() => (addBtn.disabled = false));
    });
    hostEl.append(el("div", { className: "wiki-note-form" }, [bodyIn, tagsIn, addBtn]));
  }

  void refresh();
}

function renderNoteList(
  container: HTMLElement,
  notes: Note[],
  refresh: () => void | Promise<void>,
  host: WikiHost,
): void {
  if (notes.length === 0) {
    container.replaceChildren(emptyNote("No notes yet."));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const note of notes) {
    const body = el("div", { className: "wiki-note-body" });
    body.innerHTML = renderInlineMarkdown(note.body);
    const meta = el("div", { className: "wiki-note-meta" }, [
      ...(note.tags ?? []).map((t) => el("span", { className: "wiki-tag" }, [t])),
      el("span", { className: "wiki-muted", title: new Date(note.created_at).toLocaleString() }, [
        relativeTime(note.created_at),
      ]),
    ]);
    if (host.canEdit()) {
      const del = el("button", { type: "button", className: "wiki-note-del", title: "Delete note" }, ["×"]);
      del.addEventListener("click", () => {
        del.disabled = true;
        deleteNote(note.id)
          .then(refresh)
          .catch((err: unknown) => {
            host.setStatus(err instanceof Error ? err.message : String(err), "error");
            del.disabled = false;
          });
      });
      meta.append(del);
    }
    frag.append(el("div", { className: "wiki-note" }, [body, meta]));
  }
  container.replaceChildren(frag);
}

// --- Shared edit-form widgets ----------------------------------------------

function textField(label: string, value: string, type = "text"): { row: HTMLElement; input: HTMLInputElement } {
  const input = el("input", { className: "wiki-field-input", type, value });
  const row = el("label", { className: "wiki-field" }, [el("span", { className: "wiki-field-label" }, [label]), input]);
  return { row, input };
}

function editButton(onEdit: () => void): HTMLElement {
  const btn = el("button", { type: "button", className: "wiki-edit-btn" }, ["Edit"]);
  btn.addEventListener("click", onEdit);
  return btn;
}

function saveCancel(onSave: () => Promise<void>, onCancel: () => void, host: WikiHost): HTMLElement {
  const save = el("button", { type: "button", className: "wiki-btn" }, ["Save"]);
  const cancel = el("button", { type: "button", className: "wiki-btn-ghost" }, ["Cancel"]);
  save.addEventListener("click", () => {
    save.disabled = true;
    cancel.disabled = true;
    onSave()
      .then(() => host.setStatus("Saved."))
      .catch((err: unknown) => {
        host.setStatus(err instanceof Error ? err.message : String(err), "error");
        save.disabled = false;
        cancel.disabled = false;
      });
  });
  cancel.addEventListener("click", onCancel);
  return el("div", { className: "wiki-form-actions" }, [save, cancel]);
}

const TABS: Tab[] = [
  { id: "overview", label: "Overview", render: renderOverview },
  { id: "population", label: "Population", render: renderPopulation },
  { id: "resources", label: "Resources", render: renderResources },
  { id: "climate", label: "Climate", render: renderClimate },
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
  private currentId: string | null = null;
  private host: WikiHost;
  private onClose: () => void;

  constructor(mount: HTMLElement, host: WikiHost, onClose: () => void) {
    this.host = host;
    this.onClose = onClose;
    this.titleEl = el("h2", { className: "wiki-title", id: "wiki-title" });
    const closeBtn = el("button", { type: "button", className: "wiki-close", title: "Close (Esc)" }, ["×"]);
    closeBtn.setAttribute("aria-label", "Close panel");
    closeBtn.addEventListener("click", () => this.close());

    this.tabsEl = el("div", { className: "wiki-tabs", role: "tablist" });
    this.bodyEl = el("div", { className: "wiki-body", role: "tabpanel" });

    this.root = el("aside", { className: "wiki-panel", hidden: true }, [
      el("header", { className: "wiki-header" }, [this.titleEl, closeBtn]),
      this.tabsEl,
      this.bodyEl,
    ]);
    this.root.setAttribute("aria-labelledby", "wiki-title");
    mount.append(this.root);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  /** Open (or switch) the panel to a location id, keeping the active tab. */
  open(id: string): void {
    const detail = this.host.getDetail(id);
    if (!detail) return;
    this.currentId = id;
    this.titleEl.textContent = detail.name;
    this.buildTabs();
    this.root.hidden = false;
    this.select(this.active);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.currentId = null;
    this.onClose();
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Re-render the active tab from fresh host data (after an edit/reload). */
  rerenderActive(): void {
    if (this.currentId == null) return;
    const detail = this.host.getDetail(this.currentId);
    if (detail) this.titleEl.textContent = detail.name;
    this.select(this.active);
  }

  private buildTabs(): void {
    this.tabsEl.replaceChildren();
    TABS.forEach((tab, idx) => {
      const btn = el("button", { type: "button", className: "wiki-tab", role: "tab" }, [tab.label]);
      btn.dataset.tab = tab.id;
      btn.id = `wiki-tab-${tab.id}`;
      btn.addEventListener("click", () => this.select(tab.id));
      btn.addEventListener("keydown", (e) => this.onTabKey(e, idx));
      this.tabsEl.append(btn);
    });
  }

  /** Arrow-key navigation across the tablist (WAI-ARIA pattern). */
  private onTabKey(e: KeyboardEvent, idx: number): void {
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else return;
    e.preventDefault();
    this.select(TABS[next].id);
    this.tabsEl.querySelectorAll<HTMLButtonElement>(".wiki-tab")[next]?.focus();
  }

  private select(id: TabId): void {
    if (this.currentId == null) return;
    const detail = this.host.getDetail(this.currentId);
    if (!detail) return;
    this.active = id;
    for (const btn of this.tabsEl.querySelectorAll<HTMLButtonElement>(".wiki-tab")) {
      const selected = btn.dataset.tab === id;
      btn.setAttribute("aria-selected", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    }
    this.bodyEl.setAttribute("aria-labelledby", `wiki-tab-${id}`);
    this.bodyEl.replaceChildren();
    TABS.find((t) => t.id === id)?.render(this.bodyEl, { detail, panel: this, host: this.host });
  }
}
