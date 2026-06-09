// Surface brush control panel: enable toggle, surface-type picker, radius
// slider, Apply (persist) and Clear buttons. Pure DOM; drives a SurfaceBrush.
// Mirrors terrain-brush-control.ts exactly.

import type { SurfaceBrush, SurfaceType } from "../derived/surface-brush";
import { SURFACE_TYPES, SURFACE_COLORS } from "../derived/surface-brush";

const SURFACE_LABELS: Record<SurfaceType, string> = {
  rubble:   "Rubble",
  ruined:   "Ruined",
  regrowth: "Regrowth",
  barren:   "Barren",
  forest:   "Forest",
  water:    "Water",
};

export function mountSurfaceBrushControl(container: HTMLElement, brush: SurfaceBrush): void {
  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = "Surface brush";
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

  // Surface-type picker.
  const typeRow = document.createElement("div");
  typeRow.className = "climate-metrics";
  let currentSurface: SurfaceType = "rubble";

  const typeBtns = SURFACE_TYPES.map((s) => {
    const b = button(SURFACE_LABELS[s]);
    b.style.borderLeftColor = SURFACE_COLORS[s];
    b.style.borderLeftWidth = "3px";
    b.setAttribute("aria-pressed", String(s === currentSurface));
    b.addEventListener("click", () => {
      currentSurface = s;
      brush.setSurface(s);
      for (const tb of typeBtns) tb.setAttribute("aria-pressed", String(tb === b));
    });
    return b;
  });
  typeRow.append(...typeBtns);
  body.append(typeRow);

  // Radius slider.
  body.append(
    slider("Radius", 5, 150, 40, "km", (v) => brush.setRadiusKm(v)),
  );

  // Apply + Clear.
  const actions = document.createElement("div");
  actions.className = "climate-metrics";
  const applyBtn = button("Apply");
  applyBtn.addEventListener("click", () => brush.apply());
  const clearBtn = button("Clear");
  clearBtn.addEventListener("click", () => {
    if (window.confirm("Clear all surface edits?")) brush.clearEdits();
  });
  actions.append(applyBtn, clearBtn);
  body.append(actions);

  const note = document.createElement("p");
  note.className = "climate-note";
  note.textContent = "Drag on the map to paint a surface type; press Apply to persist.";
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
  const set = (v: number): void => { text.textContent = `${label}: ${v} ${unit}`; };
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
