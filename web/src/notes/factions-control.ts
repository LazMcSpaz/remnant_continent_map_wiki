// Factions control (top-left): authoring for the faction economy attributes
// the simulation reads — tech level (scales production), influence (manual,
// reserved), and the pairwise relationship matrix (allies/friendly/tense/
// hostile) that gates how much surplus flows between factions.
//
// Pure DOM; talks only to a FactionsHost (implemented in main.ts). Edits persist
// then trigger a reload + sim refresh through the host.

import type { Faction, RelationLevel } from "../state/db-types";

export interface FactionsHost {
  listFactions(): Faction[];
  /** Current stance between two factions (defaults to "friendly"). */
  relation(a: string, b: string): RelationLevel;
  /** Faction wealth at the current sim turn (null if sim not running). */
  wealth(factionId: string): number | null;
  setTechLevel(id: string, tech: number): Promise<void>;
  setInfluence(id: string, influence: number): Promise<void>;
  setRelation(a: string, b: string, level: RelationLevel): Promise<void>;
  canEdit(): boolean;
}

export interface FactionsControl {
  refresh(): void;
}

const LEVELS: RelationLevel[] = ["allies", "friendly", "tense", "hostile"];

export function mountFactionsControl(container: HTMLElement, host: FactionsHost): FactionsControl {
  let expanded = false;

  const render = (): void => {
    container.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Factions";
    container.append(heading);

    const factions = host.listFactions();
    if (factions.length === 0) {
      container.append(muted("No factions yet."));
      container.hidden = false;
      return;
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wiki-btn";
    toggle.textContent = expanded ? "Hide details" : "Edit economy & relations";
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      render();
    });
    container.append(toggle);

    if (!expanded) {
      // Compact: name + tech + wealth (if simulating).
      for (const f of factions) {
        const row = document.createElement("div");
        row.className = "faction-row";
        row.append(swatch(f.color), text(f.name, "faction-name"));
        const w = host.wealth(f.id);
        const meta = w == null ? `T${f.tech_level}` : `T${f.tech_level} · ${Math.round(w).toLocaleString()}⛀`;
        row.append(text(meta, "faction-meta"));
        container.append(row);
      }
      container.hidden = false;
      return;
    }

    // Expanded: per-faction tech/influence editors.
    for (const f of factions) {
      const card = document.createElement("div");
      card.className = "faction-card";
      const head = document.createElement("div");
      head.className = "faction-row";
      head.append(swatch(f.color), text(f.name, "faction-name"));
      const w = host.wealth(f.id);
      if (w != null) head.append(text(`${Math.round(w).toLocaleString()}⛀`, "faction-meta"));
      card.append(head);

      if (host.canEdit()) {
        card.append(
          numberField("Tech", f.tech_level, 1, 10, (v) => void host.setTechLevel(f.id, v)),
          numberField("Influence", f.influence, 0, 1000, (v) => void host.setInfluence(f.id, v)),
        );
      } else {
        card.append(muted(`Tech ${f.tech_level} · Influence ${f.influence}`));
      }
      container.append(card);
    }

    // Relationship matrix (each unordered pair once).
    if (factions.length >= 2) {
      const relHead = document.createElement("div");
      relHead.className = "sim-section";
      relHead.textContent = "Relations";
      container.append(relHead);

      for (let i = 0; i < factions.length; i++) {
        for (let j = i + 1; j < factions.length; j++) {
          const a = factions[i];
          const b = factions[j];
          const row = document.createElement("div");
          row.className = "faction-rel-row";
          row.append(text(`${a.name} ↔ ${b.name}`, "faction-rel-pair"));
          if (host.canEdit()) {
            const sel = document.createElement("select");
            sel.className = "faction-rel-select";
            for (const lv of LEVELS) {
              const opt = document.createElement("option");
              opt.value = lv;
              opt.textContent = lv;
              sel.append(opt);
            }
            sel.value = host.relation(a.id, b.id);
            sel.addEventListener("change", () => {
              void host.setRelation(a.id, b.id, sel.value as RelationLevel);
            });
            row.append(sel);
          } else {
            row.append(text(host.relation(a.id, b.id), "faction-meta"));
          }
          container.append(row);
        }
      }
    }

    container.hidden = false;
  };

  render();
  return { refresh: render };
}

function swatch(color: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "legend-swatch";
  s.style.background = color;
  return s;
}

function text(content: string, className: string): HTMLElement {
  const s = document.createElement("span");
  s.className = className;
  s.textContent = content;
  return s;
}

function muted(content: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "wiki-muted";
  p.style.fontSize = "0.75rem";
  p.textContent = content;
  return p;
}

function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  onCommit: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "faction-field";
  const l = document.createElement("span");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener("change", () => {
    let v = Number(input.value);
    if (!Number.isFinite(v)) v = value;
    v = Math.max(min, Math.min(max, Math.round(v)));
    input.value = String(v);
    onCommit(v);
  });
  wrap.append(l, input);
  return wrap;
}
