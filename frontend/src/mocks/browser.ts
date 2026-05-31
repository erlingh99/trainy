import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

let startPromise: Promise<unknown> | null = null;

/**
 * Starts the MSW worker once. Safe to call from multiple places — subsequent
 * calls return the same promise. No-op on the server.
 */
export function startMockWorker() {
  if (typeof window === "undefined") return Promise.resolve();
  if (!startPromise) {
    startPromise = worker.start({
      onUnhandledRequest: "bypass",
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  }
  return startPromise;
}
