// Terrain brush control panel (top-left): enable the brush, pick raise/lower,
// set radius + strength, then Recalculate (re-derive rivers/coast/climate) or
// Clear. Pure DOM; drives a TerrainBrush.

import type { TerrainBrush } from "../derived/terrain-brush";

export function mountTerrainBrushControl(container: HTMLElement, brush: TerrainBrush): void {
  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = "Terrain brush";
  container.append(heading);

  const body = document.createElement("div");
  body.className = "climate-body";

  // Enable toggle.
  const enable = button(brush.isActive() ? "Brushing ✓" : "Enable brush");
  enable.addEventListener("click", () => {
    const next = !brush.isActive();
    brush.setActive(next);
    enable.textContent = next ? "Brushing ✓" : "Enable brush";
    enable.setAttribute("aria-pressed", String(next));
  });
  body.append(enable);

  // Raise / lower.
  const modeRow = document.createElement("div");
  modeRow.className = "climate-metrics";
  let mode: "raise" | "lower" = "raise";
  const raiseBtn = button("Raise");
  const lowerBtn = button("Lower");
  const syncMode = () => {
    raiseBtn.setAttribute("aria-pressed", String(mode === "raise"));
    lowerBtn.setAttribute("aria-pressed", String(mode === "lower"));
  };
  raiseBtn.addEventListener("click", () => { mode = "raise"; brush.setMode(mode); syncMode(); });
  lowerBtn.addEventListener("click", () => { mode = "lower"; brush.setMode(mode); syncMode(); });
  syncMode();
  modeRow.append(raiseBtn, lowerBtn);
  body.append(modeRow);

  // Radius + strength sliders.
  body.append(
    slider("Radius", 10, 200, 60, "km", (v) => brush.setRadiusKm(v)),
    slider("Strength", 50, 2000, 300, "m", (v) => brush.setStrengthM(v)),
  );

  // Recalculate + Clear.
  const actions = document.createElement("div");
  actions.className = "climate-metrics";
  const recalc = button("Recalculate");
  recalc.addEventListener("click", () => brush.recalculate());
  const clear = button("Clear edits");
  clear.addEventListener("click", () => {
    if (window.confirm("Clear all terrain edits and return to the base world?")) brush.clearEdits();
  });
  actions.append(recalc, clear);
  body.append(actions);

  // Undo + Redo.
  const historyRow = document.createElement("div");
  historyRow.className = "climate-metrics";
  const undoBtn = button("Undo");
  undoBtn.addEventListener("click", () => brush.undo());
  const redoBtn = button("Redo");
  redoBtn.addEventListener("click", () => brush.redo());
  historyRow.append(undoBtn, redoBtn);
  body.append(historyRow);

  const note = document.createElement("p");
  note.className = "climate-note";
  note.textContent = "Drag on the map to sculpt; press Recalculate to reflow rivers & coast.";
  body.append(note);

  container.append(body);
  container.hidden = false;
}

function button(label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "climate-metric";
  b.textContent = label;
  return b;
}

function slider(
  label: string,
  min: number,
  max: number,
  value: number,
  unit: string,
  onInput: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "climate-season";
  const text = document.createElement("span");
  text.className = "climate-season-label";
  const set = (v: number) => { text.textContent = `${label}: ${v} ${unit}`; };
  set(value);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(Math.max(1, Math.round((max - min) / 100)));
  input.value = String(value);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    set(v);
    onInput(v);
  });
  wrap.append(text, input);
  return wrap;
}
