import { buildAssetTable } from "./assetTable";
import { assignChunks } from "./chunking";
import { EnvironmentCompiler } from "./environmentCompiler";
import { compileEnvironmentGeometry } from "./environmentGeometryAdapter";
import { sha256Hex } from "./manifestHash";
import { encodeManifest } from "./manifestEncoder";
import { buildManifestRecords } from "./manifestBuilder";
import { buildNavigationGraph } from "./navigationGraph";

/** Node composition root for environment package compilation. */
export const environmentCompiler = new EnvironmentCompiler({ assignChunks, compileGeometry: compileEnvironmentGeometry, buildAssetTable, buildManifestRecords, buildNavigation: buildNavigationGraph, encodeManifest, hash: sha256Hex, now: () => Date.now() });
