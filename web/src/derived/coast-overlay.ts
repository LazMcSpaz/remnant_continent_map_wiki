// Drowned-coast + rivers overlay. The post-shift sea AND the rivers drawn OVER
// the real basemap, all derived from one composite elevation field (base DEM +
// procedural detail noise + brush edits), so they stay consistent and carry
// fine detail at deep zoom. Layers:
//
//   • sea fill — post-shift sea incl. newly-flooded lowlands, shared water color;
//   • new-shore line — the post-shift coastline (noise-detailed, smoothed);
//   • rivers — meandering, spline-smoothed, width-tapered polylines.
//
// Self-contained (own sources/layers, above the basemap, below city markers).
// Recompute (Recalculate) re-derives everything from the current edits.

import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import { AOI } from "../config";
import type { FeatureData } from "../layers/features";
import { climateInputs, type ClimateInputs } from "./climate";
import { loadDemBlock, type DemBlock } from "./elevation";
import { traceWorld } from "./world-vector";
import { getHydrology } from "./hydrology";
import { renderRivers } from "./river-render";
import { makeCompositeSampler, type ElevationEdit } from "./terrain";
import { WATER_COLOR } from "../map/war-room-style";

const SEA_SRC = "rc-coast-sea";
const SEA_FILL = "rc-coast-sea-fill";
const SHORE_LINE = "rc-coast-shore";
const RIVER_SRC = "rc-coast-river";
const RIVER_LINE = "rc-coast-river-line";

// New water uses the SAME color as existing water (war-room WATER_COLOR), at
// full opacity, so drowned seas are indistinguishable from real water bodies.
const SHORE_COLOR = "#3fa7d6";
const RIVER_COLOR = "#3a7fa0";
/** Hydrology strength below which a channel isn't drawn (creek vs sheet-flow). */
const RIVER_MIN = 40;

type StatusFn = (msg: string, kind?: "info" | "error") => void;

export class CoastOverlay {
  private map: MlMap;
  private onStatus: StatusFn;
  private visible = false;
  private added = false;
  private block: DemBlock | null = null;
  private baking: Promise<void> | null = null;
  private edits: ElevationEdit[] = [];

  constructor(map: MlMap, onStatus: StatusFn = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Replace the elevation edits the composite field uses (terrain brush). The
   *  next build()/Recalculate re-derives coast + rivers from base DEM + these. */
  setEdits(edits: ElevationEdit[]): void {
    this.edits = edits;
  }

  setVisible(visible: boolean, data?: FeatureData): void {
    this.visible = visible;
    if (visible && !this.added) {
      if (data) void this.build(data);
      return;
    }
    if (!this.added) return;
    const v = visible ? "visible" : "none";
    for (const id of [SEA_FILL, SHORE_LINE, RIVER_LINE]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", v);
    }
  }

  /** (Re)derive sea + rivers from the composite field and show them. */
  async build(data: FeatureData): Promise<void> {
    if (this.baking) return this.baking;
    this.baking = this.bake(climateInputs(data.worldSettings)).finally(() => {
      this.baking = null;
    });
    return this.baking;
  }

  private async bake(inp: ClimateInputs): Promise<void> {
    const [w, s, e, n] = AOI.climateExtent;
    this.onStatus("Recomputing terrain (coast & rivers)…");
    try {
      // Higher zoom + tile budget → sharper detail; loadDemBlock fits the budget.
      if (!this.block) this.block = await loadDemBlock(w, s, e, n, 7, 900);
      // The one composite field everything reads: DEM + detail noise + edits.
      const sampler = makeCompositeSampler(this.block, this.edits);
      const { sea } = traceWorld(this.block, inp, sampler);

      // Rivers from hydrology over the SAME composite field, so edits reroute
      // them. Keyed by the edits so each sculpt caches distinctly.
      const editsKey = this.edits.map((ed) => `${ed.lng.toFixed(3)},${ed.lat.toFixed(3)},${ed.radiusKm},${ed.deltaM}`).join("|");
      const hydro = await getHydrology(inp, {
        editsKey,
        sampler: (blk) => makeCompositeSampler(blk, this.edits),
      });
      const rivers = renderRivers(hydro.toRiverChains(RIVER_MIN), RIVER_MIN);

      this.render(sea as FeatureCollection, rivers);
      this.onStatus("Terrain recomputed.");
    } catch (err) {
      this.onStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private render(sea: FeatureCollection, rivers: FeatureCollection<LineString>): void {
    if (this.added) {
      (this.map.getSource(SEA_SRC) as GeoJSONSource | undefined)?.setData(sea);
      (this.map.getSource(RIVER_SRC) as GeoJSONSource | undefined)?.setData(rivers);
      return;
    }
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addSource(SEA_SRC, { type: "geojson", data: sea });
    this.map.addSource(RIVER_SRC, { type: "geojson", data: rivers });
    const vis = this.visible ? "visible" : "none";
    this.map.addLayer(
      {
        id: SEA_FILL,
        type: "fill",
        source: SEA_SRC,
        layout: { visibility: vis },
        paint: { "fill-color": WATER_COLOR, "fill-opacity": 1 },
      },
      before,
    );
    // Rivers above the sea fill (so a river reads up to the shore) but below the
    // shore line + markers. Width tapers with flow strength.
    this.map.addLayer(
      {
        id: RIVER_LINE,
        type: "line",
        source: RIVER_SRC,
        layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": RIVER_COLOR,
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["get", "strength"], 40, 0.5, 100, 4],
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: SHORE_LINE,
        type: "line",
        source: SEA_SRC,
        layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
        paint: { "line-color": SHORE_COLOR, "line-width": 1.4, "line-opacity": 0.9, "line-blur": 0.4 },
      },
      before,
    );
    this.added = true;
  }
}
