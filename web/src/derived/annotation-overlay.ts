// Renders persisted map annotations (markers / lines / regions) on the map.
// Self-contained: own `rc-anno-*` sources/layers, refreshed from FeatureData.
// Annotation labels render as HTML markers (like city names) so text stays
// upright under the new-north rotation and needs no glyph server.

import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import type { FeatureCollection, Point, LineString, Polygon } from "geojson";
import type { MapAnnotation } from "../layers/features";

const PT_SRC = "rc-anno-point";
const PT_LAYER = "rc-anno-point-circle";
const LINE_SRC = "rc-anno-line";
const LINE_LAYER = "rc-anno-line-line";
const REGION_SRC = "rc-anno-region";
const REGION_FILL = "rc-anno-region-fill";
const REGION_LINE = "rc-anno-region-line";

export class AnnotationOverlay {
  private map: MlMap;
  private added = false;
  private visible = true;
  private labelMarkers: maplibregl.Marker[] = [];

  constructor(map: MlMap) {
    this.map = map;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    const v = visible ? "visible" : "none";
    for (const id of [PT_LAYER, LINE_LAYER, REGION_FILL, REGION_LINE]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", v);
    }
    for (const m of this.labelMarkers) m.getElement().style.display = visible ? "" : "none";
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Repaint from the current annotation list. */
  update(annotations: MapAnnotation[]): void {
    this.ensureLayers();

    const points: FeatureCollection<Point>["features"] = [];
    const lines: FeatureCollection<LineString>["features"] = [];
    const regions: FeatureCollection<Polygon>["features"] = [];
    for (const a of annotations) {
      const props = { id: a.id, color: a.color, label: a.label ?? "" };
      if (a.geometry.type === "Point") points.push({ type: "Feature", geometry: a.geometry, properties: props });
      else if (a.geometry.type === "LineString") lines.push({ type: "Feature", geometry: a.geometry, properties: props });
      else if (a.geometry.type === "Polygon") regions.push({ type: "Feature", geometry: a.geometry, properties: props });
    }
    (this.map.getSource(PT_SRC) as GeoJSONSource).setData({ type: "FeatureCollection", features: points });
    (this.map.getSource(LINE_SRC) as GeoJSONSource).setData({ type: "FeatureCollection", features: lines });
    (this.map.getSource(REGION_SRC) as GeoJSONSource).setData({ type: "FeatureCollection", features: regions });

    // Labels as HTML markers at a representative point of each annotation.
    for (const m of this.labelMarkers) m.remove();
    this.labelMarkers = [];
    for (const a of annotations) {
      if (!a.label) continue;
      const at = representativePoint(a);
      if (!at) continue;
      const el = document.createElement("div");
      el.className = "map-label anno-label";
      el.textContent = a.label;
      el.style.display = this.visible ? "" : "none";
      this.labelMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(this.map));
    }
  }

  private ensureLayers(): void {
    if (this.added) return;
    const empty = { type: "FeatureCollection", features: [] } as FeatureCollection;
    this.map.addSource(PT_SRC, { type: "geojson", data: empty });
    this.map.addSource(LINE_SRC, { type: "geojson", data: empty });
    this.map.addSource(REGION_SRC, { type: "geojson", data: empty });
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;

    this.map.addLayer(
      {
        id: REGION_FILL, type: "fill", source: REGION_SRC,
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: REGION_LINE, type: "line", source: REGION_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-dasharray": [3, 2] },
      },
      before,
    );
    this.map.addLayer(
      {
        id: LINE_LAYER, type: "line", source: LINE_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 2 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: PT_LAYER, type: "circle", source: PT_SRC,
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#0e1116",
          "circle-stroke-width": 1.5,
        },
      },
      before,
    );
    this.added = true;
  }
}

/** A representative [lng,lat] for an annotation's label position. */
function representativePoint(a: MapAnnotation): [number, number] | null {
  const g = a.geometry;
  if (g.type === "Point") return [g.coordinates[0], g.coordinates[1]];
  if (g.type === "LineString") {
    const mid = g.coordinates[Math.floor(g.coordinates.length / 2)];
    return mid ? [mid[0], mid[1]] : null;
  }
  if (g.type === "Polygon") {
    const ring = g.coordinates[0] ?? [];
    if (ring.length === 0) return null;
    let x = 0;
    let y = 0;
    for (const p of ring) {
      x += p[0];
      y += p[1];
    }
    return [x / ring.length, y / ring.length];
  }
  return null;
}
