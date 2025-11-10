export default {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/app.js', // Exclude main app file from coverage
    '!src/test_fixtures/**' // Exclude test fixtures
  ],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  transform: {},
  moduleFileExtensions: ['js'],
  verbose: true,
  maxWorkers: 1 // Run tests sequentially to avoid race conditions with shared test_fixtures directory
};
