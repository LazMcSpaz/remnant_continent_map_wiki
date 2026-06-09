# server/data — local DEM storage (gitignored)

Downloaded elevation GeoTIFFs live here. They are **not** committed (large
binaries) — fetch them on your machine.

```bash
# US core (3DEP 10 m). Example: the Midwest working area.
python -m app.fetch_dem --extent -104 36 -88 46 --out midwest_10m.tif
```

The service auto-loads the first `*.tif` it finds here. Drop in a bigger mosaic
or swap files to change the working region.

Size guidance: 10 m over a ~16°×10° window is on the order of a few GB
uncompressed in memory when windowed — fine for a desktop, which is the whole
point of running this locally.
