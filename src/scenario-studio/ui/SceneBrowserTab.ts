import type { SceneChoice } from "../domain/scene";

export class SceneBrowserTab {
  readonly root = document.createElement("div");
  private readonly cards = document.createElement("div");
  private readonly empty = document.createElement("p");

  constructor(private readonly onSelect: (choice: SceneChoice) => void) {
    this.root.className = "scenario-scenes";
    this.cards.className = "scenario-cards";
    this.empty.className = "scenario-empty";
    this.root.append(this.cards, this.empty);
  }

  render(choices: readonly SceneChoice[], candidate: SceneChoice | null, activeKey: string | null): void {
    this.cards.replaceChildren();
    this.empty.textContent = choices.length ? "" : "No published scenes found in assets/scenes.";
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scenario-card";
      button.dataset.key = choice.reference.key;
      button.setAttribute("aria-pressed", String(candidate?.reference.key === choice.reference.key));
      button.disabled = !choice.available;
      const thumb = document.createElement("div");
      thumb.className = "scenario-thumb";
      if (choice.thumbnailUrl) {
        const img = document.createElement("img");
        img.src = choice.thumbnailUrl;
        img.alt = "";
        thumb.append(img);
      } else {
        thumb.textContent = "SCENE / 3D";
      }
      const details = document.createElement("div");
      details.className = "scenario-card-details";
      const label = document.createElement("strong");
      label.textContent = choice.label;
      const description = document.createElement("small");
      description.textContent = choice.available
        ? choice.reference.key === activeKey ? "IN USE" : "READY TO LOAD"
        : choice.diagnostics.join(" ");
      details.append(label, description);
      button.append(thumb, details);
      button.addEventListener("click", () => this.onSelect(choice));
      this.cards.append(button);
    }
  }
}
