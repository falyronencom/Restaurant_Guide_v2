import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * ESLint flat config (ESLint 9 canonical for Next 16).
 *
 * Baseline rules aligned with backend root .eslintrc.json (single quote, semis,
 * trailing-comma multiline) plus Next.js TypeScript + core-web-vitals presets.
 *
 * Note: directive specified web/.eslintrc.json — flat config is the modern
 * ESLint 9 equivalent. Functional intent (backend-aligned style + Next presets)
 * preserved. See Completion Report for Proactive Scope Extension rationale.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      'arrow-spacing': 'error',
      'no-multiple-empty-lines': ['error', { max: 1 }],
      // Defer to @typescript-eslint/no-unused-vars from nextTs preset — it
      // understands TS parameter properties (constructor `public foo: T`),
      // which the plain ESLint rule incorrectly flags as unused.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
