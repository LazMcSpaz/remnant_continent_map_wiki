// Terrain editor panel: opens on clicking a terrain region. Edits the authored
// physical INPUTS (elevation, slope/aspect, land cover, soil, water, exposure)
// and shows the DERIVED climate they produce. Saving cascades — the caller
// reloads and recomputes the climate layer, so the choropleth and any open city
// climate readout move with the edit.
//
// Pure DOM; talks to a TerrainHost so it owns no map or data state, mirroring
// the wiki panel's separation.

import type { TerrainRegionGeo, LandCover, SoilDrainage } from "../state/db-types";
import type { RegionDerived } from "../derived/climate";
import { updateTerrainFields, type TerrainFields } from "../layers/features";

/** The panel's window into app state — implemented by main.ts. */
export interface TerrainHost {
  getRegion(id: string): TerrainRegionGeo | undefined;
  /** Derived climate for a region (recomputed from authored inputs). */
  getDerived(id: string): RegionDerived | undefined;
  /** Reload authored data + recompute the derived cascade after a save. */
  reloadData(): Promise<void>;
  canEdit(): boolean;
  setStatus(text: string, kind?: "info" | "error"): void;
}

const LAND_COVERS: LandCover[] = [
  "forest", "grassland", "cropland", "wetland", "desert", "urban", "water", "barren", "tundra",
];
const DRAINAGES: SoilDrainage[] = ["poor", "moderate", "well", "excessive"];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function numField(label: string, value: number | null, opts: { min?: number; max?: number; hint?: string } = {}) {
  const input = el("input", { className: "terra-input", type: "number", value: value == null ? "" : String(value) });
  if (opts.min != null) input.min = String(opts.min);
  if (opts.max != null) input.max = String(opts.max);
  const children: (Node | string)[] = [el("span", { className: "terra-label" }, [label]), input];
  if (opts.hint) children.push(el("span", { className: "terra-hint" }, [opts.hint]));
  return { row: el("label", { className: "terra-field" }, children), input };
}

function selectField(label: string, value: string | null, options: string[]) {
  const select = el("select", { className: "terra-input" });
  select.append(el("option", { value: "" }, ["—"]));
  for (const o of options) {
    const opt = el("option", { value: o }, [o]);
    if (o === value) opt.selected = true;
    select.append(opt);
  }
  return { row: el("label", { className: "terra-field" }, [el("span", { className: "terra-label" }, [label]), select]), select };
}

export class TerrainPanel {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private host: TerrainHost;
  private onClose: () => void;
  private currentId: string | null = null;

  constructor(mount: HTMLElement, host: TerrainHost, onClose: () => void) {
    this.host = host;
    this.onClose = onClose;
    this.titleEl = el("h2", { className: "terra-title", id: "terra-title" });
    const closeBtn = el("button", { type: "button", className: "wiki-close", title: "Close (Esc)" }, ["×"]);
    closeBtn.setAttribute("aria-label", "Close terrain panel");
    closeBtn.addEventListener("click", () => this.close());

    this.bodyEl = el("div", { className: "terra-body" });
    this.root = el("aside", { className: "terra-panel", hidden: true }, [
      el("header", { className: "wiki-header" }, [this.titleEl, closeBtn]),
      this.bodyEl,
    ]);
    this.root.setAttribute("aria-labelledby", "terra-title");
    mount.append(this.root);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  open(id: string): void {
    const region = this.host.getRegion(id);
    if (!region) return;
    this.currentId = id;
    this.titleEl.textContent = region.name || "Unnamed region";
    this.render();
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.currentId = null;
    this.onClose();
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Re-render from fresh host data (after a reload/recompute). */
  refresh(): void {
    if (this.currentId == null) return;
    const region = this.host.getRegion(this.currentId);
    if (region) this.titleEl.textContent = region.name || "Unnamed region";
    this.render();
  }

  private render(): void {
    if (this.currentId == null) return;
    const region = this.host.getRegion(this.currentId);
    if (!region) {
      this.bodyEl.replaceChildren(el("p", { className: "wiki-muted" }, ["Region no longer exists."]));
      return;
    }
    this.bodyEl.replaceChildren();
    this.bodyEl.append(this.derivedReadout(this.currentId));
    if (this.host.canEdit()) this.bodyEl.append(this.editForm(region));
    else this.bodyEl.append(this.readView(region));
  }

  /** The DERIVED climate the inputs produce — recomputed, never stored. */
  private derivedReadout(id: string): HTMLElement {
    const d = this.host.getDerived(id);
    const box = el("div", { className: "terra-derived" });
    box.append(el("h3", { className: "terra-section" }, ["Derived"]));
    if (!d) {
      box.append(el("p", { className: "wiki-muted" }, ["No derived climate (set inputs below)."]));
      return box;
    }
    box.append(
      el("div", { className: "terra-derived-row" }, [
        el("span", {}, [`${d.tempC.toFixed(1)} °C`]),
        el("span", { className: "wiki-muted" }, ["mean temp"]),
      ]),
      el("div", { className: "terra-derived-row" }, [
        el("span", {}, [`${d.crop.suitability}`]),
        el("span", { className: "wiki-muted" }, [`crop suitability · ${d.crop.limiting}-limited`]),
      ]),
      el("p", { className: "wiki-muted terra-derived-note" }, [
        "Recomputed from the inputs below + world settings. Editing elevation, soil, water, or land cover updates this and the map overlay.",
      ]),
    );
    return box;
  }

  private readView(region: TerrainRegionGeo): HTMLElement {
    const rows: Array<[string, string]> = [
      ["Elevation", region.elevation_m == null ? "—" : `${region.elevation_m} m`],
      ["Land cover", region.land_cover ?? "—"],
      ["Soil fertility", region.soil_fertility == null ? "—" : String(region.soil_fertility)],
      ["Surface water", region.surface_water == null ? "—" : String(region.surface_water)],
    ];
    const dl = el("dl", { className: "wiki-dl" });
    for (const [k, v] of rows) dl.append(el("dt", {}, [k]), el("dd", {}, [v]));
    const wrap = el("div", {});
    wrap.append(el("h3", { className: "terra-section" }, ["Inputs"]), dl,
      el("p", { className: "wiki-muted" }, ["Connect a backend to edit."]));
    return wrap;
  }

  private editForm(region: TerrainRegionGeo): HTMLElement {
    const name = el("input", { className: "terra-input", type: "text", value: region.name ?? "" });
    const elevation = numField("Elevation (m)", region.elevation_m, { hint: "feeds temperature via lapse rate" });
    const slope = numField("Slope (°)", region.slope_deg);
    const aspect = numField("Aspect (° bearing)", region.aspect_deg, { min: 0, max: 360 });
    const landCover = selectField("Land cover", region.land_cover, LAND_COVERS);
    const fertility = numField("Soil fertility (0–100)", region.soil_fertility, { min: 0, max: 100, hint: "feeds crop suitability" });
    const drainage = selectField("Soil drainage", region.soil_drainage, DRAINAGES);
    const water = numField("Surface water (0–100)", region.surface_water, { min: 0, max: 100, hint: "feeds crops + city water" });
    const wind = numField("Wind exposure (0–100)", region.wind_exposure, { min: 0, max: 100 });
    const solar = numField("Solar exposure (0–100)", region.solar_exposure, { min: 0, max: 100 });

    const form = el("div", { className: "terra-form" }, [
      el("h3", { className: "terra-section" }, ["Inputs (authored)"]),
      el("label", { className: "terra-field" }, [el("span", { className: "terra-label" }, ["Name"]), name]),
      elevation.row, slope.row, aspect.row,
      landCover.row, fertility.row, drainage.row, water.row,
      wind.row, solar.row,
    ]);

    const num = (input: HTMLInputElement): number | null => {
      const v = input.value.trim();
      if (v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const save = el("button", { type: "button", className: "wiki-btn" }, ["Save"]);
    save.addEventListener("click", () => {
      const fields: Partial<TerrainFields> = {
        name: name.value.trim() || null,
        elevation_m: num(elevation.input),
        slope_deg: num(slope.input),
        aspect_deg: num(aspect.input),
        land_cover: landCover.select.value || null,
        soil_fertility: num(fertility.input),
        soil_drainage: drainage.select.value || null,
        surface_water: num(water.input),
        wind_exposure: num(wind.input),
        solar_exposure: num(solar.input),
      };
      save.disabled = true;
      updateTerrainFields(region.id, fields)
        .then(() => this.host.reloadData()) // cascades: reload → recompute climate
        .then(() => {
          this.host.setStatus("Terrain saved — climate recomputed.");
          this.refresh();
        })
        .catch((err: unknown) => {
          this.host.setStatus(err instanceof Error ? err.message : String(err), "error");
          save.disabled = false;
        });
    });

    form.append(el("div", { className: "terra-actions" }, [save]));
    return form;
  }
}
