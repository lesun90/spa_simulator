import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import { Button } from "./Button";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { ScrollRegion } from "./ScrollRegion";
import { hudZ } from "./zIndex";

const ITEM_HEIGHT = 30;
const MAX_VISIBLE_ITEMS = 8;

/** A click-to-open floating option list, replacing the HTML <select> for the category filter. */
export class Dropdown {
  readonly root = new THREE.Group();
  private readonly toggleButton: Button;
  private readonly popupGroup = new THREE.Group();
  private popupScroll: ScrollRegion | null = null;
  private optionButtons: Button[] = [];
  private open = false;
  private rect: Rect;
  private readonly unregisterOutsideClick: () => void;

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    private options: string[],
    private value: string,
    private readonly onSelect: (value: string) => void
  ) {
    this.rect = rect;
    this.toggleButton = new Button(rect, interaction, {
      label: value,
      icon: "chevronDown",
      justify: "start",
      onClick: () => this.toggle()
    });
    this.root.add(this.toggleButton.root, this.popupGroup);
    this.popupGroup.position.z = hudZ.popover;
    this.popupGroup.visible = false;

    // Local offset relative to popupGroup (which already carries hudZ.popover) — must stay behind the
    // popup's own option buttons (local z 0) so a click on a button hits the button, not this scrim.
    const scrim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hudBasicMaterial({ visible: false }));
    scrim.position.z = -0.5;
    scrim.scale.set(100000, 100000, 1);
    this.popupGroup.add(scrim);
    this.unregisterOutsideClick = interaction.register(scrim, { onClick: () => this.close() });
  }

  setOptions(options: string[], value: string) {
    this.options = options;
    this.value = value;
    this.toggleButton.setLabel(value);
    if (this.open) this.openMenu();
  }

  private toggle() {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu() {
    this.open = true;
    this.clearMenu();

    const popup = this.popupRect();
    this.popupScroll = new ScrollRegion(popup, this.interaction, { axis: "vertical" });
    this.popupGroup.add(this.popupScroll.root);
    this.options.forEach((option, index) => {
      const itemRect: Rect = {
        x: popup.x,
        y: popup.y + index * ITEM_HEIGHT,
        width: this.rect.width,
        height: ITEM_HEIGHT
      };
      const button = new Button(itemRect, this.interaction, {
        label: option,
        justify: "start",
        onClick: () => this.select(option)
      });
      button.setActive(option === this.value);
      this.optionButtons.push(button);
      this.popupScroll?.content.add(button.root);
    });
    this.popupScroll.setContentSize(this.options.length * ITEM_HEIGHT);
    this.popupScroll.applyClipping();
    this.popupGroup.visible = true;
  }

  private popupRect(): Rect {
    const totalHeight = this.options.length * ITEM_HEIGHT;
    const height = Math.min(totalHeight, ITEM_HEIGHT * MAX_VISIBLE_ITEMS);
    const viewportHeight = typeof window === "undefined" ? this.rect.y + this.rect.height + height : window.innerHeight;
    const spaceBelow = Math.max(viewportHeight - (this.rect.y + this.rect.height), 0);
    const spaceAbove = Math.max(this.rect.y, 0);
    const opensBelow = spaceBelow >= height || spaceBelow >= spaceAbove;
    return {
      x: this.rect.x,
      y: opensBelow ? this.rect.y + this.rect.height : Math.max(this.rect.y - height, 0),
      width: this.rect.width,
      height
    };
  }

  private select(option: string) {
    this.value = option;
    this.toggleButton.setLabel(option);
    this.close();
    this.onSelect(option);
  }

  private close() {
    this.open = false;
    this.popupGroup.visible = false;
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.toggleButton.setRect(rect);
    if (this.open) this.openMenu();
  }

  dispose() {
    this.unregisterOutsideClick();
    this.toggleButton.dispose();
    this.clearMenu();
  }

  private clearMenu() {
    for (const button of this.optionButtons) button.dispose();
    this.optionButtons = [];
    if (this.popupScroll) {
      this.popupGroup.remove(this.popupScroll.root);
      this.popupScroll.dispose();
      this.popupScroll = null;
    }
  }
}
