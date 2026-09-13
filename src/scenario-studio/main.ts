import { ScenarioStudioApp } from "./ScenarioStudioApp";

const app = new ScenarioStudioApp(document.body);
window.addEventListener("pagehide", () => app.dispose(), { once: true });
