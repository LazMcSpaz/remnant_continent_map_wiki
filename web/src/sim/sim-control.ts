// Flow-simulation control panel (pure DOM). Drives the engine via a host: run a
// turn, scrub to a turn, reset. Shows the current turn and a network-wide
// pressure summary. Talks only to a SimHost (implemented in main.ts) so it owns
// no engine, map, or data state — consistent with the layered design.

export interface SimSummary {
  turn: number;
  /** Number of cities in the simulated network. */
  cities: number;
  /** Mean pressure across cities (0..100). */
  meanPressure: number;
  /** Count of cities in serious deficit (pressure ≥ 50). */
  strained: number;
  /** Total trade volume moved this turn. */
  tradeVolume: number;
}

export interface SimHost {
  /** Advance one turn; returns the new summary. */
  stepTurn(): SimSummary;
  /** Jump to an absolute turn (re-running from 0 as needed); returns summary. */
  goToTurn(turn: number): SimSummary;
  /** Reset to turn 0 (empty state); returns summary. */
  reset(): SimSummary;
  /** Current summary without advancing. */
  current(): SimSummary;
  /** Highest turn reached so far (for the slider max). */
  maxTurn(): number;
}

const MAX_SLIDER = 60;

export function mountSimControl(container: HTMLElement, host: SimHost): void {
  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.className = "climate-heading";
  heading.textContent = "Simulation";
  container.append(heading);

  const body = document.createElement("div");
  body.className = "climate-body";

  // Transport buttons.
  const controls = document.createElement("div");
  controls.className = "sim-controls";
  const playBtn = button("▶ Play");
  const stepBtn = button("Step ▶");
  const resetBtn = button("Reset");
  controls.append(playBtn, stepBtn, resetBtn);
  body.append(controls);

  // Turn slider.
  const sliderWrap = document.createElement("label");
  sliderWrap.className = "climate-season";
  const turnLabel = document.createElement("span");
  turnLabel.className = "climate-season-label";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(MAX_SLIDER);
  slider.step = "1";
  slider.value = "0";
  sliderWrap.append(turnLabel, slider);
  body.append(sliderWrap);

  // Readout.
  const readout = document.createElement("div");
  readout.className = "sim-readout";
  body.append(readout);

  container.append(body);
  container.hidden = false;

  let playing = false;
  let timer: number | undefined;

  const render = (s: SimSummary): void => {
    turnLabel.textContent = `Turn ${s.turn}`;
    slider.max = String(Math.max(MAX_SLIDER, host.maxTurn()));
    slider.value = String(s.turn);
    readout.replaceChildren(
      stat("Cities", String(s.cities)),
      stat("Mean pressure", s.meanPressure.toFixed(0)),
      stat("Strained", String(s.strained)),
      stat("Trade / turn", s.tradeVolume.toFixed(0)),
    );
  };

  const stopPlay = (): void => {
    playing = false;
    playBtn.textContent = "▶ Play";
    if (timer != null) window.clearInterval(timer);
    timer = undefined;
  };

  playBtn.addEventListener("click", () => {
    if (playing) {
      stopPlay();
      return;
    }
    playing = true;
    playBtn.textContent = "❚❚ Pause";
    timer = window.setInterval(() => render(host.stepTurn()), 900);
  });

  stepBtn.addEventListener("click", () => {
    stopPlay();
    render(host.stepTurn());
  });

  resetBtn.addEventListener("click", () => {
    stopPlay();
    render(host.reset());
  });

  slider.addEventListener("input", () => {
    stopPlay();
    render(host.goToTurn(Number(slider.value)));
  });

  render(host.current());
}

function button(label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "climate-metric";
  b.textContent = label;
  return b;
}

function stat(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "sim-stat";
  const l = document.createElement("span");
  l.className = "sim-stat-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "sim-stat-val";
  v.textContent = value;
  row.append(l, v);
  return row;
}
