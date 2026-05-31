// Route panel: opens on clicking a route. Edits its class/status/kind/purpose,
// shows the derived length + travel time, and read/add/delete notes
// (notes.target_type = 'route'). Saving cascades — the caller reloads, which
// rebuilds the network graph (class/status feed edge speed and passability).

import type { RouteProps } from "../layers/features";
import {
  updateRouteFields,
  deleteFeature,
  setRouteBreakFaction,
  loadNotesFor,
  addNote,
  deleteNote,
} from "../layers/features";
import type { Note, RouteBreakGeo, Faction } from "../state/db-types";
import { renderInlineMarkdown, relativeTime } from "./markdown";
import {
  TRAVEL_MODES,
  getTravelMode,
  setTravelMode,
  travelHours,
  formatHours,
  formatMiles,
  LANDSHIP_MODE,
} from "../derived/travel";

export interface RouteDetail {
  props: RouteProps;
  lengthKm: number | null;
  travelHours: number | null;
}

export interface RouteHost {
  getRoute(id: string): RouteDetail | undefined;
  getBreaks(routeId: string): RouteBreakGeo[];
  factions(): Faction[];
  /** Arm placement: the next map click drops a break (kind) on this route. */
  beginPlaceBreak(routeId: string, kind: string): void;
  setBreakActive(id: string, active: boolean): Promise<void>;
  deleteBreak(id: string): Promise<void>;
  reloadData(): Promise<void>;
  canEdit(): boolean;
  setStatus(text: string, kind?: "info" | "error"): void;
}

const CLASSES = ["major", "minor", "secret"];
const STATUSES = ["intact", "damaged", "destroyed"];
const KINDS = ["road", "rail", "trail", "landship"];
const BREAK_KINDS = ["natural", "blockade", "toll"];

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

function select(label: string, value: string, options: string[]) {
  const sel = el("select", { className: "terra-input" });
  for (const o of options) {
    const opt = el("option", { value: o }, [o]);
    if (o === value) opt.selected = true;
    sel.append(opt);
  }
  return { row: el("label", { className: "terra-field" }, [el("span", { className: "terra-label" }, [label]), sel]), sel };
}

export class RoutePanel {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private host: RouteHost;
  private onClose: () => void;
  private currentId: string | null = null;

  constructor(mount: HTMLElement, host: RouteHost, onClose: () => void) {
    this.host = host;
    this.onClose = onClose;
    this.titleEl = el("h2", { className: "terra-title", id: "route-title" });
    const closeBtn = el("button", { type: "button", className: "wiki-close", title: "Close (Esc)" }, ["×"]);
    closeBtn.setAttribute("aria-label", "Close route panel");
    closeBtn.addEventListener("click", () => this.close());
    this.bodyEl = el("div", { className: "terra-body" });
    this.root = el("aside", { className: "terra-panel", hidden: true }, [
      el("header", { className: "wiki-header" }, [this.titleEl, closeBtn]),
      this.bodyEl,
    ]);
    this.root.setAttribute("aria-labelledby", "route-title");
    mount.append(this.root);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  open(id: string): void {
    if (!this.host.getRoute(id)) return;
    this.currentId = id;
    this.render();
    this.root.hidden = false;
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
  refresh(): void {
    if (this.currentId != null) this.render();
  }

  private render(): void {
    if (this.currentId == null) return;
    const d = this.host.getRoute(this.currentId);
    if (!d) {
      this.bodyEl.replaceChildren(el("p", { className: "wiki-muted" }, ["Route no longer exists."]));
      return;
    }
    const p = d.props;
    const isLandship = p.kind === "landship";
    this.titleEl.textContent = `${p.routeClass} ${p.kind}`;
    this.bodyEl.replaceChildren();

    // Owner + derived readout. Landship routes are locked to the Landship mode.
    const mode = isLandship ? LANDSHIP_MODE : getTravelMode();
    const len = d.lengthKm == null ? "—" : formatMiles(d.lengthKm);
    const travel = d.lengthKm == null ? "—" : formatHours(travelHours(d.lengthKm, p.status, mode));
    const ownerName = this.factionName(p.ownerFactionId);
    this.bodyEl.append(
      el("div", { className: "terra-derived" }, [
        el("h3", { className: "terra-section" }, ["Derived"]),
        el("div", { className: "terra-derived-row" }, [el("span", {}, [len]), el("span", { className: "wiki-muted" }, ["length"])]),
        el("div", { className: "terra-derived-row" }, [el("span", {}, [travel]), el("span", { className: "wiki-muted" }, ["travel time"])]),
        el("div", { className: "terra-derived-row" }, [el("span", {}, [ownerName]), el("span", { className: "wiki-muted" }, ["owner"])]),
        this.modePicker(isLandship),
      ]),
    );

    if (this.host.canEdit()) this.bodyEl.append(this.editForm(d.props));
    this.bodyEl.append(this.breaksSection(this.currentId));
    this.bodyEl.append(this.notesSection(this.currentId));
  }

  private factionName(id: string | null): string {
    if (!id) return "Unaligned";
    return this.host.factions().find((f) => f.id === id)?.name ?? "Unaligned";
  }

  /** Travel-mode picker. Landship routes are fixed to the Landship mode. */
  private modePicker(isLandship: boolean): HTMLElement {
    if (isLandship) {
      return el("label", { className: "terra-field" }, [
        el("span", { className: "terra-label" }, ["Travel mode"]),
        el("div", { className: "terra-input terra-fixed" }, [`${LANDSHIP_MODE.label} — ${LANDSHIP_MODE.mph} mph`]),
      ]);
    }
    const sel = el("select", { className: "terra-input" });
    const cur = getTravelMode();
    for (const m of TRAVEL_MODES) {
      const opt = el("option", { value: m.id }, [`${m.label} — ${m.mph} mph`]);
      if (m.id === cur.id) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      setTravelMode(sel.value);
      this.refresh();
    });
    return el("label", { className: "terra-field" }, [el("span", { className: "terra-label" }, ["Travel mode"]), sel]);
  }

  private breaksSection(routeId: string): HTMLElement {
    const wrap = el("div", { className: "terra-form" }, [el("h3", { className: "terra-section" }, ["Breaks"])]);
    const breaks = this.host.getBreaks(routeId);

    if (breaks.length === 0) {
      wrap.append(el("p", { className: "wiki-muted" }, ["No breaks. The route is open end-to-end."]));
    } else {
      const list = el("div", { className: "break-list" });
      for (const b of breaks) {
        const toggle = el("input", { type: "checkbox", checked: b.active, title: "Active (closes route)" });
        toggle.addEventListener("change", () => {
          toggle.disabled = true;
          this.host.setBreakActive(b.id, toggle.checked)
            .then(() => this.host.reloadData())
            .then(() => this.refresh())
            .catch((err: unknown) => {
              this.host.setStatus(err instanceof Error ? err.message : String(err), "error");
              toggle.disabled = false;
            });
        });
        const del = el("button", { type: "button", className: "wiki-note-del", title: "Delete break" }, ["×"]);
        del.addEventListener("click", () => {
          del.disabled = true;
          this.host.deleteBreak(b.id)
            .then(() => this.host.reloadData())
            .then(() => this.refresh())
            .catch((err: unknown) => {
              this.host.setStatus(err instanceof Error ? err.message : String(err), "error");
              del.disabled = false;
            });
        });
        // Faction control of the break (who mans the gate / holds the barricade).
        const fac = this.factionSelect(b.faction_id);
        fac.title = "Controlled by";
        fac.addEventListener("change", () => {
          fac.disabled = true;
          setRouteBreakFaction(b.id, fac.value || null)
            .then(() => this.host.reloadData())
            .then(() => this.refresh())
            .catch((err: unknown) => {
              this.host.setStatus(err instanceof Error ? err.message : String(err), "error");
              fac.disabled = false;
            });
        });
        list.append(
          el("div", { className: "break-row" }, [
            toggle,
            el("span", { className: `wiki-tag break-${b.kind}` }, [b.kind]),
            fac,
            del,
          ]),
        );
      }
      wrap.append(list);
    }

    if (this.host.canEdit()) {
      const kind = el("select", { className: "terra-input" });
      for (const k of BREAK_KINDS) kind.append(el("option", { value: k }, [k]));
      const place = el("button", { type: "button", className: "wiki-btn" }, ["Place break"]);
      place.addEventListener("click", () => {
        this.host.beginPlaceBreak(routeId, kind.value);
      });
      wrap.append(el("div", { className: "break-add" }, [kind, place]));
    }
    return wrap;
  }

  /** A faction <select> (Unaligned + factions), returns the chosen id or null. */
  private factionSelect(currentId: string | null) {
    const sel = el("select", { className: "terra-input" });
    const none = el("option", { value: "" }, ["Unaligned"]);
    if (!currentId) none.selected = true;
    sel.append(none);
    for (const f of this.host.factions()) {
      const opt = el("option", { value: f.id }, [f.name]);
      if (f.id === currentId) opt.selected = true;
      sel.append(opt);
    }
    return sel;
  }

  private editForm(p: RouteProps): HTMLElement {
    const cls = select("Class", p.routeClass, CLASSES);
    const status = select("Status", p.status, STATUSES);
    const kind = select("Kind", p.kind, KINDS);
    const owner = this.factionSelect(p.ownerFactionId);
    const purpose = el("input", { className: "terra-input", type: "text", value: p.purpose ?? "" });

    const save = el("button", { type: "button", className: "wiki-btn" }, ["Save"]);
    save.addEventListener("click", () => {
      save.disabled = true;
      updateRouteFields(p.id, {
        route_class: cls.sel.value,
        status: status.sel.value,
        kind: kind.sel.value,
        owner_faction_id: owner.value || null,
        purpose: purpose.value.trim() || null,
      })
        .then(() => this.host.reloadData())
        .then(() => {
          this.host.setStatus("Route saved — graph recomputed.");
          this.refresh();
        })
        .catch((err: unknown) => {
          this.host.setStatus(err instanceof Error ? err.message : String(err), "error");
          save.disabled = false;
        });
    });

    const del = el("button", { type: "button", className: "wiki-btn-ghost" }, ["Delete route"]);
    del.addEventListener("click", () => {
      if (!window.confirm("Delete this route? (breaks on it are removed too)")) return;
      deleteFeature("route", p.id)
        .then(() => this.host.reloadData())
        .then(() => this.close())
        .catch((err: unknown) => this.host.setStatus(err instanceof Error ? err.message : String(err), "error"));
    });

    return el("div", { className: "terra-form" }, [
      el("h3", { className: "terra-section" }, ["Attributes"]),
      cls.row, status.row, kind.row,
      el("label", { className: "terra-field" }, [el("span", { className: "terra-label" }, ["Owner"]), owner]),
      el("label", { className: "terra-field" }, [el("span", { className: "terra-label" }, ["Purpose"]), purpose]),
      el("div", { className: "terra-actions" }, [save, del]),
    ]);
  }

  private notesSection(routeId: string): HTMLElement {
    const wrap = el("div", { className: "terra-form" }, [el("h3", { className: "terra-section" }, ["Notes"])]);
    const list = el("div", { className: "wiki-notes" }, [el("p", { className: "wiki-muted" }, ["Loading notes…"])]);
    wrap.append(list);

    const refresh = async () => {
      try {
        const notes = await loadNotesFor("route", routeId);
        this.renderNotes(list, notes, refresh);
      } catch (err) {
        list.replaceChildren(el("p", { className: "wiki-muted" }, [err instanceof Error ? err.message : String(err)]));
      }
    };

    if (this.host.canEdit()) {
      const input = el("textarea", { className: "wiki-note-input", placeholder: "Add a note…", rows: 2 });
      const tags = el("input", { className: "wiki-note-tags", type: "text", placeholder: "tags (comma-separated)" });
      const add = el("button", { type: "button", className: "wiki-btn" }, ["Add note"]);
      add.addEventListener("click", () => {
        const body = input.value.trim();
        if (!body) return;
        add.disabled = true;
        addNote("route", routeId, body, tags.value.split(",").map((t) => t.trim()).filter(Boolean))
          .then(() => { input.value = ""; tags.value = ""; return refresh(); })
          .catch((err: unknown) => this.host.setStatus(err instanceof Error ? err.message : String(err), "error"))
          .finally(() => (add.disabled = false));
      });
      wrap.append(el("div", { className: "wiki-note-form" }, [input, tags, add]));
    }
    void refresh();
    return wrap;
  }

  private renderNotes(container: HTMLElement, notes: Note[], refresh: () => void | Promise<void>): void {
    if (notes.length === 0) {
      container.replaceChildren(el("p", { className: "wiki-muted" }, ["No notes yet."]));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const note of notes) {
      const body = el("div", { className: "wiki-note-body" });
      body.innerHTML = renderInlineMarkdown(note.body);
      const meta = el("div", { className: "wiki-note-meta" }, [
        ...(note.tags ?? []).map((t) => el("span", { className: "wiki-tag" }, [t])),
        el("span", { className: "wiki-muted" }, [relativeTime(note.created_at)]),
      ]);
      if (this.host.canEdit()) {
        const del = el("button", { type: "button", className: "wiki-note-del", title: "Delete note" }, ["×"]);
        del.addEventListener("click", () => {
          del.disabled = true;
          deleteNote(note.id).then(refresh).catch((err: unknown) => {
            this.host.setStatus(err instanceof Error ? err.message : String(err), "error");
            del.disabled = false;
          });
        });
        meta.append(del);
      }
      frag.append(el("div", { className: "wiki-note" }, [body, meta]));
    }
    container.replaceChildren(frag);
  }
}
