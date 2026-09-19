import Stats from "stats.js";

interface StatsPanelLike {
  update(value: number, maxValue: number): void;
}

interface StatsLike {
  dom: HTMLElement;
  showPanel(id: number): void;
  begin(): void;
  end(): void;
  /** Absent on the minimal test double; real stats.js panels (sim rate, physics latency) are skipped without it. */
  addPanel?(panel: StatsPanelLike): StatsPanelLike;
}

// The step loop targets 60Hz internally; graphing against that ceiling makes a sim that is falling behind visible
// even while the render FPS panel — which only measures paint throughput, not simulation throughput — stays high.
const SIM_HZ_CEILING = 60;
const PHYSICS_MS_CEILING = 100;

export class PerformanceMonitor {
  private readonly stats: StatsLike;
  private readonly toggle: HTMLButtonElement;
  private readonly simPanel: StatsPanelLike | null;
  private readonly physicsPanel: StatsPanelLike | null;
  private visible = true;
  private simStepsThisWindow = 0;
  private simWindowStartMs = 0;

  constructor(private readonly root: HTMLElement = document.body, createStats: () => StatsLike = () => new Stats()) {
    this.stats = createStats();
    this.stats.showPanel(0);
    this.simPanel = this.stats.addPanel?.(new Stats.Panel("SIM Hz", "#ff9800", "#211a02")) ?? null;
    this.physicsPanel = this.stats.addPanel?.(new Stats.Panel("PHYS ms", "#ff5252", "#210505")) ?? null;
    this.simWindowStartMs = performance.now();
    this.prepareStatsDom();

    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.textContent = "Perf";
    this.toggle.setAttribute("aria-pressed", "true");
    this.toggle.style.cssText = [
      "position:fixed",
      "top:56px",
      "right:0",
      "z-index:10000",
      "height:22px",
      "padding:0 8px",
      "border:0",
      "background:#111",
      "color:#eee",
      "font:10px/22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      "cursor:pointer"
    ].join(";");
    this.toggle.addEventListener("click", this.toggleVisible);

    root.append(this.stats.dom, this.toggle);
  }

  begin() {
    if (this.visible) this.stats.begin();
  }

  end() {
    if (this.visible) this.stats.end();
  }

  /** Feeds one completed physics round trip (worker request to response) into the SIM Hz and PHYS ms panels. */
  recordPhysicsStep(latencyMs: number) {
    this.physicsPanel?.update(latencyMs, PHYSICS_MS_CEILING);
    this.simStepsThisWindow++;
    const now = performance.now();
    const elapsed = now - this.simWindowStartMs;
    if (elapsed < 1000) return;
    this.simPanel?.update((this.simStepsThisWindow * 1000) / elapsed, SIM_HZ_CEILING);
    this.simWindowStartMs = now;
    this.simStepsThisWindow = 0;
  }

  dispose() {
    this.toggle.removeEventListener("click", this.toggleVisible);
    this.stats.dom.remove();
    this.toggle.remove();
  }

  private prepareStatsDom() {
    this.stats.dom.style.position = "fixed";
    this.stats.dom.style.top = "0";
    this.stats.dom.style.right = "0";
    this.stats.dom.style.left = "";
    this.stats.dom.style.zIndex = "10000";
  }

  private toggleVisible = () => {
    this.visible = !this.visible;
    this.stats.dom.style.display = this.visible ? "" : "none";
    this.toggle.setAttribute("aria-pressed", String(this.visible));
  };
}
