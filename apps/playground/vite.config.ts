import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Starts the playground's collaboration server (see `server/collab-server.ts`) on the dev server's own port. Restart
 * the dev server after changing the server's code.
 */
function collabServer(): Plugin {
  return {
    name: "pli-collab-server",
    async configureServer(server) {
      if (!server.httpServer) return;
      const { attachCollabServer } = (await server.ssrLoadModule("/server/collab-server.ts")) as typeof import("./server/collab-server");
      attachCollabServer(server.httpServer);
    },
  };
}

export default defineConfig({
  plugins: [react(), collabServer()],
  server: { port: 5180, strictPort: true },
});
