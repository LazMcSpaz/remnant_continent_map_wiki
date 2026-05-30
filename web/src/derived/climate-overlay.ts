// Renders the DERIVED climate cascade as a choropleth overlay over the terrain
// regions. This layer holds no authored data — it paints recomputed values
// (temperature or crop suitability) and is rebuilt whenever an input changes.
// Kept separate from layers/render.ts so the authored/derived split is visible
// in the code, not just the data.

import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, MultiPolygon } from "geojson";
import type { FeatureData } from "../layers/features";
import { deriveClimate, type ClimateMetric, type RegionDerived } from "./climate";

const SRC = "rc-climate";
const FILL = "rc-climate-fill";
const LINE = "rc-climate-line";

interface ClimateProps {
  id: string;
  metric: number; // the value being shown (°C or 0..100), drives color
}

/** Blue→red ramp for temperature (°C, ~ -30..40). */
function tempColor(): maplibregl.ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["get", "metric"],
    -30, "#3b4cc0",
    -10, "#7aa0ff",
    0, "#b9d0ff",
    10, "#ffe9b0",
    20, "#ffb24a",
    30, "#e85d3a",
    40, "#a01010",
  ];
}

/** Brown→green ramp for crop suitability (0..100). */
function cropColor(): maplibregl.ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["get", "metric"],
    0, "#6b4a2a",
    25, "#a08440",
    50, "#bcae54",
    75, "#6fae3f",
    100, "#2f8b34",
  ];
}

function buildFC(
  data: FeatureData,
  derived: Map<string, RegionDerived>,
  metric: ClimateMetric,
): FeatureCollection<MultiPolygon, ClimateProps> {
  return {
    type: "FeatureCollection",
    features: data.terrain.features.map((f) => {
      const id = f.properties.id;
      const d = derived.get(id);
      const value = d ? (metric === "temperature" ? d.tempC : d.crop.suitability) : 0;
      return {
        type: "Feature",
        id,
        geometry: f.geometry,
        properties: { id, metric: value },
      };
    }),
  };
}

export class ClimateOverlay {
  private map: MlMap;
  private metric: ClimateMetric = "temperature";
  private visible = false;
  private added = false;
  private derived: Map<string, RegionDerived> = new Map();

  constructor(map: MlMap) {
    this.map = map;
  }

  /** Recompute the derived field from current authored inputs and repaint. */
  recompute(data: FeatureData): void {
    this.derived = deriveClimate(data.terrainRegions, data.worldSettings);
    const fc = buildFC(data, this.derived, this.metric);
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) {
      src.setData(fc);
    } else {
      this.add(fc);
    }
    this.applyColor();
  }

  private add(fc: FeatureCollection<MultiPolygon, ClimateProps>): void {
    this.map.addSource(SRC, { type: "geojson", data: fc });
    // Insert beneath the location markers so cities stay clickable on top.
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addLayer(
      {
        id: FILL,
        type: "fill",
        source: SRC,
        layout: { visibility: this.visible ? "visible" : "none" },
        paint: { "fill-opacity": 0.6 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: LINE,
        type: "line",
        source: SRC,
        layout: { visibility: this.visible ? "visible" : "none" },
        paint: { "line-color": "#0e1116", "line-width": 0.5, "line-opacity": 0.4 },
      },
      before,
    );
    this.added = true;
  }

  private applyColor(): void {
    if (!this.added) return;
    this.map.setPaintProperty(
      FILL,
      "fill-color",
      this.metric === "temperature" ? tempColor() : cropColor(),
    );
  }

  setMetric(metric: ClimateMetric, data: FeatureData): void {
    this.metric = metric;
    this.recompute(data);
  }

  getMetric(): ClimateMetric {
    return this.metric;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!this.added) return;
    const v = visible ? "visible" : "none";
    this.map.setLayoutProperty(FILL, "visibility", v);
    this.map.setLayoutProperty(LINE, "visibility", v);
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Lookup derived values for a region (used by the wiki panel). */
  get(id: string): RegionDerived | undefined {
    return this.derived.get(id);
  }
}
