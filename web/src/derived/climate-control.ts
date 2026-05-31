// Control panel for the derived climate overlay: toggle it on/off, pick the
// metric (temperature vs crop suitability), and scrub the season. Scrubbing the
// season writes the authored input (world_settings.season) and triggers a full
// recompute — the README's "move an input, watch the derived layer recompute"
// made tangible.

import type { GridMetric } from "./climate";
import { BIOME_LEGEND } from "./climate";
import { TEMP_LEGEND, PRECIP_LEGEND, type RampLegend } from "./climate-overlay";

/** A horizontal gradient swatch with end (and mid) value labels. */
function rampLegend(spec: RampLegend): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "legend-ramp";
  const min = spec.stops[0].v;
  const max = spec.stops[spec.stops.length - 1].v;
  const bar = document.createElement("div");
  bar.className = "legend-bar";
  const segs = spec.stops
    .map((s) => `${s.color} ${Math.round(((s.v - min) / (max - min)) * 100)}%`)
    .join(", ");
  bar.style.background = `linear-gradient(to right, ${segs})`;
  const scale = document.createElement("div");
  scale.className = "legend-scale";
  const lo = document.createElement("span");
  lo.textContent = `${min}${spec.unit}`;
  const mid = document.createElement("span");
  mid.textContent = `${Math.round((min + max) / 2)}${spec.unit}`;
  const hi = document.createElement("span");
  hi.textContent = `${max}${spec.unit}`;
  scale.append(lo, mid, hi);
  wrap.append(bar, scale);
  return wrap;
}

/** A vertical list of colour swatches + labels (for the categorical biome key). */
function swatchList(items: Array<{ label: string; color: string }>): HTMLElement {
  const list = document.createElement("div");
  list.className = "legend-list";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "legend-row";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = it.color;
    const txt = document.createElement("span");
    txt.textContent = it.label;
    row.append(sw, txt);
    list.append(row);
  }
  return list;
}

export interface ClimateControlHandlers {
  onMetric: (metric: GridMetric) => void;
  /** Live season scrub (0..1) — recompute only, no DB write yet. */
  onSeasonPreview: (season: number) => void;
  /** Commit the season to world_settings (on release). */
  onSeasonCommit: (season: number) => void | Promise<void>;
  canEdit: boolean;
}

const SEASON_LABELS = ["Midwinter", "Spring", "Midsummer", "Autumn"];

function seasonLabel(season: number): string {
  // 0=midwinter, .25=spring, .5=midsummer, .75=autumn (wraps)
  const idx = Math.round(season * 4) % 4;
  return SEASON_LABELS[idx];
}

export function mountClimateControl(
  container: HTMLElement,
  initialSeason: number,
  handlers: ClimateControlHandlers,
): void {
  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.className = "climate-heading";
  heading.textContent = "Climate";
  container.append(heading);

  // Metric + season. Visibility of the climate overlay itself is owned by the
  // Layers panel ("Climate zones"); these controls just shape what it shows.
  const body = document.createElement("div");
  body.className = "climate-body";

  // Metric switch
  const metricRow = document.createElement("div");
  metricRow.className = "climate-metrics";
  const metrics: Array<[GridMetric, string]> = [
    ["temperature", "Temp"],
    ["precip", "Rain"],
    ["biome", "Biome"],
  ];
  let activeMetric: GridMetric = "temperature";
  const metricBtns = new Map<GridMetric, HTMLButtonElement>();

  // Legend — explains how to read the active metric, plus the sea-level key.
  const legend = document.createElement("div");
  legend.className = "climate-legend";
  const renderLegend = (metric: GridMetric): void => {
    legend.replaceChildren();
    if (metric === "temperature") legend.append(rampLegend(TEMP_LEGEND));
    else if (metric === "precip") legend.append(rampLegend(PRECIP_LEGEND));
    else legend.append(swatchList(BIOME_LEGEND.map((b) => ({ label: b.label, color: b.color }))));
    // Sea-level key (its own toggleable layer in the Layers panel).
    legend.append(
      swatchList([{ label: "Sea level — flooded", color: "#abd2df" }]),
    );
  };

  for (const [metric, label] of metrics) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "climate-metric";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(metric === activeMetric));
    b.addEventListener("click", () => {
      activeMetric = metric;
      for (const [m, btn] of metricBtns) btn.setAttribute("aria-pressed", String(m === metric));
      renderLegend(metric);
      handlers.onMetric(metric);
    });
    metricBtns.set(metric, b);
    metricRow.append(b);
  }
  body.append(metricRow);
  renderLegend(activeMetric);
  body.append(legend);

  // Season scrubber
  const seasonWrap = document.createElement("label");
  seasonWrap.className = "climate-season";
  const seasonText = document.createElement("span");
  seasonText.className = "climate-season-label";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.01";
  slider.value = String(initialSeason);
  slider.disabled = !handlers.canEdit;
  const setText = (v: number) => {
    seasonText.textContent = `Season: ${seasonLabel(v)} (${v.toFixed(2)})`;
  };
  setText(initialSeason);
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    setText(v);
    handlers.onSeasonPreview(v);
  });
  slider.addEventListener("change", () => {
    void handlers.onSeasonCommit(Number(slider.value));
  });
  seasonWrap.append(seasonText, slider);
  if (!handlers.canEdit) {
    const note = document.createElement("span");
    note.className = "climate-note";
    note.textContent = "Connect a backend to scrub & save the season.";
    seasonWrap.append(note);
  }
  body.append(seasonWrap);

  container.append(body);
  container.hidden = false;
}
