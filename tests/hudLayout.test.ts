import { computeShellLayout } from "../src/features/hud/kit/layout";
import { shellLayout } from "../src/app/config";

test("wide layout keeps the viewport, asset browser, and left panel", () => {
  const layout = computeShellLayout(1400, 900);

  expect(layout.narrow).toBe(false);
  expect(layout.leftPanel).toEqual({ x: 0, y: 0, width: shellLayout.leftPanelWidth, height: 900 - shellLayout.assetBrowserHeight });
  expect(layout.viewport).toEqual({
    x: shellLayout.leftPanelWidth,
    y: 0,
    width: 1400 - shellLayout.leftPanelWidth,
    height: 900 - shellLayout.assetBrowserHeight
  });
  expect(layout.assetBrowser.height).toBe(shellLayout.assetBrowserHeight);
  expect(layout.assetBrowser.y + layout.assetBrowser.height).toBe(900);
  expect(layout.assetBrowser.x).toBe(0);
  expect(layout.assetBrowser.width).toBe(1400);
});

test("wide layout lets the viewport reclaim hidden asset browser height", () => {
  const visible = computeShellLayout(1400, 900);
  const hidden = computeShellLayout(1400, 900, { assetBrowserHidden: true });

  expect(hidden.assetBrowser.height).toBe(0);
  expect(hidden.assetBrowser.y).toBe(900);
  expect(hidden.viewport.height).toBe(visible.viewport.height + visible.assetBrowser.height);
  expect(hidden.viewport).toEqual({ x: shellLayout.leftPanelWidth, y: 0, width: 1400 - shellLayout.leftPanelWidth, height: 900 });
});

test("wide layout lets the viewport reclaim a hidden left panel", () => {
  const visible = computeShellLayout(1400, 900);
  const hidden = computeShellLayout(1400, 900, { leftPanelHidden: true });

  expect(hidden.leftPanel.width).toBe(0);
  expect(hidden.viewport).toEqual({ x: 0, y: 0, width: 1400, height: visible.viewport.height });
});

test("narrow layout keeps the viewport, asset browser, and left panel", () => {
  const layout = computeShellLayout(700, 1000);

  expect(layout.narrow).toBe(true);
  expect(layout.leftPanel).toEqual({ x: 0, y: 0, width: shellLayout.leftPanelWidth, height: 1000 - shellLayout.narrowAssetBrowserHeight });
  expect(layout.viewport).toEqual({
    x: shellLayout.leftPanelWidth,
    y: 0,
    width: 700 - shellLayout.leftPanelWidth,
    height: 1000 - shellLayout.narrowAssetBrowserHeight
  });
  expect(layout.assetBrowser.x).toBe(0);
  expect(layout.assetBrowser.width).toBe(700);
  expect(layout.assetBrowser.y + layout.assetBrowser.height).toBe(1000);
});

test("narrow layout lets the viewport reclaim hidden asset browser height", () => {
  const visible = computeShellLayout(700, 1000);
  const hidden = computeShellLayout(700, 1000, { assetBrowserHidden: true });

  expect(hidden.assetBrowser.height).toBe(0);
  expect(hidden.assetBrowser.y).toBe(1000);
  expect(hidden.viewport.height).toBe(visible.viewport.height + visible.assetBrowser.height);
  expect(hidden.viewport).toEqual({ x: shellLayout.leftPanelWidth, y: 0, width: 700 - shellLayout.leftPanelWidth, height: 1000 });
});
