// DERIVED→SIM bridge: per-city production & consumption baselines.
//
// The flow simulation needs each city's production and consumption per resource
// per turn. We derive them, never store them, exactly like every other derived
// value — so moving the pole (which changes the resource potentials) changes
// what cities make and need, and the simulation moves with it.
//
//   production  = geographic potential (0..100 resource) scaled by workforce
//   consumption = population demand (everyone needs food/water/energy; only
//                 industry consumes "production" goods)
//
// Population is authored (may be null → a small default so unpopulated places
// still participate). Everything is in abstract units/turn; only ratios matter.

import type { CityResources } from "../derived/resources";
import { RESOURCES, type CityBaseline, type CityBaselines, type ResourceKind } from "./types";

/** A place with no authored population still exists as a minor settlement. */
const DEFAULT_POPULATION = 5000;
/** Population scale: consumption units per person per turn, per resource. */
const PER_CAPITA: Record<ResourceKind, number> = {
  food: 1.0,
  water: 1.0,
  energy: 0.6,
  production: 0.25, // only some demand for manufactured goods
};
/** How much a unit of geographic potential (0..100) produces per turn, scaled
 *  by the working population (more hands extract more from the same land). */
const PRODUCTION_GAIN = 0.02;

export interface BaselineInput {
  locationId: string;
  population: number | null;
  resources: CityResources;
}

/** Build one city's baseline from its population + derived resource potentials. */
export function cityBaseline(input: BaselineInput): CityBaseline {
  const pop = input.population && input.population > 0 ? input.population : DEFAULT_POPULATION;
  // Workforce in "thousands of people" — keeps the units human-readable.
  const workforce = pop / 1000;

  const production = {} as Record<ResourceKind, number>;
  const consumption = {} as Record<ResourceKind, number>;
  for (const r of RESOURCES) {
    const potential = input.resources.values[r]?.effective ?? 0; // 0..100
    production[r] = potential * workforce * PRODUCTION_GAIN;
    consumption[r] = workforce * PER_CAPITA[r];
  }
  return { production, consumption, population: pop };
}

/** Build the baselines map for every city that has resources computed. */
export function buildBaselines(inputs: BaselineInput[]): CityBaselines {
  const out: CityBaselines = {};
  for (const i of inputs) out[i.locationId] = cityBaseline(i);
  return out;
}
