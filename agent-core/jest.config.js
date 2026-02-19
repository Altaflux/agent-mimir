/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  testEnvironment: "node",
  preset: 'ts-jest/presets/default-esm',
  roots: ['<rootDir>/src'],
  // transform: {
  //   "^.+\.tsx?$": ["ts-jest",{}],
  // },
  moduleNameMapper: {
     '^(\\.{1,2}/.*)\\.js$': '$1', // Keep if needed
  },
  extensionsToTreatAsEsm: ['.ts'],
};