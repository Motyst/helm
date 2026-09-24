// Bundle the server into one file for production (Docker). Only better-sqlite3 stays external:
// it's native. Workspace packages are TypeScript source, so they must be bundled too.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['better-sqlite3'],
  // Bundled CommonJS dependencies still call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
