# Steerlab

## Prerequisites

Install Docker Engine and Docker Compose. Node.js and project dependencies do not need to be installed on the host machine.

## Start the Development Environment

```bash
docker compose up
```

Open http://localhost:5173.

Edit files in this repository. The development server recompiles the application and refreshes the browser automatically.

Verify the running container is this project:

```bash
curl http://localhost:5173/api/health
```

Expected response:

```json
{"app":"steerlab","phase":"phase-1-scene-editor"}
```

## Scene Editor

The Phase 1 editor opens at http://localhost:5173 and provides:

- Scene collection actions for create, open, rename, duplicate, delete, and save.
- A docked workspace with tools, hierarchy, viewport, inspector, and asset browser, rendered entirely in-canvas with Three.js (no HTML/DOM UI).
- Drag or click assets to place them on the ground plane using Snap or Free placement.
- Undo and redo for persistent scene edits.
- Temporary review imports by dropping a local file into the viewport; scenes that reference temporary assets are blocked from saving.

Scene JSON files are stored outside the repository in the editor-managed user-data directory:

```text
~/.steerlab/scenes
```

Set `STEERLAB_USER_DATA_DIR` to use a different scene location. Shared source-controlled assets live under `assets/`, with one folder per asset.

## Run Checks

Run project checks inside the Compose service:

```bash
docker compose run --rm app npm test -- --run --maxWorkers=1 --minWorkers=1
docker compose run --rm app npm run build:check
```

Do not install Node.js dependencies on the host. The `node_modules` directory is kept in a Docker-managed named volume.

## Stop the Environment

```bash
docker compose down
```

## Reset Docker-Managed Dependencies

```bash
docker compose down -v
docker compose up --build
```

## Troubleshooting

- If port `5173` is already in use, stop the process using it or change the host port in `compose.yaml`.
- If edits do not refresh the browser, verify Docker is allowed to access the repository directory, then restart with `docker compose down` followed by `docker compose up`.
- If Docker reports a permission error on Linux, ensure the current account can run Docker commands.
