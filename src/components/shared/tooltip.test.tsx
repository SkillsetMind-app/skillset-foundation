import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tooltip } from "@/components/shared/tooltip";

let anchor = new DOMRect(280, 180, 32, 32);
let bubble = new DOMRect(0, 0, 240, 100);
let onResize: ResizeObserverCallback;
const disconnect = vi.fn();

beforeEach(() => {
  anchor = new DOMRect(280, 180, 32, 32);
  bubble = new DOMRect(0, 0, 240, 100);
  vi.stubGlobal("innerWidth", 320);
  vi.stubGlobal("innerHeight", 400);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { onResize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  disconnect.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "tooltip" ? bubble : anchor;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Tooltip shared by lesson media and pricing", () => {
  it("describes the native trigger and consumes only the Escape that dismisses its help", () => {
    const outerEscape = vi.fn();
    const click = vi.fn();
    render(<div onKeyDown={outerEscape}>
      <span id="existing-description">Existing detail.</span>
      <Tooltip content="Additional help."><button aria-describedby="existing-description" onClick={click}>Help</button></Tooltip>
    </div>);
    const trigger = screen.getByRole("button", { name: "Help" });
    act(() => trigger.focus());
    const tooltip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", `existing-description ${tooltip.id}`);
    expect(trigger).toHaveAccessibleDescription("Existing detail. Additional help.");
    fireEvent.click(trigger);
    expect(click).toHaveBeenCalledOnce();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-describedby", "existing-description");
    expect(outerEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(outerEscape).toHaveBeenCalledOnce();
  });

  it.each(["top", "bottom"] as const)("portals outside clipping parents and keeps the %s preference inside the viewport", (side) => {
    const { container } = render(<div style={{ overflow: "hidden" }}>
      <Tooltip content="Long help." side={side}><button>Help</button></Tooltip>
    </div>);
    fireEvent.focus(screen.getByRole("button"));
    const tooltip = screen.getByRole("tooltip");
    expect(container).not.toContainElement(tooltip);
    expect(document.body).toContainElement(tooltip);
    expect(tooltip.style.position).toBe("fixed");
    expect(Number.parseFloat(tooltip.style.left)).toBe(72);
    expect(Number.parseFloat(tooltip.style.top)).toBe(side === "top" ? 72 : 220);
  });

  it("dismisses hover-only help before an outer Escape handler while focus stays elsewhere", () => {
    const outerEscape = vi.fn();
    render(<div onKeyDown={outerEscape}>
      <input aria-label="Other field" />
      <Tooltip content="Hover help."><button>Help</button></Tooltip>
    </div>);
    const input = screen.getByRole("textbox");
    act(() => input.focus());
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(outerEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(outerEscape).toHaveBeenCalledOnce();
  });

  it.each(["top", "bottom"] as const)("flips %s when its edge has no room", (side) => {
    anchor = new DOMRect(4, side === "top" ? 4 : 364, 32, 32);
    render(<Tooltip content="Help." side={side}><button>Help</button></Tooltip>);
    fireEvent.focus(screen.getByRole("button"));
    const tooltip = screen.getByRole("tooltip");
    expect(Number.parseFloat(tooltip.style.left)).toBe(8);
    expect(Number.parseFloat(tooltip.style.top)).toBe(side === "top" ? 44 : 256);
  });

  it("repositions after ancestor scroll, viewport resize and content resize, then removes observers", () => {
    const { container, unmount } = render(<div data-testid="scroll-container">
      <Tooltip content="Help."><button>Help</button></Tooltip>
    </div>);
    fireEvent.focus(screen.getByRole("button"));
    const tooltip = screen.getByRole("tooltip");
    anchor = new DOMRect(30, 230, 32, 32);
    fireEvent.scroll(screen.getByTestId("scroll-container"));
    expect(Number.parseFloat(tooltip.style.left)).toBe(8);
    expect(Number.parseFloat(tooltip.style.top)).toBe(122);
    anchor = new DOMRect(280, 230, 32, 32);
    vi.stubGlobal("innerWidth", 400);
    fireEvent.resize(window);
    expect(Number.parseFloat(tooltip.style.left)).toBe(152);
    bubble = new DOMRect(0, 0, 240, 140);
    act(() => onResize([], {} as ResizeObserver));
    expect(Number.parseFloat(tooltip.style.top)).toBe(82);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockClear();
    fireEvent.scroll(container);
    fireEvent.resize(window);
    expect(HTMLElement.prototype.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it("keeps help while the pointer moves into it or its trigger remains focused, and closes on blur or tap-out", () => {
    vi.useFakeTimers();
    render(<Tooltip content="Hoverable help."><button>Help</button></Tooltip>);
    const trigger = screen.getByRole("button");
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(screen.getByRole("tooltip"));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("tooltip"));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => trigger.focus());
    fireEvent.mouseLeave(trigger);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => trigger.blur());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("limits long help to the visual viewport and follows its native resize/scroll events", () => {
    const viewport = Object.assign(new EventTarget(), { width: 200, height: 180, offsetLeft: 10, offsetTop: 20 });
    vi.stubGlobal("visualViewport", viewport);
    bubble = new DOMRect(0, 0, 184, 164);
    anchor = new DOMRect(180, 110, 20, 20);
    render(<Tooltip content="Long help."><button>Help</button></Tooltip>);
    fireEvent.focus(screen.getByRole("button"));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.style.maxWidth).toBe("184px");
    expect(tooltip.firstElementChild).toHaveStyle({ maxHeight: "164px" });
    expect(Number.parseFloat(tooltip.style.left)).toBe(18);
    expect(Number.parseFloat(tooltip.style.top)).toBe(28);
    viewport.offsetLeft = 30;
    act(() => { viewport.dispatchEvent(new Event("scroll")); });
    expect(Number.parseFloat(tooltip.style.left)).toBe(38);
    viewport.height = 220;
    act(() => { viewport.dispatchEvent(new Event("resize")); });
    expect(tooltip.firstElementChild).toHaveStyle({ maxHeight: "204px" });
  });
});
