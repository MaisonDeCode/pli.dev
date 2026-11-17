import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Capacitor loads the built files from the app, so paths are relative.
  base: "./",
  build: { outDir: "dist" },
  server: { port: 5190, host: true },
});
