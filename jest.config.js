export default {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/app.js', // Exclude main app file from coverage
    '!src/test_fixtures/**' // Exclude test fixtures
  ],
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js',
    '<rootDir>/tests/system/**/*.test.js'
  ],
  transform: {},
  moduleFileExtensions: ['js'],
  verbose: true,
  maxWorkers: 1, // Run tests sequentially to avoid race conditions with shared test_fixtures directory
  forceExit: true, // Force Jest to exit after all tests complete
  testTimeout: 10000, // Set a reasonable timeout
  setupFiles: ['<rootDir>/tests/setup.js'], // Setup test environment
  
  // Coverage thresholds - Pipeline fails if below 75%
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75
    }
  },
  
  // Coverage reporters - Generate multiple formats for CI/CD
  coverageReporters: ['text', 'text-summary', 'lcov', 'html', 'json-summary'],
  
  // Test reporters - Generate JUnit XML for CI/CD visibility
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'test-results',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true
    }]
  ]
};
