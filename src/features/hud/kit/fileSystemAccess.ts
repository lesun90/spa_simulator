interface WritableFileStream {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<WritableFileStream>;
  getFile(): Promise<File>;
}
interface FileSystemDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
}

/** Writes both fixed-name package files into a user-picked directory, or triggers two plain downloads when the File System Access API isn't available. */
export async function saveEnvironmentPackage(manifestJson: string, glb: Uint8Array<ArrayBuffer>): Promise<void> {
  const picker = (window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike> }).showDirectoryPicker;
  if (picker) {
    const directory = await picker();
    await writeFileInDirectory(directory, "environment.json", manifestJson);
    await writeFileInDirectory(directory, "environment.glb", glb);
    return;
  }
  downloadFile("environment.json", new Blob([manifestJson], { type: "application/json" }));
  downloadFile("environment.glb", new Blob([glb], { type: "model/gltf-binary" }));
}

async function writeFileInDirectory(directory: FileSystemDirectoryHandleLike, name: string, data: BlobPart): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
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
