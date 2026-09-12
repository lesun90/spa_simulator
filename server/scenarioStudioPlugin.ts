import { join } from "node:path";
import type { Plugin } from "vite";
import { scenarioStudioRoutes } from "./scenarioStudio/routes";

/** The same read-only catalog and asset middleware serves dev and release-build review. */
export function scenarioStudioPlugin(): Plugin {
  const routes = scenarioStudioRoutes(join(process.cwd(), "assets"));
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
