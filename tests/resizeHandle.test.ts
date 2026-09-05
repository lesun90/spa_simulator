import { describe, expect, test, vi } from "vitest";
import type { InteractiveHandlers } from "../src/engine/InteractionSystem";
import { ResizeHandle } from "../src/features/hud/kit/ResizeHandle";

describe("ResizeHandle", () => {
  test("sets the resize cursor and reports drag deltas", () => {
    let handlers = {} as InteractiveHandlers;
    const interaction = {
      register: (_root: unknown, nextHandlers: InteractiveHandlers) => {
        handlers = nextHandlers;
        return vi.fn();
      }
    };
    const setCursor = vi.fn();
    const onDragStart = vi.fn();
    const onDrag = vi.fn();
    const onDragEnd = vi.fn();

    const handle = new ResizeHandle(
      { x: 10, y: 20, width: 4, height: 100 },
      interaction as never,
      { axis: "horizontal", setCursor, onDragStart, onDrag, onDragEnd }
    );

    handlers?.onHover?.();
    handlers?.onPointerDown?.({ x: 14, y: 30 } as never);
    handlers?.onPointerMove?.({ x: 44, y: 30, buttons: 1 } as never);
    handlers?.onPointerUp?.({ x: 44, y: 30 } as never);

    expect(setCursor).toHaveBeenCalledWith("ew-resize");
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledWith(30);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(setCursor).toHaveBeenLastCalledWith("");
    handle.dispose();
  });
});
