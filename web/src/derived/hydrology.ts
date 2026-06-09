// DERIVED: hydrology from the DEM (flow accumulation).
//
// Rivers aren't authored — they fall out of the terrain. We sample the real
// elevation over the climate extent, then:
//
//   1. fill depressions (priority-flood) so every land cell has a downhill path
//      to an outlet — the post-shift sea (cells below the shifted sea level) or
//      the grid edge;
//   2. take the drainage tree the flood traversal defines (each cell's receiver
//      is the cell it was first reached from — always downhill, flats resolved);
//   3. accumulate flow downstream, weighted by each cell's **rainfall** (from
//      the climate rules), so a river's strength is the rain gathered upstream —
//      big rivers form in wet basins, arid drainages stay thin.
//
// The result drives the water/irrigation resource and the Rivers overlay. It is
// recomputed only when an input that changes drainage moves (the pole, hence
// sea level + rainfall). Cached by those inputs. Pure given a DEM block.

import type { FeatureCollection, LineString } from "geojson";
import { AOI } from "../config";
import { loadDemBlock, elevationFromBlock, type DemBlock } from "./elevation";
import { climateAt, seaLevelAt, type ClimateInputs } from "./climate";

const HYDRO_W = 480; // grid columns; rows scale to the extent's aspect

export interface HydroGrid {
  w: number;
  h: number;
  /** [west, south, east, north] */
  extent: [number, number, number, number];
  /** 0..100 river strength per cell (0 for ocean / non-channel land). */
  strength: Float32Array;
  /** 1 where an inland basin holds water (a lake), else 0. Row-major W×H. */
  lakeMask: Uint8Array;
  /** 0..100 river water available near a point (searches a small neighbourhood). */
  waterAt(lng: number, lat: number): number;
  /** Channels (strength ≥ minStrength) as drainage polylines for crisp drawing.
   *  Each segment is a cell→receiver link tagged with its strength. */
  toRiverLines(minStrength: number): FeatureCollection<LineString, { strength: number }>;
  /** Channels as CONTINUOUS chains (headwater → outlet), each a list of
   *  {lng,lat,strength} samples, for spline-smoothed, width-tapered rendering. */
  toRiverChains(minStrength: number): RiverChain[];
}

/** A continuous river path from headwater toward its outlet. */
export interface RiverChain {
  points: Array<{ lng: number; lat: number; strength: number }>;
}

// --- a compact binary min-heap over cell indices, keyed by filled elevation ---
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private n = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  get size(): number {
    return this.n;
  }
  push(key: number, val: number): void {
    let i = this.n++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    this.n--;
    if (this.n > 0) {
      this.keys[0] = this.keys[this.n];
      this.vals[0] = this.vals[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < this.n && this.keys[l] < this.keys[s]) s = l;
        if (r < this.n && this.keys[r] < this.keys[s]) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
    const v = this.vals[a]; this.vals[a] = this.vals[b]; this.vals[b] = v;
  }
}

const NEIGHBORS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

function buildGrid(block: DemBlock, inp: ClimateInputs, sample?: (lng: number, lat: number) => number | null): HydroGrid {
  const elevAt = sample ?? ((lng: number, lat: number) => elevationFromBlock(block, lng, lat));
  const [w, s, e, n] = AOI.climateExtent;
  const W = HYDRO_W;
  const H = Math.max(1, Math.round(W * ((n - s) / (e - w))));
  const N = W * H;

  const elev = new Float64Array(N);
  const rain = new Float32Array(N);
  const ocean = new Uint8Array(N); // outlet cells: below sea level or no data

  const lngOf = (i: number) => w + ((i + 0.5) / W) * (e - w);
  const latOf = (j: number) => n - ((j + 0.5) / H) * (n - s); // row 0 = north

  for (let j = 0; j < H; j++) {
    const lat = latOf(j);
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const lng = lngOf(i);
      const raw = elevAt(lng, lat);
      const sea = seaLevelAt([lng, lat], inp);
      if (raw === null || raw <= sea) {
        ocean[k] = 1;
        elev[k] = sea; // outlet at base level
        rain[k] = 0;
      } else {
        elev[k] = raw;
        rain[k] = Math.max(0.02, climateAt([lng, lat], raw, inp).precip / 100);
      }
    }
  }

  // --- Priority-flood: fill depressions and record a downhill receiver tree. ---
  const filled = new Float64Array(N);
  const receiver = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const order = new Int32Array(N); // pop order, for the accumulation sweep
  let orderN = 0;
  const heap = new MinHeap(N);

  // Seed outlets: ocean cells and every border cell.
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const border = i === 0 || j === 0 || i === W - 1 || j === H - 1;
      if (ocean[k] || border) {
        filled[k] = elev[k];
        closed[k] = 1;
        heap.push(filled[k], k);
      }
    }
  }

  while (heap.size > 0) {
    const c = heap.pop();
    order[orderN++] = c;
    const ci = c % W;
    const cj = (c / W) | 0;
    for (const [dx, dy] of NEIGHBORS) {
      const ni = ci + dx;
      const nj = cj + dy;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (closed[nk]) continue;
      closed[nk] = 1;
      filled[nk] = Math.max(elev[nk], filled[c]); // never below the spill point
      receiver[nk] = c; // first reached from c (downhill) → drains to c
      heap.push(filled[nk], nk);
    }
  }

  // --- Accumulate rainfall downstream (process high→low = reverse pop order). ---
  const accum = new Float64Array(N);
  for (let k = 0; k < N; k++) accum[k] = rain[k];
  for (let o = orderN - 1; o >= 0; o--) {
    const k = order[o];
    const r = receiver[k];
    if (r >= 0) accum[r] += accum[k];
  }

  // --- River strength: log-scaled accumulation on land (ocean = 0). ---
  let maxAccum = 1;
  for (let k = 0; k < N; k++) if (!ocean[k] && accum[k] > maxAccum) maxAccum = accum[k];
  const denom = Math.log(maxAccum + 1);
  const strength = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (ocean[k]) continue;
    strength[k] = (Math.log(accum[k] + 1) / denom) * 100;
  }

  // --- Inland lakes. A cell is a candidate where the priority-flood had to
  // raise it well above its real elevation (a genuine basin, not a 1-cell DEM
  // dimple). We then keep only LARGE, well-fed basins: a connected lake must
  // span a minimum area AND gather meaningful inflow at its deepest point. This
  // is what stops the land reading as pockmarked with countless micro-pools —
  // only substantial inland seas survive.
  const LAKE_MIN_DEPTH_M = 30; // a real basin, not a shallow dimple
  const LAKE_MIN_CELLS = 12; // connected lake must be this big to render
  const LAKE_MIN_PEAK_INFLOW = 6; // strongest cell in the basin must be well-fed
  const candidate = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (ocean[k]) continue;
    if (filled[k] - elev[k] >= LAKE_MIN_DEPTH_M) candidate[k] = 1;
  }
  // Connected-component pass: keep a component only if it's big and well-fed.
  const lakeMask = new Uint8Array(N);
  const comp = new Int32Array(N).fill(-1);
  const stack: number[] = [];
  for (let start = 0; start < N; start++) {
    if (!candidate[start] || comp[start] >= 0) continue;
    stack.length = 0;
    stack.push(start);
    comp[start] = start;
    const members: number[] = [];
    let peakInflow = 0;
    while (stack.length) {
      const c = stack.pop() as number;
      members.push(c);
      if (accum[c] > peakInflow) peakInflow = accum[c];
      const ci = c % W;
      const cj = (c / W) | 0;
      for (const [dx, dy] of NEIGHBORS) {
        const ni = ci + dx;
        const nj = cj + dy;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni;
        if (candidate[nk] && comp[nk] < 0) {
          comp[nk] = start;
          stack.push(nk);
        }
      }
    }
    if (members.length >= LAKE_MIN_CELLS && peakInflow >= LAKE_MIN_PEAK_INFLOW) {
      for (const m of members) lakeMask[m] = 1;
    }
  }

  const colOf = (lng: number) => Math.floor(((lng - w) / (e - w)) * W);
  const rowOf = (lat: number) => Math.floor(((n - lat) / (n - s)) * H);

  return {
    w: W,
    h: H,
    extent: AOI.climateExtent,
    strength,
    lakeMask,
    waterAt(lng, lat) {
      const ci = colOf(lng);
      const cj = rowOf(lat);
      if (ci < 0 || cj < 0 || ci >= W || cj >= H) return 0;
      // A city sits "on" a river if a strong channel runs within a couple cells.
      let best = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const i = ci + dx;
          const j = cj + dy;
          if (i < 0 || j < 0 || i >= W || j >= H) continue;
          const v = strength[j * W + i];
          if (v > best) best = v;
        }
      }
      return best;
    },
    toRiverLines(minStrength) {
      // Each channel cell links to its downstream receiver — emit that segment
      // as a short polyline tagged with the cell's strength. The drainage tree
      // guarantees these join end-to-end into continuous rivers.
      const centre = (k: number): [number, number] => {
        const i = k % W;
        const j = (k / W) | 0;
        const lng = w + ((i + 0.5) / W) * (e - w);
        const lat = n - ((j + 0.5) / H) * (n - s);
        return [lng, lat];
      };
      const features: FeatureCollection<LineString, { strength: number }>["features"] = [];
      for (let k = 0; k < N; k++) {
        if (ocean[k] || strength[k] < minStrength) continue;
        const r = receiver[k];
        if (r < 0) continue;
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [centre(k), centre(r)] },
          properties: { strength: strength[k] },
        });
      }
      return { type: "FeatureCollection", features };
    },
    toRiverChains(minStrength) {
      const sampleAt = (k: number) => {
        const i = k % W;
        const j = (k / W) | 0;
        return {
          lng: w + ((i + 0.5) / W) * (e - w),
          lat: n - ((j + 0.5) / H) * (n - s),
          strength: strength[k],
        };
      };
      // A cell is a HEADWATER of a drawn channel if it's above threshold but no
      // upstream cell feeds it above threshold. Walk each headwater down its
      // receivers until it drops below threshold or hits the sea — one chain.
      const feedsInto = new Int32Array(N).fill(0); // count of above-threshold donors
      for (let k = 0; k < N; k++) {
        if (ocean[k] || strength[k] < minStrength) continue;
        const r = receiver[k];
        if (r >= 0 && strength[r] >= minStrength) feedsInto[r]++;
      }
      const chains: RiverChain[] = [];
      const visited = new Uint8Array(N);
      for (let k = 0; k < N; k++) {
        if (ocean[k] || strength[k] < minStrength || feedsInto[k] > 0) continue;
        // Headwater: walk downstream.
        const pts: RiverChain["points"] = [];
        let cur = k;
        let guard = 0;
        while (cur >= 0 && !ocean[cur] && strength[cur] >= minStrength && guard++ < N) {
          pts.push(sampleAt(cur));
          visited[cur] = 1;
          const r = receiver[cur];
          // Continue into the receiver even if confluence (so trunks are whole).
          cur = r;
        }
        // Include the outlet/confluence point for a clean join.
        if (cur >= 0) pts.push(sampleAt(cur));
        if (pts.length >= 2) chains.push({ points: pts });
      }
      return chains;
    },
  };
}

// --- Cache: recompute only when an input that changes drainage moves. ---
const cache = new Map<string, Promise<HydroGrid>>();

function keyFor(inp: ClimateInputs, editsKey: string): string {
  // Drainage depends on the DEM + sea level (both pole-driven) + any terrain
  // edits; season-independent, so season is left out to avoid recompute on scrub.
  return [inp.pole[0], inp.pole[1], inp.seaLevelM, editsKey].join(",");
}

/** A function that turns a loaded DEM block into the composite elevation sampler
 *  the hydrology should use (base DEM + detail noise + edits). */
export type HydroSamplerFactory = (block: DemBlock) => (lng: number, lat: number) => number | null;

/**
 * Compute (or return cached) hydrology. With no options, drains the raw DEM
 * (the original behaviour). Pass `editsKey` + `sampler` to drain the composite
 * field instead — so terrain edits reroute the rivers. Keyed so each distinct
 * edit set caches separately.
 */
export function getHydrology(
  inp: ClimateInputs,
  opts: { editsKey?: string; sampler?: HydroSamplerFactory } = {},
): Promise<HydroGrid> {
  const key = keyFor(inp, opts.editsKey ?? "");
  const hit = cache.get(key);
  if (hit) return hit;
  const [w, s, e, n] = AOI.climateExtent;
  const p = loadDemBlock(w, s, e, n).then((block) =>
    buildGrid(block, inp, opts.sampler ? opts.sampler(block) : undefined),
  );
  cache.set(key, p);
  return p;
}
