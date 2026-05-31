// Ties the pure engine to the app: holds the current SimState, (re)builds the
// per-city baselines from derived resources, drives the map overlay, and serves
// the SimControl host. Lives in sim/ so the engine seam stays clean — it reads
// the graph + a baselines snapshot and nothing else from the rest of the app.

import type { Map as MlMap } from "maplibre-gl";
import type { NetworkGraph } from "../derived/network-graph";
import type { FeatureData } from "../layers/features";
import type { ClimateInputs } from "../derived/climate";
import { climateInputs } from "../derived/climate";
import { deriveCityResources } from "../derived/resources";
import { buildBaselines } from "./baselines";
import { buildRelationFn } from "./relations";
import { step, run, initialState } from "./engine";
import { SimOverlay } from "./sim-overlay";
import type { CityBaselines, RelationFn, SimState } from "./types";
import type { SimHost, SimSummary } from "./sim-control";

export class SimController implements SimHost {
  private overlay: SimOverlay;
  private getData: () => FeatureData;
  private getGraph: () => NetworkGraph;
  private setStatus: (msg: string, kind?: "info" | "error") => void;

  private baselines: CityBaselines = {};
  private relation: RelationFn = () => "self";
  private state: SimState = initialState();
  private ready = false;

  constructor(
    map: MlMap,
    getData: () => FeatureData,
    getGraph: () => NetworkGraph,
    setStatus: (msg: string, kind?: "info" | "error") => void,
  ) {
    this.overlay = new SimOverlay(map);
    this.getData = getData;
    this.getGraph = getGraph;
    this.setStatus = setStatus;
  }

  setVisible(visible: boolean): void {
    this.overlay.setVisible(visible);
    if (visible && !this.ready) void this.rebuildBaselines();
  }

  isVisible(): boolean {
    return this.overlay.isVisible();
  }

  /** Recompute baselines from current data (resources are async — DEM samples).
   *  Resets the run, since production/consumption changed. */
  async rebuildBaselines(): Promise<void> {
    const data = this.getData();
    const inp: ClimateInputs = climateInputs(data.worldSettings);
    this.setStatus("Building economy (deriving city production)…");
    try {
      const inputs = [];
      for (const [id, detail] of data.locationDetails) {
        if (!detail.lngLat) continue;
        const overrides = (detail.resources ?? {}) as Record<string, number>;
        const resources = await deriveCityResources(detail.lngLat, overrides, inp);
        inputs.push({
          locationId: id,
          population: detail.population,
          resources,
          factionId: detail.factionId,
          // Tech is now a per-city authored attribute (scales its production).
          techLevel: detail.techLevel,
        });
      }
      this.baselines = buildBaselines(inputs);
      this.relation = buildRelationFn(data.factionRelations);
      this.state = initialState();
      this.ready = true;
      this.overlay.update(this.state, this.getGraph());
      this.setStatus(`Economy ready — ${inputs.length} cities. Step or play the simulation.`);
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }

  /** Data changed (edit, pole move): refresh baselines if the sim is in use. */
  onDataChanged(): void {
    if (this.ready) void this.rebuildBaselines();
  }

  // --- SimHost ---
  stepTurn(): SimSummary {
    this.state = step(this.state, this.getGraph(), this.baselines, { relation: this.relation });
    this.overlay.update(this.state, this.getGraph());
    return this.summary();
  }

  goToTurn(turn: number): SimSummary {
    const opts = { relation: this.relation };
    if (turn <= 0) {
      this.state = initialState();
    } else if (turn >= this.state.turn) {
      this.state = run(this.state, turn - this.state.turn, this.getGraph(), this.baselines, opts);
    } else {
      // Going back: re-run from scratch (deterministic, so this is exact).
      this.state = run(initialState(), turn, this.getGraph(), this.baselines, opts);
    }
    this.overlay.update(this.state, this.getGraph());
    return this.summary();
  }

  reset(): SimSummary {
    this.state = initialState();
    this.overlay.update(this.state, this.getGraph());
    return this.summary();
  }

  current(): SimSummary {
    return this.summary();
  }

  maxTurn(): number {
    return this.state.turn;
  }

  /** Pressure for one location at the current turn (for the wiki panel). */
  pressureFor(locationId: string): number | null {
    return this.state.pressure[locationId] ?? null;
  }

  /** Wealth for one faction at the current turn (for the faction/wiki panels). */
  wealthFor(factionId: string): number {
    return this.state.wealth[factionId] ?? 0;
  }

  private summary(): SimSummary {
    const pressures = Object.values(this.state.pressure);
    const cities = pressures.length;
    const mean = cities ? pressures.reduce((a, b) => a + b, 0) / cities : 0;
    const strained = pressures.filter((p) => p >= 50).length;
    const tradeVolume = this.state.flows.reduce((a, f) => a + f.amount, 0);
    const factions = this.getData().factions;
    const wealth = Object.entries(this.state.wealth)
      .map(([id, w]) => ({
        id,
        name: factions.get(id)?.name ?? "unknown",
        color: factions.get(id)?.color ?? "#888888",
        wealth: w,
      }))
      .sort((a, b) => b.wealth - a.wealth);
    return { turn: this.state.turn, cities, meanPressure: mean, strained, tradeVolume, wealth };
  }
}
