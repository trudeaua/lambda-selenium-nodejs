/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  moduleNameMapper: {
    "^utils/(.*)$": "<rootDir>/utils/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
};
