// Isochrone control (bottom-left): pick an origin city + travel mode and the
// map shades the reachable network by time-to-reach. Pure DOM; talks to an
// IsochroneHost (implemented in main.ts). Shows a band legend and the nearest
// reachable cities with their hours.

import { TRAVEL_MODES, formatHours } from "../derived/travel";

export interface ReachableCity {
  locationId: string;
  name: string;
  hours: number;
}

export interface IsochroneHost {
  /** Cities that can be an origin (id, name), sorted for the dropdown. */
  originCities(): Array<{ id: string; name: string }>;
  /** Compute + paint from this origin city at this mode; returns reachable list. */
  run(originLocationId: string, modeId: string): ReachableCity[];
  /** Clear the overlay. */
  clear(): void;
}

const BAND_LEGEND: Array<[string, string]> = [
  ["#2f8b6b", "≤ 6 h"],
  ["#bcae54", "≤ 12 h"],
  ["#e0a24a", "≤ 24 h"],
  ["#e0743a", "≤ 48 h"],
  ["#d23b3b", "> 48 h"],
];

export function mountIsochroneControl(container: HTMLElement, host: IsochroneHost): void {
  let originId = "";
  let modeId = TRAVEL_MODES[0].id;

  const render = (): void => {
    container.replaceChildren();
    const heading = document.createElement("h2");
    heading.className = "climate-heading";
    heading.textContent = "Reachability (isochrones)";
    container.append(heading);

    const body = document.createElement("div");
    body.className = "climate-body";

    const cities = host.originCities();
    if (cities.length === 0) {
      body.append(muted("No cities to route from yet."));
      container.append(body);
      container.hidden = false;
      return;
    }

    // Origin picker.
    const originSel = document.createElement("select");
    originSel.className = "wiki-field-input";
    originSel.add(new Option("Choose origin…", ""));
    for (const c of cities) originSel.add(new Option(c.name, c.id));
    originSel.value = originId;
    originSel.addEventListener("change", () => {
      originId = originSel.value;
      update();
    });
    body.append(labeled("Origin", originSel));

    // Mode picker.
    const modeSel = document.createElement("select");
    modeSel.className = "wiki-field-input";
    for (const m of TRAVEL_MODES) modeSel.add(new Option(`${m.label} (${m.mph} mph)`, m.id));
    modeSel.value = modeId;
    modeSel.addEventListener("change", () => {
      modeId = modeSel.value;
      update();
    });
    body.append(labeled("Mode", modeSel));

    // Legend.
    const legend = document.createElement("div");
    legend.className = "legend-list";
    for (const [color, label] of BAND_LEGEND) {
      const row = document.createElement("div");
      row.className = "legend-row";
      const sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = color;
      const txt = document.createElement("span");
      txt.textContent = label;
      row.append(sw, txt);
      legend.append(row);
    }
    body.append(legend);

    // Reachable list (filled by update()).
    const list = document.createElement("div");
    list.className = "sim-readout iso-list";
    body.append(list);

    container.append(body);
    container.hidden = false;

    const update = (): void => {
      if (!originId) {
        host.clear();
        list.replaceChildren();
        return;
      }
      const reachable = host.run(originId, modeId);
      list.replaceChildren(sectionLabel(`${reachable.length} cities reachable`));
      for (const c of reachable) {
        const row = document.createElement("div");
        row.className = "sim-stat";
        const l = document.createElement("span");
        l.className = "sim-stat-label";
        l.textContent = c.name;
        const v = document.createElement("span");
        v.className = "sim-stat-val";
        v.textContent = c.hours === 0 ? "origin" : formatHours(c.hours);
        row.append(l, v);
        list.append(row);
      }
    };

    update();
  };

  render();
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "wiki-field";
  wrap.append(el("span", "wiki-field-label", label), control);
  return wrap;
}

function muted(content: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "wiki-muted";
  p.style.fontSize = "0.75rem";
  p.textContent = content;
  return p;
}

function sectionLabel(text: string): HTMLElement {
  const e = document.createElement("div");
  e.className = "sim-section";
  e.textContent = text;
  return e;
}

function el(tag: string, className: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}
