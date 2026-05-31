// DERIVED: travel modes + travel-time calc.
//
// Travel time always computes from a route's length, the chosen travel mode's
// speed, and the route's physical status (damaged/destroyed slow it but never
// stop it). Breaks are annotations — they do NOT affect travel time.
//
// Speeds are deliberately arbitrary, stylized mph for the world model.

import type { RouteStatus } from "../state/db-types";

export interface TravelMode {
  id: string;
  label: string;
  mph: number;
}

export const TRAVEL_MODES: TravelMode[] = [
  { id: "foot", label: "On foot (small group)", mph: 3 },
  { id: "caravan", label: "Caravan (large group)", mph: 8 },
  { id: "mounted", label: "Mounted riders", mph: 18 },
  { id: "landship", label: "Landship (hover)", mph: 35 },
  { id: "motor", label: "Motorized convoy", mph: 50 },
  { id: "rail", label: "Rail", mph: 70 },
];

const KM_PER_MILE = 1.609344;

let current: TravelMode = TRAVEL_MODES[0];

export function getTravelMode(): TravelMode {
  return current;
}
export function setTravelMode(id: string): void {
  current = TRAVEL_MODES.find((m) => m.id === id) ?? current;
}

/** A physical-condition speed factor — never zero, so travel always computes. */
function statusFactor(status: RouteStatus): number {
  if (status === "destroyed") return 0.25; // passable only with great difficulty
  if (status === "damaged") return 0.5;
  return 1;
}

/** Travel time in hours for a length (km) at a mode (default current) + status. */
export function travelHours(lengthKm: number, status: RouteStatus, mode: TravelMode = current): number {
  const miles = lengthKm / KM_PER_MILE;
  const mph = mode.mph * statusFactor(status);
  return mph > 0 ? miles / mph : 0;
}

export const LANDSHIP_MODE: TravelMode =
  TRAVEL_MODES.find((m) => m.id === "landship") ?? TRAVEL_MODES[0];

/** Length formatted in imperial miles. */
export function formatMiles(lengthKm: number): string {
  const miles = lengthKm / KM_PER_MILE;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

/** Format hours as "3.4 h" or "2 d 4 h" for long hauls. */
export function formatHours(hours: number): string {
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours - days * 24);
  return `${days} d ${rem} h`;
}
