// Vitest setup — jsdom polyfills and global test configuration

// document.execCommand is not available in jsdom but is used as a
// clipboard fallback in some components. Provide a no-op polyfill.
if (typeof document !== "undefined" && typeof document.execCommand !== "function") {
  Object.defineProperty(document, "execCommand", {
    value: () => true,
    writable: true,
    configurable: true,
  });
}

// Import jest-dom matchers (toBeInTheDocument, etc.)
import "@testing-library/jest-dom/vitest";
