// Flat config mirroring argus/frontend/eslint.config.mjs, split by Electron
// tier so each file only sees the globals its runtime actually provides.
import globals from "globals";

const rules = {
  "no-undef": "error",
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "no-var": "error",
  "prefer-const": "warn",
  "prefer-arrow-callback": "warn",
  "no-eval": "error",
  "no-implied-eval": "error",
  eqeqeq: ["warn", "smart"],
  "no-alert": "warn",
};

const esm = { ecmaVersion: "latest", sourceType: "module" };

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/main/**/*.js", "src/preload/**/*.js", "src/shared/**/*.js", "scripts/**/*.mjs", "*.mjs"],
    languageOptions: { ...esm, globals: { ...globals.node } },
    rules,
  },
  {
    files: ["src/renderer/**/*.{js,jsx}"],
    languageOptions: {
      ...esm,
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules,
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ...esm,
      globals: {
        ...globals.node,
        vi: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    rules,
  },
  {
    // GNOME Shell's own JavaScript (GJS): ES modules with the shell's globals.
    files: ["gnome-extension/**/*.js"],
    languageOptions: { ...esm, globals: { global: "readonly", console: "readonly" } },
    rules,
  },
];
