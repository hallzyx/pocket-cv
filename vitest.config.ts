import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    testTimeout: 60_000,
    setupFiles: ["./vitest-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    env: {
      // Integration tests use pocketcv_test on the local MariaDB instance.
      // Never change this to point at the development database.
      POCKETCV_DATABASE_URL: "mysql://root:@localhost:33065/pocketcv_test",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
