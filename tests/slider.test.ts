import { describe, expect, test, vi } from "vitest";
import type { InteractiveHandlers } from "../src/engine/InteractionSystem";
import { Slider, sliderFillRatio, sliderValueFromPointer } from "../src/features/hud/kit/Slider";

describe("slider math", () => {
  test("maps values to clamped track fill ratios", () => {
    expect(sliderFillRatio(0.5, 0.5, 3)).toBe(0);
    expect(sliderFillRatio(1.75, 0.5, 3)).toBe(0.5);
    expect(sliderFillRatio(4, 0.5, 3)).toBe(1);
  });

  test("maps horizontal pointer positions to clamped values", () => {
    const rect = { x: 20, y: 10, width: 200, height: 28 };

    expect(sliderValueFromPointer(rect, 20, 0.5, 3)).toBe(0.5);
    expect(sliderValueFromPointer(rect, 120, 0.5, 3)).toBe(1.75);
    expect(sliderValueFromPointer(rect, 260, 0.5, 3)).toBe(3);
  });

  test("reports drag lifecycle so callers can pause world controls", () => {
    let handlers = {} as InteractiveHandlers;
    const interaction = {
      register: (_root: unknown, nextHandlers: InteractiveHandlers) => {
        handlers = nextHandlers;
        return vi.fn();
      }
    };
    const onDragStart = vi.fn();
    const onChange = vi.fn();
    const onDragEnd = vi.fn();

    const slider = new Slider(
      { x: 20, y: 10, width: 200, height: 28 },
      interaction as never,
      { min: 0.5, max: 3, onChange, onDragStart, onDragEnd },
      1
    );

    handlers.onPointerDown?.({ x: 120, buttons: 1 } as never);
    handlers.onPointerMove?.({ x: 180, buttons: 1 } as never);
    handlers.onPointerUp?.({ x: 180, buttons: 0 } as never);

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(2.5);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    slider.dispose();
  });

  test("can switch ranges and clamps the current value into the new range", () => {
    const interaction = {
      register: () => vi.fn()
    };
    const onChange = vi.fn();
    const slider = new Slider(
      { x: 20, y: 10, width: 200, height: 28 },
      interaction as never,
      { min: 0.05, max: 3, onChange },
      2
    );

    slider.setRange(0.5, 8);
    slider.setValue(7, true);

    expect(onChange).toHaveBeenLastCalledWith(7);
    slider.dispose();
  });
});
