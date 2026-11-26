import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5173 }, // host: true so a phone on the same Wi-Fi can open it
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 700, // the Firebase SDK chunk is ~550 kB (165 kB gzipped) on its own
    rollupOptions: {
      output: { manualChunks: { firebase: ["firebase/app", "firebase/auth", "firebase/firestore"] } },
    },
  },
  test: { include: ["tests/**/*.test.js"], testTimeout: 20000 },
});
