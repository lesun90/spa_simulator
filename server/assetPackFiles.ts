import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { validatePackShape } from "../src/wfc/metadata/packShape";
import type { WfcPackDeclaration } from "../src/wfc/metadata/packTypes";

/** A discovery invocation owns its cache; the nearest pack directory supplies inherited metadata. */
export class AssetPackFiles {
  private readonly root: string;
  private readonly declarations = new Map<string, Promise<WfcPackDeclaration | undefined>>();

  constructor(assetRoot: string) { this.root = resolve(assetRoot); }

  forFolder(folder: string): Promise<WfcPackDeclaration | undefined> {
    const directory = resolve(folder);
    let declaration = this.declarations.get(directory);
    if (!declaration) {
      declaration = this.read(directory);
      this.declarations.set(directory, declaration);
    }
    return declaration;
  }

  private async read(directory: string): Promise<WfcPackDeclaration | undefined> {
    const path = join(directory, "wfc-pack.json");
    try {
      const declaration: unknown = JSON.parse(await readFile(path, "utf8"));
      validatePackShape(declaration);
      return declaration;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Invalid WFC pack declaration ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return directory === this.root ? undefined : this.forFolder(dirname(directory));
    }
  }
}
