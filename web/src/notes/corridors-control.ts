// Corridors control (top-left): a "New corridor" button and a list of existing
// corridors. Selecting one opens the group panel; the list reflects which
// corridors are closed (any member severed) at a glance.

import type { RouteGroup } from "../state/db-types";

export interface CorridorsHost {
  listGroups(): RouteGroup[];
  isClosed(groupId: string): boolean;
  openGroup(groupId: string): void;
  newCorridor(): void;
  canEdit(): boolean;
}

export interface CorridorsControl {
  refresh(): void;
}

export function mountCorridorsControl(container: HTMLElement, host: CorridorsHost): CorridorsControl {
  const render = (): void => {
    container.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Corridors";
    container.append(heading);

    const groups = host.listGroups();
    if (groups.length === 0) {
      const empty = document.createElement("p");
      empty.className = "wiki-muted";
      empty.style.fontSize = "0.75rem";
      empty.textContent = "No corridors yet.";
      container.append(empty);
    } else {
      for (const g of groups) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "corridor-item";
        btn.textContent = g.name;
        if (host.isClosed(g.id)) {
          const dot = document.createElement("span");
          dot.className = "corridor-closed-dot";
          dot.title = "Closed (a segment is severed)";
          btn.prepend(dot);
        }
        btn.addEventListener("click", () => host.openGroup(g.id));
        container.append(btn);
      }
    }

    if (host.canEdit()) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "wiki-btn corridor-new";
      add.textContent = "New corridor";
      add.addEventListener("click", () => host.newCorridor());
      container.append(add);
    }
    container.hidden = false;
  };

  render();
  return { refresh: render };
}
