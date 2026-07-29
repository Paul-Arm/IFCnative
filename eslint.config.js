const js = require("@eslint/js");
const reactHooks = require("eslint-plugin-react-hooks");
const tseslint = require("typescript-eslint");

module.exports = [
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "release/**",
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
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "react-hooks/rules-of-hooks": "error",
      // Bewusst aus: Effekte in diesem Repo arbeiten vielfach mit gezielt
      // unvollständigen Dependency-Arrays (z. B. Viewer-Setup, Shortcuts).
      "react-hooks/exhaustive-deps": "off",
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
  {
    files: ["src-electron/**/*.ts"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        process: "readonly",
        Response: "readonly",
      },
    },
  },
];
