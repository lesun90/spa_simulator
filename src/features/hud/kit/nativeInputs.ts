import type { Rect } from "./layout";

/**
 * The HUD draws everything on canvas, but a color swatch and a file picker have no in-canvas
 * equivalent worth building — these bridge to the browser's native dialogs instead, via a hidden
 * <input> reused across calls. The only place this app touches the DOM outside of the canvas.
 */

let colorInput: HTMLInputElement | null = null;
let fileInput: HTMLInputElement | null = null;

function hiddenInput(type: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.appendChild(input);
  return input;
}

/**
 * Sizes and positions `input` over `anchor` (in canvas-local pixel coordinates, the HUD kit's own
 * `Rect` space) so the browser anchors its native popup — the color wheel, the file dialog's implied
 * origin — at the control the user actually clicked, not at the page's top-left corner.
 */
function positionOverAnchor(input: HTMLInputElement, anchor: Rect) {
  const canvasRect = document.querySelector("canvas")?.getBoundingClientRect();
  const left = (canvasRect?.left ?? 0) + anchor.x;
  const top = (canvasRect?.top ?? 0) + anchor.y;
  input.style.left = `${left}px`;
  input.style.top = `${top}px`;
  input.style.width = `${anchor.width}px`;
  input.style.height = `${anchor.height}px`;
}

/**
 * Opens the native color picker anchored over `anchor`, seeded with `initial`. Resolves the final
 * hex color (or null if cancelled); `onChange`, if given, fires live on every drag tick inside the
 * picker so callers can preview the color before the user commits it.
 */
export function pickColor(initial: string, anchor: Rect, onChange?: (color: string) => void): Promise<string | null> {
  if (!colorInput) colorInput = hiddenInput("color");
  const input = colorInput;
  input.value = initial;
  positionOverAnchor(input, anchor);

  return new Promise((resolve) => {
    const cleanup = () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("change", onCommit);
      input.removeEventListener("cancel", onCancel);
    };
    const onInput = () => onChange?.(input.value);
    const onCommit = () => {
      cleanup();
      resolve(input.value);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    input.addEventListener("input", onInput);
    input.addEventListener("change", onCommit, { once: true });
    input.addEventListener("cancel", onCancel, { once: true });
    input.click();
  });
}

export interface PickedImage {
  name: string;
  dataUrl: string;
}

/** Opens the native file picker restricted to images; resolves a data URL, or null if cancelled/unreadable. */
export function pickImageFile(): Promise<PickedImage | null> {
  if (!fileInput) fileInput = hiddenInput("file");
  const input = fileInput;
  input.accept = "image/*";
  input.value = "";

  return new Promise((resolve) => {
    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
    };
    const onChange = () => {
      cleanup();
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    input.addEventListener("change", onChange, { once: true });
    input.addEventListener("cancel", onCancel, { once: true });
    input.click();
  });
}
