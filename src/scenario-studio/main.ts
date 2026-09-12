import { ScenarioStudioApp } from "./ScenarioStudioApp";
import "./scenario-studio.css";

const app = new ScenarioStudioApp(document.body);
window.addEventListener("pagehide", () => app.dispose(), { once: true });
