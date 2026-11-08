import { defineConfig } from "vitest/config";
import { readFileSync, existsSync } from "node:fs";

// Office add-ins must be served over HTTPS. Provide local dev certs at certs/ (see README).
const https =
  existsSync("certs/localhost.key") && existsSync("certs/localhost.crt")
    ? { key: readFileSync("certs/localhost.key"), cert: readFileSync("certs/localhost.crt") }
    : undefined;

export default defineConfig({
  define:{__APP_BUILD__:JSON.stringify(process.env.GITHUB_SHA?.slice(0,8)??'local')},
  root: "src/taskpane",
  base: "./",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { port: 3000, https },
  test: { root: ".", include: ["tests/**/*.test.ts"], environment: "jsdom" },
});
