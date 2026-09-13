import { defineConfig } from "vite";

// Plain single-page app. The mock backend (or the real Coordinator) runs
// separately on :8080 and the browser talks to it directly over WS + HTTP,
// so no dev proxy is needed.
export default defineConfig({
  server: { port: 5173, host: true, open: false },
  build: { target: "es2020", outDir: "dist" },
});
