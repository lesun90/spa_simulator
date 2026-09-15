import { join } from "node:path";
import { homedir } from "node:os";
import type { Plugin } from "vite";
import { scenarioStudioRoutes } from "./scenarioStudio/routes";

/** The same catalog, asset, and contained scenario middleware serves dev and release-build review. */
export function scenarioStudioPlugin(
  assetRoot = join(process.cwd(), "assets"),
  scenarioRoot = process.env.STEERLAB_SCENARIOS_DIR ?? join(homedir(), ".steerlab", "scenarios")
): Plugin {
  const routes = scenarioStudioRoutes(assetRoot, scenarioRoot);
  const attach = (middlewares: { use(handler: (request: any, response: any, next: () => void) => void): void }) => {
    middlewares.use((request, response, next) => {
      void routes(request, response).then((handled) => { if (!handled) next(); });
    });
  };
  return {
    name: "scenario-studio-api",
    configureServer(server) { attach(server.middlewares); },
    configurePreviewServer(server) { attach(server.middlewares); }
  };
}
