// Drowned-coast overlay: the post-shift sea drawn OVER the real basemap, so the
// cataclysm's new shoreline reads against the present-day ground. Two layers:
//
//   • a translucent fill of the post-shift sea (incl. newly-flooded lowlands),
//     deep enough to read as water on the dark war-room base;
//   • a luminous "new shore" line on the sea boundary — the literal new coast.
//
// Traced once from a DEM block via world-vector.ts and cached. Self-contained
// (own source/layers, inserted above the basemap but below city markers), so
// layers/ is untouched. This is the cleanest way to honour the setting on top
// of an accurate vector basemap: real geography + our flood, no blobby raster.

import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { AOI } from "../config";
import type { FeatureData } from "../layers/features";
import { climateInputs, type ClimateInputs } from "./climate";
import { loadDemBlock, type DemBlock } from "./elevation";
import { traceWorld } from "./world-vector";

const SEA_SRC = "rc-coast-sea";
const SEA_FILL = "rc-coast-sea-fill";
const SHORE_LINE = "rc-coast-shore";

const SEA_FILL_COLOR = "#0c2740";
const SHORE_COLOR = "#3fa7d6";

type StatusFn = (msg: string, kind?: "info" | "error") => void;

export class CoastOverlay {
  private map: MlMap;
  private onStatus: StatusFn;
  private visible = false;
  private added = false;
  private block: DemBlock | null = null;
  private baking: Promise<void> | null = null;

  constructor(map: MlMap, onStatus: StatusFn = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean, data?: FeatureData): void {
    this.visible = visible;
    if (visible && !this.added) {
      if (data) void this.build(data);
      return;
    }
    if (!this.added) return;
    const v = visible ? "visible" : "none";
    for (const id of [SEA_FILL, SHORE_LINE]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", v);
    }
  }

  /** (Re)trace the post-shift sea and show it. Cheap after first DEM load. */
  async build(data: FeatureData): Promise<void> {
    if (this.baking) return this.baking;
    this.baking = this.bake(climateInputs(data.worldSettings)).finally(() => {
      this.baking = null;
    });
    return this.baking;
  }

  private async bake(inp: ClimateInputs): Promise<void> {
    const [w, s, e, n] = AOI.climateExtent;
    this.onStatus("Tracing the new coastline…");
    try {
      if (!this.block) this.block = await loadDemBlock(w, s, e, n);
      const { sea } = traceWorld(this.block, inp);
      this.render(sea as FeatureCollection);
      this.onStatus("New coastline drawn.");
    } catch (err) {
      this.onStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private render(sea: FeatureCollection): void {
    if (this.added) {
      (this.map.getSource(SEA_SRC) as GeoJSONSource | undefined)?.setData(sea);
      return;
    }
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addSource(SEA_SRC, { type: "geojson", data: sea });
    const vis = this.visible ? "visible" : "none";
    this.map.addLayer(
      {
        id: SEA_FILL,
        type: "fill",
        source: SEA_SRC,
        layout: { visibility: vis },
        paint: { "fill-color": SEA_FILL_COLOR, "fill-opacity": 0.62 },
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
