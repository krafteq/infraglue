export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@infra-glue/provider-core(.*)$': '<rootDir>/packages/cli/src/future_packages/provider-core$1',
    '^@infra-glue/cli(.*)$': '<rootDir>/packages/cli/src$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ES2022'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          declaration: true,
          declarationMap: true,
          sourceMap: true,
          removeComments: false,
          noImplicitAny: true,
          noImplicitReturns: true,
          noImplicitThis: true,
          noUnusedLocals: false, // Disable for tests
          noUnusedParameters: false, // Disable for tests
          exactOptionalPropertyTypes: true,
          noImplicitOverride: true,
          allowUnusedLabels: false,
          allowUnreachableCode: false,
          resolveJsonModule: true,
          isolatedModules: true,
          verbatimModuleSyntax: true,
        },
      },
    ],
  },
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  setupFilesAfterEnv: [],
  testTimeout: 10000,
  verbose: true,
}
