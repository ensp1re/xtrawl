module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: "./tsconfig.test.json",
      useESM: true,
    }],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/cli/main.ts"],
  coverageDirectory: "coverage",
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: 1,
};
