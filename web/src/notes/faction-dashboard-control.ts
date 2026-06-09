// Faction dashboard panel — read-only overview of every faction: cities, pop,
// tech, influence, wealth, territory count, and a one-line relationship summary.
//
// Authoring (tier, color, relations) lives in the existing factions-control.
// This panel is a richer, read-mostly sibling wired to the same derived data.

import type { FactionSummary } from "../derived/faction-summary";

export interface FactionDashboardHost {
  /** Current list of faction summaries (already sorted). */
  summaries(): FactionSummary[];
}

export interface FactionDashboard {
  refresh(): void;
}

/** Mount the faction dashboard into `container`. Returns a handle for refresh. */
export function mountFactionDashboard(
  container: HTMLElement,
  host: FactionDashboardHost,
): FactionDashboard {
  const render = (): void => {
    container.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = "Faction Dashboard";
    container.append(heading);

    const all = host.summaries();
    if (all.length === 0) {
      container.append(muted("No factions yet. Assign a city to one from its Overview tab."));
      container.hidden = false;
      return;
    }

    for (const s of all) {
      const card = document.createElement("div");
      card.className = "faction-card";

      // Header row: swatch + name + tier badge.
      const head = document.createElement("div");
      head.className = "faction-row";
      head.append(swatch(s.color), span(s.name, "faction-name"));
      if (s.tier === "minor") head.append(span("minor", "faction-tag"));
      card.append(head);

      // Stat grid: cities · population · tech · influence · wealth.
      const grid = document.createElement("div");
      grid.className = "dash-grid";

      grid.append(
        statCell("Cities", String(s.cityCount)),
        statCell("Population", s.population > 0 ? s.population.toLocaleString() : "—"),
        statCell("Tech", s.techLevel == null ? "—" : s.techLevel.toFixed(1)),
        statCell("Influence", String(s.influence)),
      );

      if (s.territoryCount > 0) {
        grid.append(statCell("Territories", String(s.territoryCount)));
      }

      if (s.wealth != null) {
        grid.append(statCell("Wealth", Math.round(s.wealth).toLocaleString() + "⛀"));
      }

      card.append(grid);

      // Relationship summary line.
      const relParts: string[] = [];
      if (s.allies > 0) relParts.push(`${s.allies} ${s.allies === 1 ? "ally" : "allies"}`);
      if (s.tense > 0) relParts.push(`${s.tense} tense`);
      if (s.hostile > 0) relParts.push(`${s.hostile} hostile`);

      if (relParts.length > 0) {
        const relLine = document.createElement("div");
        relLine.className = "faction-field";
        const relSpan = document.createElement("span");
        relSpan.className = "faction-meta";
        relSpan.textContent = relParts.join(" · ");
        relLine.append(relSpan);
        card.append(relLine);
      }

      container.append(card);
    }

    container.hidden = false;
  };

  render();
  return { refresh: render };
}

// --- Helpers ------------------------------------------------------------------

function swatch(color: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "legend-swatch";
  s.style.background = color;
  return s;
}

function span(content: string, className: string): HTMLElement {
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

function statCell(label: string, value: string): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "sim-stat";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "sim-stat-val";
  valueEl.textContent = value;
  cell.append(labelEl, valueEl);
  return cell;
}
