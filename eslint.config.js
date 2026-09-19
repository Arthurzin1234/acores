import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'data/**', 'server/auth/**', '.sites-runtime/**'] },
  js.configs.recommended,
  { files: ['**/*.{js,jsx,mjs}'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-unused-vars': 'off', 'no-empty': ['error', { allowEmptyCatch: true }], 'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error' } },
];
