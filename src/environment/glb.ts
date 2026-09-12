const GLB_MAGIC = 0x46546c67; // "glTF", little-endian
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON", little-endian

export interface GlbInfo {
  valid: boolean;
  nodeNames?: readonly string[];
  error?: string;
}

/** Reads only the GLB header and JSON chunk — enough to validate identity and node names without a full glTF parser. */
export function readGlbInfo(bytes: Uint8Array): GlbInfo {
  if (bytes.length < 20) return { valid: false, error: "GLB is smaller than a valid header." };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return { valid: false, error: "GLB magic bytes are missing." };

  const totalLength = view.getUint32(8, true);
  if (totalLength !== bytes.length) return { valid: false, error: "GLB header length does not match the file size." };

  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== JSON_CHUNK_TYPE) return { valid: false, error: "GLB does not start with a JSON chunk." };
  if (20 + chunkLength > bytes.length) return { valid: false, error: "GLB chunk length exceeds file size." };

  let json: { nodes?: { name?: string }[] };
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength)));
  } catch {
    return { valid: false, error: "GLB JSON chunk is not valid JSON." };
  }

  const nodeNames = (json.nodes ?? []).map((node) => node.name).filter((name): name is string => typeof name === "string");
  return { valid: true, nodeNames };
}
