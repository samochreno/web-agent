import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.samochreno.luna",
  appName: "Luna",
  webDir: "frontend/dist",
  // Server configuration for native builds
  server: {
    // Allow CORS requests to your backend
    androidScheme: "https",
    // During development, you can point to your local dev server:
    // url: "http://192.168.x.x:3000",
    // cleartext: true,
  },
  plugins: {
    // Enable native HTTP to bypass CORS on mobile
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorCookies: {
      enabled: true,
    },
  },
  ios: {
    contentInset: "automatic",
    // Enable debugging in dev builds
    webContentsDebuggingEnabled: true,
  },
  android: {
    // Enable debugging in dev builds
    webContentsDebuggingEnabled: true,
    // Allow mixed content for development
    allowMixedContent: false,
  },
};

export default config;
