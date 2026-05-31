// Layers panel: toggle whole feature layers on/off. Hiding a layer also makes
// it un-clickable, so the author can isolate exactly what they want to select
// without pixel-hunting between overlapping features.

import type { Map as MlMap } from "maplibre-gl";
import { setGroupVisible, type LayerGroup } from "../layers/render";
import type { ClimateOverlay } from "./climate-overlay";

interface Row {
  id: LayerGroup | "climate" | "water";
  label: string;
  swatch: string;
  /** Initial checked state. */
  on: boolean;
}

const ROWS: Row[] = [
  { id: "climate", label: "Climate zones", swatch: "#e85d3a", on: false },
  { id: "water", label: "Sea level (flooded)", swatch: "#1f5d8c", on: false },
  { id: "terrain", label: "Terrain", swatch: "#7d9b4e", on: true },
  { id: "territories", label: "Territories", swatch: "#6ea8fe", on: true },
  { id: "routes", label: "Routes & breaks", swatch: "#e0af68", on: true },
  { id: "labels", label: "City names", swatch: "#e7ecf3", on: true },
];

export function mountLayersPanel(
  container: HTMLElement,
  map: MlMap,
  climate: ClimateOverlay,
): void {
  container.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Layers";
  container.append(heading);

  for (const row of ROWS) {
    const label = document.createElement("label");
    label.className = "layers-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = row.on;

    const swatch = document.createElement("span");
    swatch.className = "layers-swatch";
    swatch.style.background = row.swatch;

    const text = document.createElement("span");
    text.textContent = row.label;

    cb.addEventListener("change", () => {
      if (row.id === "climate") climate.setVisible(cb.checked);
      else if (row.id === "water") climate.setWaterVisible(cb.checked);
      else setGroupVisible(map, row.id, cb.checked);
    });

    label.append(cb, swatch, text);
    container.append(label);
  }

  container.hidden = false;
}
