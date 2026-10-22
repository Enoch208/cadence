import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "web",
          root: "apps/web",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "core",
          root: "packages/core",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
