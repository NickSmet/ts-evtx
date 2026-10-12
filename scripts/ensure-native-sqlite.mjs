// better-sqlite3 is a native addon: the binary in node_modules fits exactly one Node major.
// After a switch of Node version, rebuild it here instead of failing every SQLite test.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  const Database = require('better-sqlite3');
  new Database(':memory:').close();
} catch (err) {
  if (err?.code !== 'ERR_DLOPEN_FAILED') throw err;
  console.log(`better-sqlite3 was built for another Node version; rebuilding it for ${process.version}...`);
  execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
}
