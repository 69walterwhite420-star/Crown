import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Юнит-тесты — на чистой логике (движок репутации и т.п.), окружение node, без браузера.
// Алиас @/ → src, как в tsconfig, чтобы тесты могли импортировать так же, как приложение.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
