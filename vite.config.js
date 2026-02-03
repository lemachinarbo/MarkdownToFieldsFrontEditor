import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/editor.js",
      name: "MarkdownFrontEditor",
      formats: ["iife"],
      fileName: () => "editor.bundle.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: false, // Keep readable for debugging
    sourcemap: true,
    rollupOptions: {
      output: {
        // Ensure everything is bundled into one file
        inlineDynamicImports: true,
      },
    },
  },
});
