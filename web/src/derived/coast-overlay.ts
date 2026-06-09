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
import { traceWorld, lakePolygons } from "./world-vector";
import { getHydrology } from "./hydrology";
import { renderRivers } from "./river-render";
import { makeCompositeSampler, type ElevationEdit } from "./terrain";
import { WATER_COLOR } from "../map/war-room-style";

const SEA_SRC = "rc-coast-sea";
const SEA_FILL = "rc-coast-sea-fill";
const SEA_SHALLOW = "rc-coast-sea-shallow";
const SHORE_LINE = "rc-coast-shore";
const LAKE_SRC = "rc-coast-lake";
const LAKE_FILL = "rc-coast-lake-fill";
const LAKE_SHALLOW = "rc-coast-lake-shallow";
const LAKE_LINE = "rc-coast-lake-shore";
const RIVER_SRC = "rc-coast-river";
const RIVER_LINE = "rc-coast-river-line";

// New water uses the SAME color as existing water (war-room WATER_COLOR), at
// full opacity, so drowned seas are indistinguishable from real water bodies.
const SHORE_COLOR = "#3fa7d6";
const SHALLOW_COLOR = "#2f7da0"; // soft shallow halo just inside the shore
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
    for (const id of [SEA_FILL, SEA_SHALLOW, SHORE_LINE, LAKE_FILL, LAKE_SHALLOW, LAKE_LINE, RIVER_LINE]) {
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
      // Water is decided by the STRUCTURAL field: base DEM + brush edits, with
      // NO detail noise. (Noise is fine-grain ±tens-to-hundreds of metres; if it
      // fed drainage it would manufacture countless tiny pits → a pockmarked
      // land of micro-pools, and would swamp the effect of an edit.) Noise is a
      // render-only texture, applied to the coastline shape, not the water test.
      const structural = makeCompositeSampler(this.block, this.edits, { detail: false });
      const { sea } = traceWorld(this.block, inp, structural);

      // Rivers from hydrology over the SAME structural field, so edits reroute
      // them. Keyed by the edits so each sculpt caches distinctly.
      const editsKey = this.edits.map((ed) => `${ed.lng.toFixed(3)},${ed.lat.toFixed(3)},${ed.radiusKm},${ed.deltaM}`).join("|");
      const hydro = await getHydrology(inp, {
        editsKey,
        sampler: (blk) => makeCompositeSampler(blk, this.edits, { detail: false }),
      });
      const rivers = renderRivers(hydro.toRiverChains(RIVER_MIN), RIVER_MIN);

      // Inland lakes: filled basins that hold water, smoothed like the coast.
      const lakes = lakePolygons(hydro.lakeMask, hydro.w, hydro.h);

      this.render(sea as FeatureCollection, rivers, lakes as FeatureCollection);
      this.onStatus("Terrain recomputed.");
    } catch (err) {
      this.onStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private render(
    sea: FeatureCollection,
    rivers: FeatureCollection<LineString>,
    lakes: FeatureCollection,
  ): void {
    if (this.added) {
      (this.map.getSource(SEA_SRC) as GeoJSONSource | undefined)?.setData(sea);
      (this.map.getSource(RIVER_SRC) as GeoJSONSource | undefined)?.setData(rivers);
      (this.map.getSource(LAKE_SRC) as GeoJSONSource | undefined)?.setData(lakes);
      return;
    }
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addSource(SEA_SRC, { type: "geojson", data: sea });
    this.map.addSource(LAKE_SRC, { type: "geojson", data: lakes });
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
    // Soft shallow-water halo just inside the shore: a wide, heavily-blurred
    // line that fades the water edge so it reads soft instead of hard-cut.
    this.map.addLayer(
      {
        id: SEA_SHALLOW,
        type: "line",
        source: SEA_SRC,
        layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
        paint: { "line-color": SHALLOW_COLOR, "line-width": 8, "line-opacity": 0.5, "line-blur": 8 },
      },
      before,
    );
    // Inland lakes: same water color + soft halo + a shore line, like the coast.
    this.map.addLayer(
      {
        id: LAKE_FILL,
        type: "fill",
        source: LAKE_SRC,
        layout: { visibility: vis },
        paint: { "fill-color": WATER_COLOR, "fill-opacity": 1 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: LAKE_SHALLOW,
        type: "line",
        source: LAKE_SRC,
        layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
        paint: { "line-color": SHALLOW_COLOR, "line-width": 6, "line-opacity": 0.45, "line-blur": 6 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: LAKE_LINE,
        type: "line",
        source: LAKE_SRC,
        layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
        paint: { "line-color": SHORE_COLOR, "line-width": 1, "line-opacity": 0.8, "line-blur": 0.4 },
      },
      before,
    );
    // Rivers above the water fills (so a river reads up to the shore) but below
    // the shore lines + markers. Width tapers with flow strength.
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
