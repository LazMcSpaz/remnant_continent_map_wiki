// Annotation + measurement control panel. Pick the purpose (annotate vs
// measure), the shape (marker / line / region), and a color, then enable to
// click on the map. Pure DOM; drives an AnnotateTool.

import type { AnnotateTool, AnnotateMode, ToolPurpose } from "../derived/annotate-tool";

export function mountAnnotateControl(container: HTMLElement, tool: AnnotateTool): void {
  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = "Annotate & measure";
  container.append(heading);

  const body = document.createElement("div");
  body.className = "climate-body";

  // Enable toggle.
  const enable = button(tool.isActive() ? "Active ✓" : "Enable");
  enable.addEventListener("click", () => {
    const next = !tool.isActive();
    tool.setActive(next);
    enable.textContent = next ? "Active ✓" : "Enable";
    enable.setAttribute("aria-pressed", String(next));
  });
  body.append(enable);

  // Purpose: measure (default, ephemeral) vs annotate (persisted).
  let purpose: ToolPurpose = "measure";
  const purposeRow = document.createElement("div");
  purposeRow.className = "climate-metrics";
  const measureBtn = button("Measure");
  const annotateBtn = button("Annotate");
  const syncPurpose = () => {
    measureBtn.setAttribute("aria-pressed", String(purpose === "measure"));
    annotateBtn.setAttribute("aria-pressed", String(purpose === "annotate"));
  };
  measureBtn.addEventListener("click", () => { purpose = "measure"; tool.setPurpose(purpose); syncPurpose(); });
  annotateBtn.addEventListener("click", () => { purpose = "annotate"; tool.setPurpose(purpose); syncPurpose(); });
  syncPurpose();
  purposeRow.append(measureBtn, annotateBtn);
  body.append(purposeRow);

  // Shape: marker / line / region.
  let mode: AnnotateMode = "line";
  const modeRow = document.createElement("div");
  modeRow.className = "climate-metrics";
  const modeBtns = new Map<AnnotateMode, HTMLButtonElement>();
  for (const m of ["marker", "line", "region"] as AnnotateMode[]) {
    const b = button(m[0].toUpperCase() + m.slice(1));
    b.addEventListener("click", () => {
      mode = m;
      tool.setMode(m);
      for (const [mm, bb] of modeBtns) bb.setAttribute("aria-pressed", String(mm === m));
    });
    modeBtns.set(m, b);
    modeRow.append(b);
  }
  modeBtns.get(mode)!.setAttribute("aria-pressed", "true");
  body.append(modeRow);

  // Color (annotation only; harmless for measure).
  const colorRow = document.createElement("div");
  colorRow.className = "faction-rel-row";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "faction-color-input";
  colorInput.value = "#e0af68";
  colorInput.addEventListener("change", () => tool.setColor(colorInput.value));
  colorRow.append(text("Color", "faction-rel-pair"), colorInput);
  body.append(colorRow);

  const note = document.createElement("p");
  note.className = "climate-note";
  note.textContent = "Measure is ephemeral; Annotate saves a labeled marker/line/region. Double-click or Enter to finish; Esc cancels.";
  body.append(note);

  container.append(body);
  container.hidden = false;
}

function button(label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "climate-metric";
  b.textContent = label;
  return b;
}

function text(content: string, className: string): HTMLElement {
  const s = document.createElement("span");
  s.className = className;
  s.textContent = content;
  return s;
}
