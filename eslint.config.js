import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import a11y from 'eslint-plugin-jsx-a11y';
import solid from 'eslint-plugin-solid';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [solid.configs.v2],
    languageOptions: { globals: globals.browser },
    rules: {
      'solid/reactivity': 'error',
      'solid/no-unused-signal': 'error',
    },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [a11y.flatConfigs.recommended],
    settings: { 'jsx-a11y': { attributes: { for: ['for'] } } },
  },
  {
    files: ['*.config.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
