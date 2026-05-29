import type { Config } from 'jest';
import nextJest from 'next/jest.js';

/*
 * Jest config via next/jest (createJestConfig) — per the installed Next's own
 * guide: node_modules/next/dist/docs/01-app/02-guides/testing/jest.md.
 *
 * next/jest auto-wires: SWC transform (reads next.config + tsconfig `paths`,
 * so `@/*` aliases resolve), CSS/asset/next-font auto-mocking (Tailwind v4
 * imports are inert in tests), and .env loading. We add only: jsdom env, the
 * jest-dom matcher setup, and stubs for `server-only`/`client-only` so the
 * server-only API modules can be imported (they are otherwise mocked at the
 * call site, but the stub is belt-and-suspenders for any transitive import).
 */
const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // tsconfig `@/*` → `./src/*`. next/jest does NOT auto-map tsconfig paths;
    // the alias must be declared here (per jest.md "Module Path Aliases").
    '^@/(.*)$': '<rootDir>/src/$1',
    '^server-only$': '<rootDir>/__mocks__/empty.js',
    '^client-only$': '<rootDir>/__mocks__/empty.js',
  },
};

// Exported as a function call so next/jest can load the (async) Next config.
export default createJestConfig(config);
