// Authored-layer editing via Terra Draw.
//
// Provides a small toolbar to add locations (points), routes (lines), and
// territories (polygons). When a drawing finishes, its GeoJSON geometry is
// written to Supabase through the create RPCs (see features.ts / migration
// 0004), the temporary Terra Draw feature is removed, and the caller's
// onChange() reloads authored data so the rendered layers and the derived
// network graph refresh together.
//
// Terra Draw owns its own transient overlay; it does not touch the rc-* layers
// added by render.ts. This keeps "drawing in progress" separate from
// "persisted authored features", consistent with the three-layer model.

import type { Map as MlMap } from "maplibre-gl";
import { TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Point, LineString, Polygon } from "geojson";
import { createLocation, createRoute, createTerritory } from "./features";
import { snapToRoads } from "./routing";

type Tool = "select" | "location" | "route" | "territory";

const MODE_FOR: Record<Exclude<Tool, "select">, string> = {
  location: "point",
  route: "linestring",
  territory: "polygon",
};

export interface EditorOptions {
  /** Called after a successful write so the app can reload + rebuild derived. */
  onChange: () => void | Promise<void>;
  /** Surface status/errors to the user. */
  onStatus: (text: string, kind?: "info" | "error") => void;
  /** Faction id to assign to newly drawn territories (required by schema). */
  defaultFactionId: () => string | null;
}

export class FeatureEditor {
  private draw: TerraDraw;
  private opts: EditorOptions;
  private active: Tool = "select";

  constructor(map: MlMap, opts: EditorOptions) {
    this.opts = opts;
    this.draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawSelectMode({
          flags: {
            // Allow moving/deleting persisted-then-reloaded features is handled
            // separately; here select mostly enables click feedback on drafts.
            point: { feature: { draggable: true } },
            linestring: { feature: { draggable: true, coordinates: { draggable: true } } },
            polygon: { feature: { draggable: true, coordinates: { draggable: true } } },
          },
        }),
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode(),
      ],
    });
    this.draw.start();
    this.draw.setMode("select");
    this.draw.on("finish", (id) => void this.handleFinish(id));
  }

  /** Switch the active drawing tool (or back to select). */
  setTool(tool: Tool): void {
    this.active = tool;
    this.draw.setMode(tool === "select" ? "select" : MODE_FOR[tool]);
  }

  getTool(): Tool {
    return this.active;
  }

  private async handleFinish(id: string | number): Promise<void> {
    const feature = this.draw.getSnapshotFeature(id);
    if (!feature) return;
    const tool = this.active;
    // Remove the transient drawing — the persisted feature will render via the
    // rc-* layers after reload, so we don't want a duplicate overlay.
    this.draw.removeFeatures([id]);

    try {
      if (tool === "location") {
        const name = window.prompt("New location name (new-world):")?.trim();
        if (!name) {
          this.opts.onStatus("Cancelled — a name is required.", "error");
          return;
        }
        const oldWorld = window.prompt("Old-world name (optional):")?.trim() || undefined;
        await createLocation(feature.geometry as Point, name, {
          ...(oldWorld ? { oldWorldName: oldWorld } : {}),
          type: "city",
        });
        this.opts.onStatus(`Added location “${name}”.`);
      } else if (tool === "route") {
        // Road routes snap to real roads via OSRM; fall back to the drawn line
        // if routing is unavailable. (Rail/trail would be hand-traced; the
        // toolbar's route tool defaults to road.)
        const drawn = feature.geometry as LineString;
        const snapped = await snapToRoads(drawn.coordinates);
        if (snapped) {
          this.opts.onStatus("Snapped route to roads.");
        }
        await createRoute(snapped ?? drawn, { kind: "road", status: "intact" });
        this.opts.onStatus(snapped ? "Added route (road-snapped)." : "Added route.");
      } else if (tool === "territory") {
        const factionId = this.opts.defaultFactionId();
        if (!factionId) {
          this.opts.onStatus("Cannot add territory: no faction available.", "error");
          return;
        }
        await createTerritory(feature.geometry as Polygon, factionId);
        this.opts.onStatus("Added territory.");
      } else {
        return;
      }
      await this.opts.onChange();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.onStatus(msg, "error");
    } finally {
      // Return to select so the user doesn't accidentally draw again.
      this.setTool("select");
    }
  }

  destroy(): void {
    this.draw.stop();
  }
}

/** Build the editor toolbar; returns the FeatureEditor or null if disabled. */
export function mountEditorToolbar(
  map: MlMap,
  container: HTMLElement,
  opts: EditorOptions,
): FeatureEditor {
  const editor = new FeatureEditor(map, opts);

  const tools: Array<{ tool: Tool; label: string }> = [
    { tool: "select", label: "Select" },
    { tool: "location", label: "+ Location" },
    { tool: "route", label: "+ Route" },
    { tool: "territory", label: "+ Territory" },
  ];

  const buttons = new Map<Tool, HTMLButtonElement>();
  const refresh = () => {
    for (const [tool, btn] of buttons) {
      btn.setAttribute("aria-pressed", String(editor.getTool() === tool));
    }
  };

  for (const { tool, label } of tools) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      editor.setTool(editor.getTool() === tool ? "select" : tool);
      refresh();
    });
    buttons.set(tool, btn);
    container.appendChild(btn);
  }
  container.hidden = false;
  refresh();
  return editor;
}
