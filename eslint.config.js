const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'NativeWindows/**',
      'public/fragments/**',
      'android/**',
      'src/app/**',
      'src/components/animated-icon*',
      'src/components/app-tabs*',
      'src/components/external-link.tsx',
      'src/components/hint-row.tsx',
      'src/components/themed-*',
      'src/components/ui/**',
      'src/components/web-badge.tsx',
      'src/constants/**',
      'src/hooks/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        Blob: 'readonly',
        File: 'readonly',
        ResizeObserver: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        document: 'readonly',
        globalThis: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['eslint.config.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
