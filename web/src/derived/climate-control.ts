// Control panel for the derived climate overlay: toggle it on/off, pick the
// metric (temperature vs crop suitability), and scrub the season. Scrubbing the
// season writes the authored input (world_settings.season) and triggers a full
// recompute — the README's "move an input, watch the derived layer recompute"
// made tangible.

import type { ClimateMetric } from "./climate";

export interface ClimateControlHandlers {
  onToggle: (visible: boolean) => void;
  onMetric: (metric: ClimateMetric) => void;
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

  // Toggle
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "climate-toggle";
  toggle.textContent = "Climate: off";
  toggle.setAttribute("aria-pressed", "false");
  let on = false;
  toggle.addEventListener("click", () => {
    on = !on;
    toggle.setAttribute("aria-pressed", String(on));
    toggle.textContent = on ? "Climate: on" : "Climate: off";
    body.hidden = !on;
    handlers.onToggle(on);
  });
  container.append(toggle);

  // Body (metric + season), hidden until toggled on
  const body = document.createElement("div");
  body.className = "climate-body";
  body.hidden = true;

  // Metric switch
  const metricRow = document.createElement("div");
  metricRow.className = "climate-metrics";
  const metrics: Array<[ClimateMetric, string]> = [
    ["temperature", "Temp"],
    ["crops", "Crops"],
  ];
  let activeMetric: ClimateMetric = "temperature";
  const metricBtns = new Map<ClimateMetric, HTMLButtonElement>();
  for (const [metric, label] of metrics) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "climate-metric";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(metric === activeMetric));
    b.addEventListener("click", () => {
      activeMetric = metric;
      for (const [m, btn] of metricBtns) btn.setAttribute("aria-pressed", String(m === metric));
      handlers.onMetric(metric);
    });
    metricBtns.set(metric, b);
    metricRow.append(b);
  }
  body.append(metricRow);

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
