// File I/O glue for save/load + import/export, and the toolbar that drives it.
// Browser-only concerns (download blobs, file pickers) live here so snapshot.ts
// stays pure data logic.

import {
  exportSnapshot,
  exportGeoJSON,
  importSnapshot,
  isSnapshot,
  type ImportResult,
} from "./snapshot";

function download(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Read a user-picked .json file as parsed JSON. */
function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json,.geojson";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch (err) {
          resolve(Promise.reject(err instanceof Error ? err : new Error("Invalid JSON")));
        }
      };
      reader.onerror = () => resolve(Promise.reject(new Error("Could not read file")));
      reader.readAsText(file);
    });
    input.click();
  });
}

export interface IOHandlers {
  setStatus: (text: string, kind?: "info" | "error") => void;
  /** Called after a successful import so the app can reload + rebuild. */
  onImported: () => Promise<void> | void;
  /** Confirm a destructive/large action with the user. */
  confirm: (message: string) => boolean;
}

function summarizeImport(r: ImportResult): string {
  const parts = [
    `${r.factions} factions`,
    `${r.locations} locations`,
    `${r.routes} routes`,
    `${r.territories} territories`,
    `${r.terrain} terrain regions`,
    `${r.breaks} breaks`,
    `${r.corridors} corridors`,
    `${r.notes} notes`,
  ];
  let msg = `Imported ${parts.join(", ")}.`;
  if (r.errors.length) msg += ` ${r.errors.length} item(s) skipped — see console.`;
  return msg;
}

/** Mount Save / Export GeoJSON / Import buttons into a toolbar element. */
export function mountIOToolbar(container: HTMLElement, handlers: IOHandlers): void {
  const mkBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "io-btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    container.append(btn);
    return btn;
  };

  mkBtn("Save", () => {
    handlers.setStatus("Exporting…");
    exportSnapshot()
      .then((snap) => {
        download(`remnant-atlas-${stamp()}.json`, snap);
        handlers.setStatus("Saved snapshot to file.");
      })
      .catch((err: unknown) =>
        handlers.setStatus(err instanceof Error ? err.message : String(err), "error"),
      );
  });

  mkBtn("Export GeoJSON", () => {
    handlers.setStatus("Exporting GeoJSON…");
    exportGeoJSON()
      .then((fc) => {
        download(`remnant-atlas-${stamp()}.geojson`, fc);
        handlers.setStatus("Exported GeoJSON.");
      })
      .catch((err: unknown) =>
        handlers.setStatus(err instanceof Error ? err.message : String(err), "error"),
      );
  });

  mkBtn("Import", () => {
    pickJsonFile()
      .then(async (parsed) => {
        if (parsed == null) return;
        if (!isSnapshot(parsed)) {
          handlers.setStatus("Not a Remnant Atlas snapshot (use Save to create one).", "error");
          return;
        }
        const fc = parsed.features.features.length;
        if (!handlers.confirm(`Import ${fc} features (appended to the current map)?`)) return;
        handlers.setStatus("Importing…");
        const result = await importSnapshot(parsed);
        if (result.errors.length) console.warn("[import] skipped:", result.errors);
        await handlers.onImported();
        handlers.setStatus(summarizeImport(result));
      })
      .catch((err: unknown) =>
        handlers.setStatus(err instanceof Error ? err.message : String(err), "error"),
      );
  });

  container.hidden = false;
}
