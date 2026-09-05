import Stats from "stats.js";

interface StatsLike {
  dom: HTMLElement;
  showPanel(id: number): void;
  begin(): void;
  end(): void;
}

export class PerformanceMonitor {
  private readonly stats: StatsLike;
  private readonly toggle: HTMLButtonElement;
  private visible = true;

  constructor(private readonly root: HTMLElement = document.body, createStats: () => StatsLike = () => new Stats()) {
    this.stats = createStats();
    this.stats.showPanel(0);
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
