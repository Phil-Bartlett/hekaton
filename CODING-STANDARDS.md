# Coding Standards

Hekaton is JavaScript and shell only. The cross-project rules in `~/.claude/CLAUDE.md` apply; this
file records the tooling that enforces them here. Everything below runs in `npm run lint`,
`npm test`, the pre-commit hooks and CI, so a push that passes locally passes CI.

## JavaScript and JSX

- Plain modern JavaScript (ES2022+, ESM sources), React 18 function components with hooks. No
  TypeScript, no class components, no `var`, no `React.createElement`.
- **Formatter: Prettier 3** with the repo `.prettierrc.json` (120 columns, double quotes, trailing
  commas). `npm run format` writes, `npm run lint` checks.
- **Linter: ESLint 10** flat config (`eslint.config.mjs`), split by Electron tier so each file only
  sees the globals its runtime provides. Rules match `argus/frontend`.
- **Tests: vitest** in `test/`, for the pure modules (state machine, transcript parser, pricing,
  placement, scanner, themes). Anything that imports `electron` or `node-pty` is exercised by
  running the app, not by unit tests.
- One state store in main; renderers subscribe over IPC and never keep a private copy.
- Comments explain why, never what. No backwards-compatibility shims, no speculative abstractions.

## Shell

- `scripts/*.sh` are POSIX-leaning bash, LF line endings (enforced by `.gitattributes`), checked by
  **shellcheck** in pre-commit and CI.

## Repository hygiene

- `.editorconfig`: UTF-8, LF, two-space indentation (four for shell).
- **pre-commit** (`.pre-commit-config.yaml`): whitespace and merge-marker checks, gitleaks secret
  scan, Prettier, ESLint and shellcheck. Install once with `pre-commit install`.
- **CI** (`.github/workflows/ci.yml`): Prettier, ESLint, vitest and shellcheck on Ubuntu; a full
  `npm ci` plus bundle build on Windows so the node-pty prebuild is proven on the target platform.
- Commits are made by explicit pathspec, never `git add .`. Pushes need a go for each occasion.
