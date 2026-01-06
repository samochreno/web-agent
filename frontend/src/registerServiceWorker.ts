const SERVICE_WORKER_URL = "/service-worker.js";

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) {
    return;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register(SERVICE_WORKER_URL)
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
