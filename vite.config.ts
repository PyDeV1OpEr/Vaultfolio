import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    // Never scan Tauri build output — a stray DMG staging folder once made
    // vitest import other applications' test suites and report false failures.
    exclude: [
      'node_modules/**',
      'dist/**',
      'dist-desktop/**',
      'src-tauri/target/**',
    ],
  },
});
