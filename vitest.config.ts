import * as os from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/worker/test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    // render-heavy suites (real FFmpeg) are CPU bound; bound parallelism so timeouts stay meaningful
    poolOptions: { forks: { maxForks: Math.max(2, Math.floor(os.cpus().length / 2)) } },
  },
});
