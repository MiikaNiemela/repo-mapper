import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Creates a temporary directory containing the given files. */
export function createFixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-mapper-'));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

/** A small TypeScript application with an installed dependency. */
export const SAMPLE_APP = {
  'package.json': JSON.stringify({ name: 'sample-app', main: 'src/main.ts' }),
  'src/main.ts': [
    "import express from 'express';",
    "import { router } from './api/router';",
    "import { config } from './config.js';",
    "import { db } from './db';",
    'export const app = express(router, config, db);',
  ].join('\n'),
  'src/config.ts': "import { db } from './db';\nexport const config = { db };\n",
  'src/db/index.ts': "import pg from 'pg';\nexport const db = pg();\n",
  'src/api/router.ts': [
    "import { db } from '../db/index.ts';",
    "import { users } from './users';",
    "import { orders } from './orders';",
    'export const router = [users, orders, db];',
  ].join('\n'),
  'src/api/users.ts': "import { db } from '../db';\nexport const users = db;\n",
  'src/api/orders.ts': "import { users } from './users';\n// import { nothing } from './missing';\nexport const orders = users;\n",
  'docs/readme.md': '# not code\n',
  'node_modules/express/index.js': "module.exports = require('./lib/express');\n",
  'node_modules/express/lib/express.js': 'module.exports = () => {};\n',
  'node_modules/pg/index.js': 'module.exports = () => {};\n',
};
