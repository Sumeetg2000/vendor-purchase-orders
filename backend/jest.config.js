/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  globalSetup: "<rootDir>/tests/globalSetup.ts",
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  // All test files share one real Postgres database (research.md §9's
  // deliberate choice — a mocked client wouldn't prove the DB-level
  // guarantees). Jest's default parallel workers would race each other's
  // TRUNCATEs and unique constraints against that shared DB, so tests run
  // serially. Fine for a 2-week POC test suite (Constitution Principle XII).
  maxWorkers: 1,
};
