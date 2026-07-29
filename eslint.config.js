const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = [
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "editor-2.0/**",
      "release/**",
      "src-tauri/target/**",
      "node_modules/**",
      "NativeWindows/**",
      "public/fragments/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        Blob: "readonly",
        File: "readonly",
        ResizeObserver: "readonly",
        URL: "readonly",
        console: "readonly",
        document: "readonly",
        globalThis: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["eslint.config.js", "scripts/**/*.js"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
