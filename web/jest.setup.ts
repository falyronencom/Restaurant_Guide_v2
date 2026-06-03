// Registers @testing-library/jest-dom custom matchers (toBeInTheDocument,
// toHaveTextContent, …) for every test. Per jest.md: extend-expect was folded
// into the root import in jest-dom v6.
import '@testing-library/jest-dom';

// jsdom lacks ResizeObserver, which @base-ui/react layout primitives (e.g.
// Accordion panel height measurement) observe at mount. Provide a no-op so
// component tests that render those primitives don't crash.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom also lacks PointerEvent + the pointer-capture methods that @base-ui
// controls (and @testing-library/user-event's pointer simulation) reach for.
// Without these, userEvent.click on a base-ui checkbox/button throws
// "PointerEvent is not a constructor". Polyfill the minimum.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
