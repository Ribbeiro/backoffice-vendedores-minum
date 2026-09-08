import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  // As Functions possuem seu proprio package e validacao Node separada.
  { ignores: ['dist', 'functions/**'] },
  js.configs.recommended,
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        document: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        navigator: 'readonly',
        URL: 'readonly',
        window: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react-refresh/only-export-components': 'off',
      'react/react-in-jsx-scope': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
];
