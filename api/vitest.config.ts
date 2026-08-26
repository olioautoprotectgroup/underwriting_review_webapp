import { defineConfig } from "vitest/config";

export default defineConfig({
  // Without this, Vite walks up the directory tree looking for a PostCSS
  // config and finds the repo root's postcss.config.js (Tailwind, for the
  // frontend) — which requires tailwindcss, a package this api/ workspace
  // never installs. An empty inline config stops that lookup; this package
  // has no CSS to process anyway.
  css: { postcss: {} },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
