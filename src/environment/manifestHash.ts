import { createHash } from "node:crypto";

/** Node adapter for package content hashing; manifest normalization remains platform-neutral. */
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
