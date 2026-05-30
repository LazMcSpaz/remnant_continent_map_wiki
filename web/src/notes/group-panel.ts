// Corridor (route group) panel: name + labels, member list, derived aggregate
// (length, travel, closed-if-any-member-severed), notes, and member management.
// "Add routes" arms a mode where route clicks add members (handled in main).

import type { RouteGroup } from "../state/db-types";
import type { GroupAggregate } from "../derived/network-graph";
import {
  updateRouteGroup,
  deleteRouteGroup,
  removeRouteGroupMember,
  loadNotesFor,
  addNote,
  deleteNote,
} from "../layers/features";
import type { Note } from "../state/db-types";
import { renderInlineMarkdown, relativeTime } from "./markdown";

/** A member route, as the panel needs to display it. */
export interface GroupMemberView {
  routeId: string;
  label: string; // e.g. "major rail"
  severed: boolean;
}

export interface GroupHost {
  getGroup(id: string): RouteGroup | undefined;
  getMembers(id: string): GroupMemberView[];
  getAggregate(id: string): GroupAggregate;
  /** Arm add-members mode: route clicks add to this corridor. */
  beginAddMembers(groupId: string): void;
  reloadData(): Promise<void>;
  canEdit(): boolean;
  setStatus(text: string, kind?: "info" | "error"): void;
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

export class GroupPanel {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private host: GroupHost;
  private onClose: () => void;
  private currentId: string | null = null;

  constructor(mount: HTMLElement, host: GroupHost, onClose: () => void) {
    this.host = host;
    this.onClose = onClose;
    this.titleEl = el("h2", { className: "terra-title", id: "group-title" });
    const closeBtn = el("button", { type: "button", className: "wiki-close", title: "Close (Esc)" }, ["×"]);
    closeBtn.addEventListener("click", () => this.close());
    this.bodyEl = el("div", { className: "terra-body" });
    this.root = el("aside", { className: "terra-panel", hidden: true }, [
      el("header", { className: "wiki-header" }, [this.titleEl, closeBtn]),
      this.bodyEl,
    ]);
    this.root.setAttribute("aria-labelledby", "group-title");
    mount.append(this.root);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  open(id: string): void {
    if (!this.host.getGroup(id)) return;
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
  currentGroupId(): string | null {
    return this.currentId;
  }
  refresh(): void {
    if (this.currentId != null) this.render();
  }

  private render(): void {
    if (this.currentId == null) return;
    const group = this.host.getGroup(this.currentId);
    if (!group) {
      this.bodyEl.replaceChildren(el("p", { className: "wiki-muted" }, ["Corridor no longer exists."]));
      return;
    }
    const agg = this.host.getAggregate(this.currentId);
    this.titleEl.textContent = group.name;
    this.bodyEl.replaceChildren();

    if (agg.closed) {
      this.bodyEl.append(
        el("p", { className: "route-closed-banner" }, [
          `⛔ Corridor closed — ${agg.severedCount} of ${agg.memberCount} segments severed.`,
        ]),
      );
    }

    // Derived aggregate.
    const travel = agg.travelHours == null ? "severed" : `${agg.travelHours.toFixed(1)} h`;
    this.bodyEl.append(
      el("div", { className: "terra-derived" }, [
        el("h3", { className: "terra-section" }, ["Derived (whole corridor)"]),
        el("div", { className: "terra-derived-row" }, [el("span", {}, [`${agg.lengthKm.toFixed(0)} km`]), el("span", { className: "wiki-muted" }, ["total length"])]),
        el("div", { className: "terra-derived-row" }, [el("span", {}, [travel]), el("span", { className: "wiki-muted" }, ["end-to-end travel"])]),
      ]),
    );

    if (this.host.canEdit()) this.bodyEl.append(this.editForm(group));
    this.bodyEl.append(this.membersSection(this.currentId));
    this.bodyEl.append(this.notesSection(this.currentId));
  }

  private editForm(group: RouteGroup): HTMLElement {
    const name = el("input", { className: "terra-input", type: "text", value: group.name });
    const labels = el("input", { className: "terra-input", type: "text", value: group.labels.join(", "), placeholder: "labels (comma-separated)" });
    const save = el("button", { type: "button", className: "wiki-btn" }, ["Save"]);
    save.addEventListener("click", () => {
      save.disabled = true;
      updateRouteGroup(group.id, {
        name: name.value.trim() || group.name,
        labels: labels.value.split(",").map((s) => s.trim()).filter(Boolean),
      })
        .then(() => this.host.reloadData())
        .then(() => { this.host.setStatus("Corridor saved."); this.refresh(); })
        .catch((err: unknown) => { this.host.setStatus(err instanceof Error ? err.message : String(err), "error"); save.disabled = false; });
    });
    const del = el("button", { type: "button", className: "wiki-btn-ghost" }, ["Delete corridor"]);
    del.addEventListener("click", () => {
      if (!window.confirm(`Delete corridor "${group.name}"? (member routes are kept)`)) return;
      deleteRouteGroup(group.id)
        .then(() => this.host.reloadData())
        .then(() => this.close())
        .catch((err: unknown) => this.host.setStatus(err instanceof Error ? err.message : String(err), "error"));
    });
    return el("div", { className: "terra-form" }, [
      el("h3", { className: "terra-section" }, ["Corridor"]),
      el("label", { className: "terra-field" }, [el("span", { className: "terra-label" }, ["Name"]), name]),
      el("label", { className: "terra-field" }, [el("span", { className: "terra-label" }, ["Labels"]), labels]),
      el("div", { className: "terra-actions" }, [save, del]),
    ]);
  }

  private membersSection(groupId: string): HTMLElement {
    const wrap = el("div", { className: "terra-form" }, [el("h3", { className: "terra-section" }, ["Segments"])]);
    const members = this.host.getMembers(groupId);
    if (members.length === 0) {
      wrap.append(el("p", { className: "wiki-muted" }, ["No segments yet. Add some below."]));
    } else {
      const list = el("div", { className: "break-list" });
      for (const m of members) {
        const remove = el("button", { type: "button", className: "wiki-note-del", title: "Remove from corridor" }, ["×"]);
        remove.addEventListener("click", () => {
          remove.disabled = true;
          removeRouteGroupMember(groupId, m.routeId)
            .then(() => this.host.reloadData())
            .then(() => this.refresh())
            .catch((err: unknown) => { this.host.setStatus(err instanceof Error ? err.message : String(err), "error"); remove.disabled = false; });
        });
        list.append(
          el("div", { className: "break-row" }, [
            el("span", {}, [m.label]),
            ...(m.severed ? [el("span", { className: "wiki-tag break-blockade" }, ["severed"])] : []),
            remove,
          ]),
        );
      }
      wrap.append(list);
    }
    if (this.host.canEdit()) {
      const add = el("button", { type: "button", className: "wiki-btn" }, ["Add routes"]);
      add.addEventListener("click", () => this.host.beginAddMembers(groupId));
      wrap.append(el("div", { className: "break-add" }, [add]));
    }
    return wrap;
  }

  private notesSection(groupId: string): HTMLElement {
    const wrap = el("div", { className: "terra-form" }, [el("h3", { className: "terra-section" }, ["Notes"])]);
    const list = el("div", { className: "wiki-notes" }, [el("p", { className: "wiki-muted" }, ["Loading notes…"])]);
    wrap.append(list);
    const refresh = async () => {
      try {
        this.renderNotes(list, await loadNotesFor("route_group", groupId), refresh);
      } catch (err) {
        list.replaceChildren(el("p", { className: "wiki-muted" }, [err instanceof Error ? err.message : String(err)]));
      }
    };
    if (this.host.canEdit()) {
      const input = el("textarea", { className: "wiki-note-input", placeholder: "Add a note…", rows: 2 });
      const tags = el("input", { className: "wiki-note-tags", type: "text", placeholder: "tags (comma-separated)" });
      const addBtn = el("button", { type: "button", className: "wiki-btn" }, ["Add note"]);
      addBtn.addEventListener("click", () => {
        const body = input.value.trim();
        if (!body) return;
        addBtn.disabled = true;
        addNote("route_group", groupId, body, tags.value.split(",").map((t) => t.trim()).filter(Boolean))
          .then(() => { input.value = ""; tags.value = ""; return refresh(); })
          .catch((err: unknown) => this.host.setStatus(err instanceof Error ? err.message : String(err), "error"))
          .finally(() => (addBtn.disabled = false));
      });
      wrap.append(el("div", { className: "wiki-note-form" }, [input, tags, addBtn]));
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
