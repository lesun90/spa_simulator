import { strToU8, zip } from "fflate";

interface FileSystemFileHandleLike {
  getFile(): Promise<File>;
}

/** Compresses the fixed package files and downloads one archive named after the scene. */
export async function saveEnvironmentPackage(sceneName: string, manifestJson: string, glb: Uint8Array): Promise<void> {
  const archive = await createEnvironmentArchive(manifestJson, glb);
  downloadFile(`${safeArchiveName(sceneName)}.zip`, new Blob([Uint8Array.from(archive)], { type: "application/zip" }));
}

function createEnvironmentArchive(manifestJson: string, glb: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip({ "environment.json": strToU8(manifestJson), "environment.glb": glb }, (error, archive) => {
      if (error) reject(error);
      else resolve(archive);
    });
  });
}

function safeArchiveName(sceneName: string): string {
  return sceneName.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/g, "") || "environment";
}

function downloadFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Opens a native picker for the two fixed package files; resolves null if the user cancels. */
export async function pickEnvironmentPackageFiles(): Promise<{ manifestJson: string; glb: Uint8Array } | null> {
  const picker = (window as {
    showOpenFilePicker?: (options: { multiple: boolean; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandleLike[]>;
  }).showOpenFilePicker;
  if (!picker) return pickFilesViaInput();

  try {
    const handles = await picker({
      multiple: true,
      types: [{ description: "Environment package", accept: { "application/json": [".json"], "model/gltf-binary": [".glb"] } }]
    });
    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    return await readPackageFromFiles(files);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

function pickFilesViaInput(): Promise<{ manifestJson: string; glb: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,.glb";
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);

    const cleanup = () => document.body.removeChild(input);
    input.addEventListener(
      "change",
      async () => {
        const files = input.files ? [...input.files] : [];
        cleanup();
        resolve(files.length ? await readPackageFromFiles(files) : null);
      },
      { once: true }
    );
    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    }, { once: true });
    input.click();
  });
}

async function readPackageFromFiles(files: File[]): Promise<{ manifestJson: string; glb: Uint8Array } | null> {
  const manifestFile = files.find((file) => file.name.endsWith(".json"));
  const modelFile = files.find((file) => file.name.endsWith(".glb"));
  if (!manifestFile || !modelFile) return null;
  const manifestJson = await manifestFile.text();
  const glb = new Uint8Array(await modelFile.arrayBuffer());
  return { manifestJson, glb };
}
