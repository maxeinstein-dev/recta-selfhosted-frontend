import type { CapacitorConfig } from '@capacitor/cli';

// The web build (dist/) is embedded in the APK. The WebView origin is https://localhost, which the API's CORS accepts.
const config: CapacitorConfig = {
  appId: 'dev.maxsueleinstein.recta',
  appName: 'Recta',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
