// Chronicle control (top-left): a year-scrubbing timeline of authored dated
// narrative events. Shows a slider over the year range, a tag filter, and a
// filtered/sorted list. When canEdit() is true, an "Add event" form is shown.
//
// Pure DOM; all data access goes through a ChronicleHost (implemented in main.ts).

import type { ChronicleEvent } from "../layers/features";
import { sortEvents, filterEvents, yearRange } from "./chronicle";

export interface ChronicleHost {
  listEvents(): ChronicleEvent[];
  addEvent(event: Omit<ChronicleEvent, "id">): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  canEdit(): boolean;
  reload(): void;
}

export interface ChronicleControl {
  refresh(): void;
}

export function mountChronicleControl(
  container: HTMLElement,
  host: ChronicleHost,
): ChronicleControl {
  // Local panel state persists across re-renders.
  let scrubYear: number | null = null;
  let filterTag = "";
  let filterQuery = "";

  const render = (): void => {
    container.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = "Chronicle";
    container.append(heading);

    const all = sortEvents(host.listEvents());
    const [minYear, maxYear] = yearRange(all);

    // Initialise scrub year on first render or if events changed enough that
    // the stored value is no longer valid.
    if (scrubYear === null || all.length === 0) {
      scrubYear = maxYear;
    } else {
      scrubYear = Math.max(minYear, Math.min(maxYear, scrubYear));
    }

    if (all.length === 0) {
      container.append(muted("No chronicle events yet."));
      if (host.canEdit()) container.append(buildAddForm(host));
      container.hidden = false;
      return;
    }

    // --- Year slider ----------------------------------------------------------
    const seasonWrap = document.createElement("label");
    seasonWrap.className = "climate-season";
    const yearText = document.createElement("span");
    yearText.className = "climate-season-label";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(minYear);
    slider.max = String(maxYear);
    slider.step = "1";
    slider.value = String(scrubYear);

    const setYearText = (y: number): void => {
      yearText.textContent = `Year: ${y < 0 ? `${Math.abs(y)} BE` : String(y)}`;
    };
    setYearText(scrubYear);

    slider.addEventListener("input", () => {
      scrubYear = Number(slider.value);
      setYearText(scrubYear);
      renderList();
    });

    seasonWrap.append(yearText, slider);
    container.append(seasonWrap);

    // --- Tag filter -----------------------------------------------------------
    // Collect all unique tags across all events.
    const allTags = Array.from(new Set(all.flatMap((e) => e.tags))).sort();

    if (allTags.length > 0) {
      const filterWrap = document.createElement("div");
      filterWrap.className = "climate-metrics";

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "climate-metric";
      clearBtn.textContent = "All";
      clearBtn.setAttribute("aria-pressed", String(filterTag === ""));
      clearBtn.addEventListener("click", () => {
        filterTag = "";
        render();
      });
      filterWrap.append(clearBtn);

      for (const tag of allTags) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "climate-metric";
        btn.textContent = tag;
        btn.setAttribute("aria-pressed", String(filterTag === tag));
        btn.addEventListener("click", () => {
          filterTag = tag === filterTag ? "" : tag;
          render();
        });
        filterWrap.append(btn);
      }
      container.append(filterWrap);
    }

    // --- Text search ----------------------------------------------------------
    const searchWrap = document.createElement("div");
    searchWrap.className = "faction-rel-row";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "wiki-field";
    searchInput.placeholder = "Search events…";
    searchInput.value = filterQuery;
    searchInput.style.flex = "1";
    searchInput.addEventListener("input", () => {
      filterQuery = searchInput.value;
      renderList();
    });
    searchWrap.append(searchInput);
    container.append(searchWrap);

    // --- Event list -----------------------------------------------------------
    const listEl = document.createElement("div");
    listEl.className = "climate-body";
    container.append(listEl);

    const renderList = (): void => {
      listEl.replaceChildren();

      const visible = filterEvents(all, { tag: filterTag || undefined, query: filterQuery || undefined });
      // Show only events up to (and including) the scrubbed year.
      const atOrBefore = visible.filter((e) => e.year <= (scrubYear ?? maxYear));

      if (atOrBefore.length === 0) {
        listEl.append(muted("No events match."));
        return;
      }

      // Render in reverse so newest-first within the scrubbed window.
      for (const ev of [...atOrBefore].reverse()) {
        listEl.append(buildEventCard(ev, host));
      }
    };

    renderList();

    // --- Add event form (editors only) ----------------------------------------
    if (host.canEdit()) {
      container.append(buildAddForm(host));
    }

    container.hidden = false;
  };

  render();
  return { refresh: render };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildEventCard(
  ev: ChronicleEvent,
  host: ChronicleHost,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "faction-card";

  const yearLabel = ev.year < 0 ? `${Math.abs(ev.year)} BE` : `Year ${ev.year}`;

  const head = document.createElement("div");
  head.className = "faction-row";
  head.append(span(yearLabel, "faction-meta"), span(ev.title, "faction-name"));
  card.append(head);

  if (ev.body) {
    const body = document.createElement("p");
    body.className = "wiki-muted";
    body.style.margin = "0.2rem 0 0.3rem";
    body.style.fontSize = "0.75rem";
    body.textContent = ev.body;
    card.append(body);
  }

  if (ev.tags.length > 0) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "faction-rel-row";
    for (const t of ev.tags) {
      const tag = document.createElement("span");
      tag.className = "faction-tag";
      tag.textContent = t;
      tagsEl.append(tag);
    }
    card.append(tagsEl);
  }

  if (ev.targetType) {
    const link = document.createElement("div");
    link.className = "faction-field";
    link.append(span("Links to:", ""), span(ev.targetType, "faction-meta"));
    card.append(link);
  }

  if (host.canEdit()) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "wiki-btn";
    del.textContent = "Delete";
    del.style.marginTop = "0.3rem";
    del.addEventListener("click", () => {
      host.deleteEvent(ev.id)
        .then(() => host.reload())
        .catch((err: unknown) => console.error("delete chronicle event:", err));
    });
    card.append(del);
  }

  return card;
}

function buildAddForm(host: ChronicleHost): HTMLElement {
  const section = document.createElement("div");
  section.className = "sim-section";

  const heading = document.createElement("div");
  heading.className = "sim-section";
  heading.textContent = "Add event";
  section.append(heading);

  const yearLabel = document.createElement("label");
  yearLabel.className = "faction-rel-row";
  yearLabel.append(span("Year", "faction-rel-pair"));
  const yearInput = document.createElement("input");
  yearInput.type = "number";
  yearInput.className = "wiki-field faction-rel-select";
  yearInput.placeholder = "e.g. -500 or 1200";
  yearInput.step = "1";
  yearLabel.append(yearInput);
  section.append(yearLabel);

  const titleLabel = document.createElement("label");
  titleLabel.className = "faction-rel-row";
  titleLabel.append(span("Title", "faction-rel-pair"));
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "wiki-field faction-rel-select";
  titleInput.placeholder = "Event title";
  titleLabel.append(titleInput);
  section.append(titleLabel);

  const bodyLabel = document.createElement("label");
  bodyLabel.style.display = "block";
  bodyLabel.append(span("Body", "faction-rel-pair"));
  const bodyInput = document.createElement("textarea");
  bodyInput.className = "wiki-field";
  bodyInput.rows = 3;
  bodyInput.placeholder = "Optional description (markdown)";
  bodyInput.style.width = "100%";
  bodyInput.style.boxSizing = "border-box";
  bodyLabel.append(bodyInput);
  section.append(bodyLabel);

  const tagsLabel = document.createElement("label");
  tagsLabel.className = "faction-rel-row";
  tagsLabel.append(span("Tags", "faction-rel-pair"));
  const tagsInput = document.createElement("input");
  tagsInput.type = "text";
  tagsInput.className = "wiki-field faction-rel-select";
  tagsInput.placeholder = "Comma-separated";
  tagsLabel.append(tagsInput);
  section.append(tagsLabel);

  const errEl = document.createElement("p");
  errEl.className = "wiki-muted";
  errEl.style.color = "var(--color-error, #e06a8a)";
  errEl.style.display = "none";
  section.append(errEl);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "wiki-btn corridor-new";
  addBtn.textContent = "Add event";
  addBtn.addEventListener("click", () => {
    const yearVal = parseInt(yearInput.value, 10);
    const titleVal = titleInput.value.trim();
    if (isNaN(yearVal)) {
      errEl.textContent = "Year must be a number.";
      errEl.style.display = "";
      return;
    }
    if (!titleVal) {
      errEl.textContent = "Title is required.";
      errEl.style.display = "";
      return;
    }
    errEl.style.display = "none";
    const rawTags = tagsInput.value
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const bodyVal = bodyInput.value.trim() || undefined;
    addBtn.disabled = true;
    host
      .addEvent({
        year: yearVal,
        title: titleVal,
        body: bodyVal,
        targetType: undefined,
        targetId: undefined,
        tags: rawTags,
      })
      .then(() => {
        yearInput.value = "";
        titleInput.value = "";
        bodyInput.value = "";
        tagsInput.value = "";
        host.reload();
      })
      .catch((err: unknown) => {
        errEl.textContent = err instanceof Error ? err.message : String(err);
        errEl.style.display = "";
      })
      .finally(() => {
        addBtn.disabled = false;
      });
  });
  section.append(addBtn);

  return section;
}

function span(content: string, className: string): HTMLElement {
  const s = document.createElement("span");
  s.className = className;
  s.textContent = content;
  return s;
}

function muted(content: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "wiki-muted";
  p.style.fontSize = "0.75rem";
  p.textContent = content;
  return p;
}
