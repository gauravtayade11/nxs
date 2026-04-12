#!/usr/bin/env node
/**
 * Pre-publish version consistency check.
 * Run: node scripts/check-version.js
 * Add to package.json "prepublishOnly": "node scripts/check-version.js"
 *
 * Checks that every tracked file containing a version badge/reference
 * matches the version in package.json.
 */

import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const VERSION = pkg.version;

// Files to check + patterns that must contain the current version
// Each entry: { file, pattern (regex), description }
const CHECKS = [
  {
    file: 'README.md',
    pattern: /v\d+\.\d+\.\d+/g,
    description: 'README version badge',
  },
  {
    file: 'docs.html',
    pattern: /v\d+\.\d+\.\d+/g,
    description: 'docs.html version badge',
  },
  {
    file: 'docs/index.html',
    pattern: /v\d+\.\d+\.\d+/g,
    description: 'docs/index.html version badge',
  },
];

let errors = 0;
let warnings = 0;

console.log(`\n  Version check — expecting v${VERSION}\n`);

for (const { file, pattern, description } of CHECKS) {
  if (!existsSync(file)) {
    console.log(`  ⚠  SKIP  ${file} — file not found`);
    warnings++;
    continue;
  }

  const content = readFileSync(file, 'utf8');
  const matches = [...content.matchAll(pattern)].map(m => m[0]);
  const stale = matches.filter(v => v !== `v${VERSION}`);

  if (stale.length === 0) {
    console.log(`  ✓  OK    ${file}`);
  } else {
    const unique = [...new Set(stale)];
    console.log(`  ✗  FAIL  ${file}`);
    console.log(`           Found: ${unique.join(', ')}  →  expected: v${VERSION}`);
    console.log(`           Fix: sed -i '' 's/${unique[0]}/v${VERSION}/g' ${file}`);
    errors++;
  }
}

// Check package-lock.json is in sync
if (existsSync('package-lock.json')) {
  const lock = require('../package-lock.json');
  if (lock.packages?.['']?.version === VERSION) {
    console.log(`  ✓  OK    package-lock.json`);
  } else {
    console.log(`  ✗  FAIL  package-lock.json`);
    console.log(`           Run: npm install  to sync lockfile`);
    errors++;
  }
}

// Check npm registry — warn if version already published
try {
  const { execSync } = await import('child_process');
  const published = execSync(`npm view @nextsight/nxs-cli@${VERSION} version 2>/dev/null`, { encoding: 'utf8' }).trim();
  if (published === VERSION) {
    console.log(`\n  ✗  FATAL  v${VERSION} is already published on npm — bump version first\n`);
    process.exit(1);
  }
} catch {
  // version not found on npm = good, not yet published
  console.log(`  ✓  OK    v${VERSION} not yet on npm — ready to publish`);
}

console.log('');
if (errors > 0) {
  console.log(`  ${errors} error(s) found. Fix before publishing.\n`);
  process.exit(1);
} else {
  console.log(`  All checks passed. Ready to publish v${VERSION}.\n`);
}
