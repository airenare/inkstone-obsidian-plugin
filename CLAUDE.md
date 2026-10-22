# CLAUDE.md

Obsidian desktop plugin (TypeScript) that previews notes via a local InkStone server.

## Commands

- `npm run build` - type-check and bundle `src/main.ts` to `main.js`
- `npm run dev` - esbuild watch mode
- `npm test` - vitest
- Requires Node 20 (see `.nvmrc`)

## Rules

- Working docs stay local: `docs/`, `.superpowers/`, `node_modules/` and `main.js` are gitignored. Never commit them.
- Keep this repo free of personal info and local absolute paths.
