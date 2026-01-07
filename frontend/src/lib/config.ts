import { Capacitor } from "@capacitor/core";

/**
 * Returns the base URL for API requests.
 *
 * - On web (dev/prod), we use relative paths so the Vite proxy or server handles routing.
 * - On native (Capacitor), we need an absolute URL to the hosted backend.
 *
 * Set VITE_API_BASE_URL in your .env file to the production backend URL
 * (e.g., https://your-backend.example.com) for native builds.
 *
 * For local development with native:
 * - Run the backend on your machine
 * - Set VITE_API_BASE_URL to your machine's local IP (e.g., http://192.168.1.100:8000)
 * - The simulator/device must be on the same network
 */
export function getApiBaseUrl(): string {
  // On native platforms, always use the configured backend URL
  if (Capacitor.isNativePlatform()) {
    const backendUrl = import.meta.env.VITE_API_BASE_URL;
    if (!backendUrl) {
      console.warn(
        "VITE_API_BASE_URL is not set. Native API calls will fail. " +
          "Set this to your backend URL (e.g., https://api.example.com or http://192.168.x.x:8000 for local dev)"
      );
      // Return empty string - API calls will fail but with a clear error
      return "";
    }
    return backendUrl.replace(/\/$/, ""); // Remove trailing slash
  }

  // On web, use relative paths (works with Vite proxy in dev, same-origin in prod)
  return "";
}

/**
 * Check if we're running on a native Capacitor platform
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Get the current platform
 */
export function getPlatform(): "ios" | "android" | "web" {
  return Capacitor.getPlatform() as "ios" | "android" | "web";
}
