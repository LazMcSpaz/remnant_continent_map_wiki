// Factions control (top-left). A faction's economy figures are now DERIVED from
// its cities (tech = pop-weighted average, influence = sum), so this panel shows
// those read-only and lets you author the things that *are* faction-level: name,
// color, tier (major/minor), and the pairwise relationship matrix that gates how
// much surplus flows between factions.
//
// Major factions always list; minor ones appear only when the "Show minor" toggle
// is on. Pure DOM; talks only to a FactionsHost (implemented in main.ts).

import type { Faction, FactionTier, RelationLevel } from "../state/db-types";

export interface FactionView {
  faction: Faction;
  /** Derived pop-weighted tech (null if the faction has no cities). */
  techLevel: number | null;
  /** Derived summed influence. */
  influence: number;
  cityCount: number;
  /** Sim wealth at the current turn (null if sim not running). */
  wealth: number | null;
}

export interface FactionsHost {
  /** All factions with their derived stats. */
  listFactions(): FactionView[];
  /** Current stance between two factions (defaults to "friendly"). */
  relation(a: string, b: string): RelationLevel;
  setTier(id: string, tier: FactionTier): Promise<void>;
  setColor(id: string, color: string): Promise<void>;
  setRelation(a: string, b: string, level: RelationLevel): Promise<void>;
  canEdit(): boolean;
}

export interface FactionsControl {
  refresh(): void;
}

const LEVELS: RelationLevel[] = ["allies", "friendly", "tense", "hostile"];

export function mountFactionsControl(container: HTMLElement, host: FactionsHost): FactionsControl {
  let expanded = false;
  let showMinor = false;

  const render = (): void => {
    container.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Factions";
    container.append(heading);

    const all = host.listFactions();
    if (all.length === 0) {
      container.append(muted("No factions yet. Assign a city to one from its Overview tab."));
      container.hidden = false;
      return;
    }

    // Minor factions only show behind the toggle.
    const hasMinor = all.some((v) => v.faction.tier === "minor");
    const shown = all.filter((v) => v.faction.tier === "major" || showMinor);

    if (hasMinor) {
      const t = document.createElement("label");
      t.className = "faction-toggle";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = showMinor;
      cb.addEventListener("change", () => {
        showMinor = cb.checked;
        render();
      });
      t.append(cb, text("Show minor factions", "faction-meta"));
      container.append(t);
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wiki-btn";
    toggle.textContent = expanded ? "Hide details" : "Details & relations";
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      render();
    });
    container.append(toggle);

    for (const v of shown) {
      const f = v.faction;
      const card = document.createElement("div");
      card.className = "faction-card";

      const head = document.createElement("div");
      head.className = "faction-row";
      head.append(swatch(f.color), text(f.name, "faction-name"));
      if (f.tier === "minor") head.append(text("minor", "faction-tag"));
      const techStr = v.techLevel == null ? "—" : v.techLevel.toFixed(1);
      const meta = v.wealth == null
        ? `T${techStr} · ${v.cityCount}c`
        : `T${techStr} · ${Math.round(v.wealth).toLocaleString()}⛀`;
      head.append(text(meta, "faction-meta"));
      card.append(head);

      if (expanded) {
        card.append(
          statLine("Tech (pop-weighted)", v.techLevel == null ? "—" : v.techLevel.toFixed(2)),
          statLine("Influence (sum)", String(v.influence)),
          statLine("Cities", String(v.cityCount)),
        );
        if (host.canEdit()) {
          const tierSel = document.createElement("select");
          tierSel.className = "faction-rel-select";
          for (const tier of ["major", "minor"] as FactionTier[]) {
            tierSel.add(new Option(tier, tier));
          }
          tierSel.value = f.tier;
          tierSel.addEventListener("change", () => void host.setTier(f.id, tierSel.value as FactionTier));
          const row = document.createElement("div");
          row.className = "faction-rel-row";
          row.append(text("Tier", "faction-rel-pair"), tierSel);
          card.append(row);

          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.className = "faction-color-input";
          colorInput.value = normalizeHex(f.color);
          // Commit on change (picker close), not every drag tick.
          colorInput.addEventListener("change", () => void host.setColor(f.id, colorInput.value));
          const crow = document.createElement("div");
          crow.className = "faction-rel-row";
          crow.append(text("Color", "faction-rel-pair"), colorInput);
          card.append(crow);
        }
      }
      container.append(card);
    }

    // Relationship matrix (expanded only), across the shown factions.
    if (expanded && shown.length >= 2) {
      const relHead = document.createElement("div");
      relHead.className = "sim-section";
      relHead.textContent = "Relations";
      container.append(relHead);

      for (let i = 0; i < shown.length; i++) {
        for (let j = i + 1; j < shown.length; j++) {
          const a = shown[i].faction;
          const b = shown[j].faction;
          const row = document.createElement("div");
          row.className = "faction-rel-row";
          row.append(text(`${a.name} ↔ ${b.name}`, "faction-rel-pair"));
          if (host.canEdit()) {
            const sel = document.createElement("select");
            sel.className = "faction-rel-select";
            for (const lv of LEVELS) sel.add(new Option(lv, lv));
            sel.value = host.relation(a.id, b.id);
            sel.addEventListener("change", () => void host.setRelation(a.id, b.id, sel.value as RelationLevel));
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

/** Coerce a stored color to the #rrggbb form <input type=color> requires. */
function normalizeHex(color: string): string {
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return "#" + c.slice(1).split("").map((h) => h + h).join("");
  }
  return "#888888";
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

function statLine(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "faction-field";
  row.append(text(label, ""), text(value, "faction-meta"));
  return row;
}
