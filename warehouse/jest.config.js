/**
 * Тесты гоняют логику склада (src/domain, src/db) в Node на better-sqlite3 —
 * тот же SQL, что и в приложении, но без нативных модулей Expo.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  // Экраны не тестируются здесь: им нужен рендерер React Native.
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/db/**/*.ts', '!src/db/expoDriver.ts'],
};
