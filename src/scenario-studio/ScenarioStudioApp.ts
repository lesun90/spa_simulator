import { HttpSceneCatalog } from "./catalog/HttpSceneCatalog";
import { ScenarioDocument } from "./domain/ScenarioDocument";
import { ScenarioSession } from "./domain/ScenarioSession";
import { ScenarioViewport } from "./rendering/ScenarioViewport";
import { ScenarioWorkspace } from "./ui/ScenarioWorkspace";

export class ScenarioStudioApp {
  private readonly workspace: ScenarioWorkspace;
  private readonly viewport: ScenarioViewport;
  private readonly session: ScenarioSession;
  private disposed = false;

  constructor(host: HTMLElement) {
    const catalog = new HttpSceneCatalog();
    this.workspace = new ScenarioWorkspace(() => catalog.list(), async (reference) => {
      await this.session.replaceScene(reference);
      if (!this.disposed) this.workspace.setActive(this.session.document.sceneReference);
    });
    host.append(this.workspace.root);
    this.viewport = new ScenarioViewport(this.workspace.canvas);
    this.session = new ScenarioSession(new ScenarioDocument(), catalog, this.viewport);
    void this.workspace.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.session.dispose();
    this.viewport.dispose();
    this.workspace.dispose();
  }
}
