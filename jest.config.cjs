module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^../src/(.*)$': '<rootDir>/src/$1.ts',
    '^./src/(.*)$': '<rootDir>/src/$1.ts',
    // Map internal ESM-style .js imports in TS sources back to .ts
    '^\.\./binary/BinaryReader\.js$': '<rootDir>/src/binary/BinaryReader.ts',
    '^\.\./logging/logger\.js$': '<rootDir>/src/logging/logger.ts',
    '^\.\/logging/logger\.js$': '<rootDir>/src/logging/logger.ts',
    '^\./(ChunkHeader|BXmlNode|TemplateNode|enums)\.js$': '<rootDir>/src/evtx/$1.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
};
