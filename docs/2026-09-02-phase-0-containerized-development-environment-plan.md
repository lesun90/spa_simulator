# Phase 0 Containerized Development Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a clean machine run the simulator development server with `docker compose up`, live compilation, and no host-installed Node.js dependencies.

**Architecture:** A single Docker Compose service runs the frontend development server. The repository is bind-mounted for live source changes, while dependencies stay in a named Docker volume. The initial TypeScript application provides a canvas health page that proves the environment works.

**Tech Stack:** Docker Compose, Docker, Node.js container image, TypeScript, Vite.

## Global Constraints

- Docker and Docker Compose are the only required host dependencies.
- `docker compose up` starts the local development server.
- Source files are bind-mounted into the container.
- Node.js dependencies are installed and retained only in Docker-managed storage.
- File watching must work through Docker bind mounts.
- The development server must expose a documented host port.
- README is the single onboarding guide.
- Phase 0 does not add simulation, Three.js, physics, workers, or asset tooling.

---

## File Structure

- `compose.yaml`: Developer-facing service, source bind mount, dependency volume, port mapping, and watcher settings.
- `Dockerfile`: Development image and container startup command.
- `.dockerignore`: Excludes Git data, generated output, and dependencies from build context.
- `.gitignore`: Excludes project-generated files from Git.
- `package.json`: Development, build, and test commands plus dependencies.
- `package-lock.json`: Locked JavaScript dependencies.
- `vite.config.ts`: Container network binding and Docker-compatible watcher configuration.
- `tsconfig.json`: Strict TypeScript settings.
- `index.html`: Application root document.
- `src/main.ts`: TypeScript entry point.
- `src/App.ts`: Canvas health page.
- `src/App.css`: Health-page styles.
- `tests/app.test.ts`: Health-page test.
- `README.md`: Container-first onboarding guide.

---

### Task 1: Create the minimal health application

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/App.ts`
- Create: `src/App.css`
- Create: `tests/app.test.ts`

**Produces:**
- `npm run dev` starts the application.
- `npm run build` type-checks and produces a production bundle.
- The browser-visible health page identifies the server as ready.

- [ ] **Step 1: Write the failing health-page test**

```ts
import App from "../src/App";

test("renders the development environment status", () => {
  document.body.innerHTML = '<canvas id="app"></canvas>';
  new App(document.getElementById("app") as HTMLCanvasElement).start();

  expect(document.title).toBe("Steerlab development environment");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- --run tests/app.test.ts
```

Expected: failure because the application and test configuration do not yet exist.

- [ ] **Step 3: Add the minimal strict TypeScript canvas application**

```ts
export default class App {
  constructor(private readonly canvas: HTMLCanvasElement) {}

  start() {
    document.title = "Steerlab development environment";
    const context = this.canvas.getContext("2d");
    context?.fillText("Server is running.", 24, 48);
  }
}
```

- [ ] **Step 4: Configure the development server for container access and polling**

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      usePolling: true,
      interval: 250,
    },
  },
});
```

- [ ] **Step 5: Run the application checks**

Run:

```bash
npm test -- --run tests/app.test.ts
npm run build
```

Expected: the test passes and the production build completes without TypeScript errors.

- [ ] **Step 6: Commit the standalone health application**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src tests
git commit -m "feat: add development environment health page"
```

---

### Task 2: Containerize the development server

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `.dockerignore`
- Create: `.gitignore`

**Consumes:**
- `package.json` development script from Task 1.
- Vite server port `5173` from `vite.config.ts`.

**Produces:**
- `docker compose up` starts the development server at `http://localhost:5173`.
- Host source changes trigger container-side live compilation.
- Dependencies persist in the named `node_modules` Docker volume.

- [ ] **Step 1: Write a Compose smoke-test command before adding configuration**

Run:

```bash
docker compose up --build
```

Expected: failure because `compose.yaml` does not exist.

- [ ] **Step 2: Create the development image**

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

- [ ] **Step 3: Create the Compose service with source and dependency mounts**

```yaml
services:
  app:
    build:
      context: .
    ports:
      - "5173:5173"
    volumes:
      - .:/workspace
      - node_modules:/workspace/node_modules
    environment:
      CHOKIDAR_USEPOLLING: "true"
      CHOKIDAR_INTERVAL: "250"
    command: npm run dev -- --host 0.0.0.0

volumes:
  node_modules:
```

- [ ] **Step 4: Exclude generated local files from image context and version control**

`.dockerignore`:

```text
.git
node_modules
dist
coverage
```

`.gitignore`:

```text
node_modules
dist
coverage
```

- [ ] **Step 5: Verify the container starts and serves the health page**

Run:

```bash
docker compose up --build -d
curl --fail http://localhost:5173
docker compose logs app
```

Expected: `curl` succeeds and logs show the development server listening on port `5173`.

- [ ] **Step 6: Verify live compilation through the bind mount**

- Change `Server is running.` in `src/App.ts` to `Live compilation is working.`
- Refresh `http://localhost:5173`.
- Confirm the changed text appears without rebuilding the image or restarting Compose.
- Restore `Server is running.` after verification.

- [ ] **Step 7: Stop the environment cleanly**

Run:

```bash
docker compose down
```

Expected: the application container stops and the named dependency volume remains for the next startup.

- [ ] **Step 8: Commit the containerized environment**

```bash
git add Dockerfile compose.yaml .dockerignore .gitignore
git commit -m "feat: add Docker Compose development environment"
```

---

### Task 3: Document the container-first workflow

**Files:**
- Create: `README.md`

**Consumes:**
- Compose service name `app`.
- Port `5173`.
- Named volume `node_modules`.

**Produces:**
- A single onboarding document that lets a new contributor start, stop, reset, and troubleshoot the environment.

- [ ] **Step 1: Write README acceptance checks**

The README must answer:
- What host software is required?
- What command starts the app?
- What URL opens the app?
- How are source edits reflected?
- How is the environment stopped?
- How are Docker-managed dependencies reset?
- What should a contributor check for port conflicts, file watching, and Docker permission problems?

- [ ] **Step 2: Create the README**

```markdown
# Steerlab

## Prerequisites

Install Docker Engine and Docker Compose. Node.js and project dependencies do not need to be installed on the host machine.

## Start the development environment

```bash
docker compose up
```

Open http://localhost:5173.

Edit files in the repository. The development server recompiles the application and refreshes the browser automatically.

## Stop the environment

```bash
docker compose down
```

## Reset Docker-managed dependencies

```bash
docker compose down -v
docker compose up --build
```

## Troubleshooting

- If port 5173 is already in use, stop the process using it or change the host port in `compose.yaml`.
- If edits do not refresh the browser, verify Docker is allowed to access the repository directory, then restart with `docker compose down` followed by `docker compose up`.
- If Docker reports a permission error on Linux, ensure the current account can run Docker commands.
```

- [ ] **Step 3: Verify the documented fresh-start workflow**

Run:

```bash
docker compose down -v
docker compose up --build -d
curl --fail http://localhost:5173
docker compose down
```

Expected: a fresh dependency volume is created, the application serves successfully, and the environment stops without errors.

- [ ] **Step 4: Commit the onboarding guide**

```bash
git add README.md
git commit -m "docs: add Docker development workflow"
```

---

## Self-Review

- **Coverage:** The plan covers Docker-only host prerequisites, `docker compose up`, exposed development server, bind-mounted source, live compilation, Docker-managed dependencies, a health page, stop/reset commands, and troubleshooting.
- **Scope:** It intentionally excludes simulation-specific systems until later milestones.
- **Consistency:** The Compose file, Vite configuration, README, and verification commands all use port `5173` and service name `app`.
