# Scenario Studio: scene browser review

Step 1 provides the `/scenario_studio` route, a default 100 m × 100 m green ground, published-scene cards, and transactional scene replacement. Its controls use the same renderer, HUD layout, panels, tiles, buttons, scrolling, and theme as Scene Studio. Agent and playback controls arrive in later steps.

## Build and open

With the existing Compose service running, run:

```bash
docker compose exec -T app npm run build:check
docker compose exec -T app npm run review:build
docker compose exec -T app npm run review:serve
```

The last command serves the built client at `http://localhost:4173/scenario_studio` **inside the container**. For a host browser, map container port 4173 to an available host port, or use the container network address shown by Vite. Keep the development service at `http://localhost:5173/scene_studio` running. The preview middleware serves `GET /api/scenario-studio/scenes`, `GET /api/scenario-studio/scene-package/{manifest,model}`, and read-only `/scenario-assets/scenes/` and `/scenario-assets/agents/` paths without using Vite's hashed `/assets/` namespace.

## Walkthrough

1. Open `/scenario_studio`. The default green ground fills the viewport between Scene Studio-style light panels; published scene tiles appear in the bottom browser. Drag the viewport to orbit and scroll over it to zoom.
2. Select **Published environment** in the bottom browser. The viewport remains on the green ground while the left panel and Scene Inspector show the candidate. Click **Use Scene** and cancel the warning; the ground still remains. Repeat and confirm; the real scene model replaces the ground. Orbit, zoom, use Reset View, and resize the window.
3. Add a folder under `assets/scenes` containing `environment.json` and `environment.glb`; click **Refresh**. It appears with a canonical relative key. A malformed or hash-mismatched package appears disabled with a reason. Removing the fixture and refreshing removes its card.
4. Select a different valid package. Canceling replacement retains the first scene; confirming shows the second. A package with no ground mesh must show only its own geometry, with no green fallback.
5. With a scene active, change its manifest or model on disk, then use the stale card. The load reports a changed-scene error and preserves the active scene; Refresh obtains the current identity.
6. Open `/scene_studio` on the development server and check that its existing editor loads.

Review captured on 2026-09-12 with the built client served at container network URL `http://172.27.0.2:4173/scenario_studio`: initial green ground, cancel preservation, successful loading of the root published environment, and a temporary package with no ground mesh. Screenshots: [default ground](review-artifacts/scenario-studio-initial.png), [published environment](review-artifacts/scenario-studio-loaded.png), and [no-ground fixture](review-artifacts/scenario-studio-no-ground.png). The temporary review fixture was removed afterward. A headless browser checks functionality; it does not measure rendering performance.
