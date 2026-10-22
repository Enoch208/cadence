import { defineConfig } from "vitest/config";

const testDatabase = "postgres://cadence:cadence@127.0.0.1:54340/cadence_test";

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
      {
        test: {
          name: "strike",
          root: "packages/strike",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "api",
          root: "apps/api",
          include: ["tests/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
          env: { DATABASE_URL: testDatabase },
        },
      },
      {
        test: {
          name: "worker",
          root: "apps/worker",
          include: ["tests/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
          env: { DATABASE_URL: testDatabase },
        },
      },
    ],
  },
});
