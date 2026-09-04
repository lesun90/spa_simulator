import { describe, expect, test } from "vitest";
import { parseAssetViewerParams, viewDirectionForAngle } from "../src/asset-viewer/viewerParams";

describe("asset viewer params", () => {
  test("parses agent-friendly query parameters with stable defaults", () => {
    const params = parseAssetViewerParams("?asset=props.cone&angle=side&grid=0&spin=1&debug=true&ui=0");

    expect(params).toEqual({
      assetId: "props.cone",
      angle: "side",
      grid: false,
      spin: true,
      debug: true,
      ui: false
    });
  });

  test("falls back to inspection defaults for unsupported values", () => {
    const params = parseAssetViewerParams("?asset=%20&angle=diagonal&grid=nope&spin=yes&debug=1");

    expect(params).toEqual({
      assetId: null,
      angle: "iso",
      grid: true,
      spin: false,
      debug: true,
      ui: true
    });
  });

  test("maps named angles to deterministic camera directions", () => {
    expect(viewDirectionForAngle("front")).toEqual([0, 0.45, 1]);
    expect(viewDirectionForAngle("side")).toEqual([1, 0.45, 0]);
    expect(viewDirectionForAngle("top")).toEqual([0, 1, 0.001]);
    expect(viewDirectionForAngle("iso")).toEqual([1, 0.75, 1]);
  });
});
