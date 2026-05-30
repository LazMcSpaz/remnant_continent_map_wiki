# `data/` — geographic source data

The tool is built on **real open geographic data** for the American Midwest,
then re-skinned and edited to reflect the fiction. Large source files are **not
committed** — they are fetched locally and live in gitignored subfolders
(`data/raw/`, `data/cache/`). See `.gitignore`.

> **Licensing:** OSM, imagery providers, and DEM sources each carry their own
> attribution and usage requirements. Check terms before shipping anything.

## What goes where

```
data/
  README.md      this file
  raw/           (gitignored) downloaded extracts: .osm.pbf, .tif DEM tiles, etc.
  cache/         (gitignored) derived tiles: .pmtiles / .mbtiles, processed rasters
```

## Sources (per README "Tech stack → Data sources")

### Vector features — OpenStreetMap
Roads, rail, waterways, and place names for the region (Omaha, Kansas City,
Des Moines, Lincoln, Denver, the Missouri corridor, the Great Lakes).

Suggested fetch approaches (pick one when Phase 1 ingestion is built):
- Regional extract from a provider such as Geofabrik (US Midwest states), then
  clip to the area of interest.
- Convert to vector tiles (e.g. `.pmtiles`) for the MapLibre basemap.

### Elevation — open DEM
An open DEM such as **SRTM** provides the base terrain the cataclysm reshapes
(authored `elevation_edits` are deltas over this base).

### Imagery — open satellite
Open sources such as **Sentinel-2** / **Landsat**, or a tile service such as
ESRI World Imagery, for the satellite/imagery layer.

## Fetch instructions

To be filled in when Phase 1 data ingestion is implemented. Each entry should
record: exact source/URL, the clip bounds used, the conversion command, and the
attribution string required for that source.
