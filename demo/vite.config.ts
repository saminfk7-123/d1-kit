import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiPlugin } from "./server/plugin.ts";

export default defineConfig({
  plugins: [react(), apiPlugin()],
});
