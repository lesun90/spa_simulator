import type { SceneCatalog } from "../catalog/SceneCatalog";
import type { ScenePresentation, ScenePresenter } from "./ScenePresentation";
import { ScenarioDocument } from "./ScenarioDocument";
import { sameSceneReference, type SceneReference } from "./scene";

/** Serializes scene commits while allowing obsolete preparations to finish and release safely. */
export class ScenarioSession {
  private generation = 0;
  private disposed = false;
  private presentation: ScenePresentation;

  constructor(
    readonly document: ScenarioDocument,
    private readonly catalog: SceneCatalog,
    private readonly presenter: ScenePresenter
  ) {
    this.presentation = presenter.createDefault();
    presenter.show(this.presentation);
  }

  async replaceScene(reference: SceneReference): Promise<void> {
    if (this.disposed) return;
    if (sameSceneReference(this.document.sceneReference, reference)) return;
    const request = ++this.generation;
    let prepared: ScenePresentation | null = null;
    try {
      prepared = await this.presenter.prepare(await this.catalog.load(reference));
      if (this.disposed || request !== this.generation) return;
      this.presenter.show(prepared);
      const old = this.presentation;
      this.presentation = prepared;
      prepared = null;
      this.document.replaceScene(reference);
      old.dispose();
    } finally {
      prepared?.dispose();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.presentation.dispose();
  }
}
