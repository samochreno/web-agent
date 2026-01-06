const SERVICE_WORKER_URL = "/service-worker.js";

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) {
    return;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register(SERVICE_WORKER_URL)
        .catch((error) => {
          console.error("Service worker registration failed:", error);
        });
    });
  }
}
