import type { SceneReference } from "./scene";
import type { AgentSnapshot } from "./agent";

/** Owns the authored scene choice; later steps add authored agents and scripts here. */
export class ScenarioDocument {
  private activeScene: SceneReference | null = null;
  private authoredAgents: readonly AgentSnapshot[] = Object.freeze([]);

  get sceneReference(): SceneReference | null {
    return this.activeScene;
  }

  replaceScene(reference: SceneReference): void {
    this.activeScene = Object.freeze({ ...reference });
  }

  get agents(): readonly AgentSnapshot[] {
    return this.authoredAgents;
  }

  replaceAgents(agents: readonly AgentSnapshot[]): void {
    this.authoredAgents = Object.freeze([...agents]);
  }
}
