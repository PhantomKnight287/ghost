import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  // tanstackStart must come before react(). SPA mode prerenders the shell the
  // Dockerfile serves statically, since every page renders in the browser.
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
});
