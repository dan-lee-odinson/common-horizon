// Where an element sits inside an ancestor, from layout alone: transforms (an entrance, a sliding
// drawer) do not count. Used to measure the part of the window the panels leave
// free for the scene.

export interface LayoutBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function layoutBox(el: HTMLElement, root: HTMLElement): LayoutBox {
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = el; node && node !== root; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
}
