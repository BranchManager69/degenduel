export default {
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};