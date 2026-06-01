// DERIVED: the post-shift world traced into CRISP VECTOR shapes.
//
// The earlier overlays sampled a coarse grid and stretched it into a raster, so
// every boundary came out soft/blobby — fine as a data viz, wrong as map art.
// This module instead *contours* the same fields into clean GeoJSON polygons we
// can stroke and fill like a drawn map:
//
//   • coastline — contour (seaLevel − elevation) at 0 → land polygons whose
//     outline IS the post-shift shoreline (drowned Gulf/Hudson Bay included);
//   • biomes    — contour the biome-index field into one clean multipolygon per
//     biome, so regions have defined edges instead of a blur;
//
// Rivers stay as the hydrology drainage polylines (already vector). Everything
// is computed once from a loaded DEM block and cached. Pure given the block.

import { contours } from "d3-contour";
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { AOI } from "../config";
import {
  climateAt,
  temperatureAt,
  seaLevelAt,
  biomeAt,
  BIOME_LEGEND,
  type ClimateInputs,
} from "./climate";
import { elevationFromBlock, type DemBlock } from "./elevation";

/** Grid resolution for tracing. Higher = finer edges, slower trace. */
const GRID_W = 600;
/** Chaikin smoothing iterations — turns the contour staircase into flowing
 *  curves so a traced lake/sea reads as a natural shape, not a polygon. */
const SMOOTH_ITERS = 3;

export interface BiomeRegion {
  biomeId: string;
  label: string;
  color: string;
  geometry: MultiPolygon;
}

export interface WorldVectors {
  /** Land above the post-shift sea level — its outline is the new coastline. */
  land: FeatureCollection<MultiPolygon | Polygon>;
  /** The post-shift sea (incl. newly-drowned land) — shade this over the real
   *  basemap so the new coastline reads against the present-day ground. */
  sea: FeatureCollection<MultiPolygon | Polygon>;
  /** One feature per biome present, ready to fill with its color. */
  biomes: BiomeRegion[];
}

interface Grid {
  w: number;
  h: number;
  /** Map a grid (col,row) to [lng,lat]. Row 0 = north. */
  toLngLat(col: number, row: number): [number, number];
}

function makeGrid(): Grid {
  const [w, s, e, n] = AOI.climateExtent;
  const W = GRID_W;
  const H = Math.max(1, Math.round(W * ((n - s) / (e - w))));
  return {
    w: W,
    h: H,
    toLngLat(col, row) {
      // d3-contour coordinates sit on grid-cell corners (0..W, 0..H).
      const lng = w + (col / W) * (e - w);
      const lat = n - (row / H) * (n - s);
      return [lng, lat];
    },
  };
}

/**
 * Chaikin corner-cutting on a closed ring: each segment is replaced by two
 * points at 1/4 and 3/4, rounding the staircase into a smooth curve. Repeated a
 * few times this makes a contour read as a natural coastline rather than a
 * blocky polygon. Operates in grid space (before projection).
 */
function chaikinClosed(ring: Position[], iters: number): Position[] {
  let pts = ring;
  // Drop the duplicated closing point while smoothing, re-close at the end.
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts = pts.slice(0, -1);
  }
  for (let it = 0; it < iters && pts.length >= 3; it++) {
    const out: Position[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    pts = out;
  }
  if (pts.length) pts = [...pts, pts[0]]; // re-close
  return pts;
}

/** Rewrite d3-contour polygon ring coords (grid space) into [lng,lat], with
 *  Chaikin smoothing so edges flow naturally instead of stair-stepping. */
function projectRings(coords: Position[][][], grid: Grid): Position[][][] {
  return coords.map((poly) =>
    poly.map((ring) =>
      chaikinClosed(ring, SMOOTH_ITERS).map(([cx, cy]) => grid.toLngLat(cx, cy) as Position),
    ),
  );
}

/** Trace the post-shift world from a loaded DEM block. */
export function traceWorld(block: DemBlock, inp: ClimateInputs): WorldVectors {
  const grid = makeGrid();
  const { w: W, h: H } = grid;
  const n = W * H;

  // Sample the fields once across the grid.
  const submerged = new Float64Array(n); // seaLevel − elev: >0 underwater
  const biomeIdx = new Float64Array(n); // index into BIOME_LEGEND (land only)
  const idOf = new Map(BIOME_LEGEND.map((b, i) => [b.id, i]));

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const [lng, lat] = grid.toLngLat(col + 0.5, row + 0.5);
      const raw = elevationFromBlock(block, lng, lat);
      const elev = raw ?? 0;
      const sea = seaLevelAt([lng, lat], inp);
      const isWater = raw !== null && elev <= sea;
      const k = row * W + col;
      submerged[k] = sea - elev;
      if (isWater) {
        biomeIdx[k] = idOf.get("water") ?? 0;
      } else {
        const c = climateAt([lng, lat], elev, inp);
        const meanT = temperatureAt([lng, lat], elev, { ...inp, season: 0.25 }, 0);
        biomeIdx[k] = idOf.get(biomeAt(meanT, c.precip, false).id) ?? 0;
      }
    }
  }

  // --- Coastline: land = where submerged < 0. Contour at 0 and keep the band
  // below it (land). d3-contour returns the region >= threshold, so contour the
  // NEGATED field (elev − sea) at 0 to get land polygons directly.
  const landField = new Float64Array(n);
  for (let i = 0; i < n; i++) landField[i] = -submerged[i]; // elev − sea
  const landContour = contours().size([W, H]).thresholds([0])(Array.from(landField));
  const landGeom: MultiPolygon = {
    type: "MultiPolygon",
    coordinates: landContour.length ? projectRings(landContour[0].coordinates, grid) : [],
  };
  const land: FeatureCollection<MultiPolygon | Polygon> = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: landGeom, properties: {} }],
  };

  // --- Sea: the inverse — contour the submerged field (sea − elev) at 0 to get
  // the post-shift water body (includes newly-drowned lowlands). Drawn over the
  // real basemap, its boundary IS the new coastline.
  const seaContour = contours().size([W, H]).thresholds([0])(Array.from(submerged));
  const seaGeom: MultiPolygon = {
    type: "MultiPolygon",
    coordinates: seaContour.length ? projectRings(seaContour[0].coordinates, grid) : [],
  };
  const sea: FeatureCollection<MultiPolygon | Polygon> = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: seaGeom, properties: {} }],
  };

  // --- Biomes: for each biome present, contour the indicator field (1 where the
  // cell IS that biome, else 0) at 0.5 → a clean multipolygon for that biome.
  const biomes: BiomeRegion[] = [];
  for (let bi = 0; bi < BIOME_LEGEND.length; bi++) {
    const b = BIOME_LEGEND[bi];
    if (b.id === "water") continue; // sea is the background, not a region fill
    let present = false;
    const indicator = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const on = Math.round(biomeIdx[i]) === bi ? 1 : 0;
      indicator[i] = on;
      if (on) present = true;
    }
    if (!present) continue;
    const c = contours().size([W, H]).thresholds([0.5])(Array.from(indicator));
    if (!c.length || !c[0].coordinates.length) continue;
    biomes.push({
      biomeId: b.id,
      label: b.label,
      color: b.color,
      geometry: { type: "MultiPolygon", coordinates: projectRings(c[0].coordinates, grid) },
    });
  }

  return { land, sea, biomes };
}
