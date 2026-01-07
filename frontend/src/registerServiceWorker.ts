import pkg from "../package.json";

declare const __BUILD_ID__: string;

// Build-stable cache buster so Safari refetches the worker on deploys even if
// the hosting layer caches the script aggressively. Auto-generated per build;
// no env vars required. Falls back to package version only if the injected
// build id is missing (should not happen in production bundles).
const SW_VERSION =
  (typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : undefined) || pkg.version;

const SERVICE_WORKER_URL = `/service-worker.js?v=${encodeURIComponent(
  SW_VERSION
)}`;

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) {
    return;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register(SERVICE_WORKER_URL, { updateViaCache: "none" })
        .then((registration) => {
          // Check for updates immediately and periodically
          registration.update();
          setInterval(() => registration.update(), 60 * 60 * 1000); // Check every hour

          // Handle updates: when a new service worker is waiting, activate it
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (
                  newWorker.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  // New service worker is installed and waiting, activate it
                  newWorker.postMessage({ type: "SKIP_WAITING" });
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error("Service worker registration failed:", error);
        });

      // Reload page when new service worker takes control
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    });
  }
}
