# Steerlab

## Prerequisites

Install Docker Engine and Docker Compose. Node.js and project dependencies do not need to be installed on the host machine.

## Start the Development Environment

```bash
docker compose up
```

Open http://localhost:5173/scene_studio. The root URL redirects to Scene Studio.

Edit files in this repository. The development server recompiles the application and refreshes the browser automatically.

Verify the running container is this project:

```bash
curl http://localhost:5173/api/health
```

Expected response:

```json
{"app":"steerlab","phase":"phase-1-scene-editor"}
```

## Scene Studio

Scene Studio opens at http://localhost:5173/scene_studio and provides:

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

## Scenario Studio

Scenario Studio is available at http://localhost:5173/scenario_studio. It opens with a 100 m green ground and a browser of published scene packages from `assets/scenes`. Search by scene name or package key, select a card, then use **Use Scene** and confirm with **Switch Scene** to load its actual geometry. Refresh discovers newly added packages. Invalid packages stay visible with a diagnostic; a failed load leaves the current scene in place.

To review the built client without changing the development server, run inside the Compose app container:

```bash
docker compose exec -T app npm run review:build
docker compose exec -T app npm run review:serve
```

The review server listens on port 4173 inside the container. Map that port to an available host port if you need to open it from a host browser. The preview server uses the same Scenario Studio scene catalog and read-only source routes as development.

Finished behavior, future architecture, remaining milestones, and review commands are maintained in the single [Scenario Studio document](docs/scenario-studio-design.md).

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


update scene design (generator)
- use tile 150 for 3 way intersection (dont use tile 027)
- use tile 141 for 4 way intersection (dont use tile 034)
- in addition to high bridge, also use tile 187 and 188 for low bride over water
- use tile 049 043 039 to add roundabout, support 1 way, 2 way , 3 way, 4 way roundabout. 
- use tile 231 to create mountain pass.
