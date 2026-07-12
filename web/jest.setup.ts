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
//
// Guarded on the DOM globals existing: this setup file also runs for `@jest-
// environment node` test files (server Route Handler / guard tests), where
// MouseEvent and Element are absent — and unneeded. Skip the polyfill there
// rather than crash. jsdom is unaffected (both globals exist → runs as before).
if (
  typeof MouseEvent !== 'undefined' &&
  typeof globalThis.PointerEvent === 'undefined'
) {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}
if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

// jsdom lacks window.matchMedia; SmartLink's post-hydration capability check
// calls it inside a deferred setTimeout, which surfaces as unhandled-exception
// noise in any suite that renders establishment cards. Default stub: no match
// (links stay same-tab, as pre-hydration). Suites that test the desktop
// upgrade override window.matchMedia themselves. Guarded like the polyfills
// above so `@jest-environment node` files are untouched.
if (
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'undefined'
) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
