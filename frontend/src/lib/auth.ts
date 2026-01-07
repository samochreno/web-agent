import { Browser } from "@capacitor/browser";
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { isNativePlatform, getApiBaseUrl } from "./config";

// Custom URL scheme for the app (must match Info.plist CFBundleURLSchemes)
export const APP_URL_SCHEME = "luna";

/**
 * Get the OAuth redirect URI for the current platform.
 * - On web: Uses the backend's default (derived from request)
 * - On native: Uses the backend URL + callback path (Google will redirect there,
 *   then backend redirects to our custom URL scheme)
 */
export function getOAuthRedirectUri(): string | undefined {
  if (isNativePlatform()) {
    // For native, we need the backend to redirect back to our app via custom URL scheme
    // But Google OAuth doesn't support custom schemes directly, so we use the backend callback
    // and have it redirect to our custom scheme after processing
    const apiBase = getApiBaseUrl();
    return apiBase ? `${apiBase}/api/google/callback` : undefined;
  }
  // On web, let the backend derive the redirect URI from the request
  return undefined;
}

/**
 * Get the native scheme if on a native platform, undefined otherwise.
 */
export function getNativeScheme(): string | undefined {
  return isNativePlatform() ? APP_URL_SCHEME : undefined;
}

/**
 * Opens a URL for OAuth authentication.
 * - On web: Uses window.location.href (same-origin redirect)
 * - On native: Opens in system browser (required for OAuth)
 */
export async function openAuthUrl(url: string): Promise<void> {
  if (isNativePlatform()) {
    // On native, open OAuth in system browser
    // The callback will be handled via deep link (URL scheme)
    await Browser.open({ url });
  } else {
    // On web, just redirect
    window.location.href = url;
  }
}

/**
 * Listen for OAuth callback deep links on native platforms.
 * Returns a cleanup function to remove the listener.
 *
 * @param callback - Function to call when OAuth callback is received (success: boolean)
 * @returns Cleanup function
 */
export function listenForOAuthCallback(
  callback: (success: boolean) => void
): () => void {
  if (!isNativePlatform()) {
    // On web, no deep link listener needed
    return () => {};
  }

  const handler = async (event: URLOpenListenerEvent) => {
    const url = new URL(event.url);

    // Check if this is an OAuth callback from our custom scheme
    // URL format: luna://oauth/callback?success=true
    if (url.protocol === `${APP_URL_SCHEME}:` && url.pathname.includes("oauth/callback")) {
      // Close the browser
      await Browser.close();

      // Check if OAuth was successful
      const success = url.searchParams.get("success") === "true";
      callback(success);
    }
  };

  // Add listener
  void App.addListener("appUrlOpen", handler);

  // Return cleanup function
  return () => {
    void App.removeAllListeners();
  };
}
