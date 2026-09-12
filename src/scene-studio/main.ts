import { App } from "../app/App";

const canvas = document.createElement("canvas");
canvas.id = "app";
canvas.setAttribute("aria-label", "Scene Studio");
document.body.append(canvas);

const app = new App(canvas);
app.start();
