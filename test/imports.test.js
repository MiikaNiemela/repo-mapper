import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractImports, resolveImport } from '../src/index.js';

test('extractImports finds static, re-export, require and dynamic imports', () => {
  const source = `
    import a from './a';
    import { b, c } from "./b";
    import type { T } from './types';
    import './side-effect';
    import * as ns from './ns.js';
    export * from './re-export';
    export { d } from './d';
    const e = require('./e');
    import f = require('./f');
    const g = await import('./g');
    import {
      h,
      i,
    } from './multi-line';
    import lodash from 'lodash';
  `;
  assert.deepEqual(extractImports(source), [
    './a', './b', './types', './side-effect', './ns.js', './re-export', './d', './e', './f', './g',
    './multi-line', 'lodash',
  ]);
});

test('extractImports ignores commented out imports', () => {
  const source = `
    // import x from './line-comment';
    /* import y from './block-comment'; */
    /**
     * const z = require('./doc-comment');
     */
    const url = 'http://example.com/'; import real from './real';
  `;
  assert.deepEqual(extractImports(source), ['./real']);
});

test('resolveImport resolves relative files, extensions, index files and TS .js imports', () => {
  const files = new Set(['src/a.ts', 'src/lib/index.tsx', 'src/c.js', 'src/d.mts', 'main.ts']);
  assert.equal(resolveImport('src/main.ts', './a', files), 'src/a.ts');
  assert.equal(resolveImport('src/main.ts', './a.js', files), 'src/a.ts');
  assert.equal(resolveImport('src/main.ts', './lib', files), 'src/lib/index.tsx');
  assert.equal(resolveImport('src/main.ts', './c.js', files), 'src/c.js');
  assert.equal(resolveImport('src/main.ts', './d.mjs', files), 'src/d.mts');
  assert.equal(resolveImport('src/lib/x.ts', '../../main', files), 'main.ts');
  assert.equal(resolveImport('src/main.ts', './a?raw', files), 'src/a.ts');
});

test('resolveImport resolves imports of a directory index, including the repository root', () => {
  const files = new Set(['index.js', 'a.js', 'lib/index.ts', 'lib/b.ts']);
  assert.equal(resolveImport('a.js', '.', files), 'index.js');
  assert.equal(resolveImport('a.js', './', files), 'index.js');
  assert.equal(resolveImport('lib/b.ts', '..', files), 'index.js');
  assert.equal(resolveImport('lib/b.ts', '.', files), 'lib/index.ts');
});

test('resolveImport ignores libraries not implemented in the repository', () => {
  const files = new Set(['src/a.ts', 'node_modules/react/index.js']);
  assert.equal(resolveImport('src/a.ts', 'react', files), null);
  assert.equal(resolveImport('src/a.ts', '@scope/pkg/sub', files), null);
  assert.equal(resolveImport('src/a.ts', 'node:fs', files), null);
  assert.equal(resolveImport('src/a.ts', './missing', files), null);
  assert.equal(resolveImport('src/a.ts', '../../outside', files), null);
});

test('resolveImport maps packages implemented in the repository (workspaces)', () => {
  const files = new Set(['packages/core/src/index.ts', 'packages/core/src/util.ts', 'packages/ui/lib/main.js']);
  const packages = new Map([
    ['@app/core', { dir: 'packages/core', entries: ['./dist/index.js'] }],
    ['ui', { dir: 'packages/ui', entries: ['lib/main.js'] }],
  ]);
  assert.equal(resolveImport('x.ts', '@app/core', files, packages), 'packages/core/src/index.ts');
  assert.equal(resolveImport('x.ts', '@app/core/util', files, packages), 'packages/core/src/util.ts');
  assert.equal(resolveImport('x.ts', 'ui', files, packages), 'packages/ui/lib/main.js');
});

test('extractImports skips regular expression literals containing comment delimiters', () => {
  const source = "const delimiter = /[/*]/;\nconst re = /\\/*x/g;\nimport real from './real.js';\n";
  assert.deepEqual(extractImports(source), ['./real.js']);
});

test('extractImports ignores import-like text inside string and template literals', () => {
  const source = [
    `const help = "require('./fake.js')";`,
    "const tpl = `import x from './tpl-fake'; ${require('./in-expression')}`;",
    "import real from './real.js';",
  ].join('\n');
  assert.deepEqual(extractImports(source), ['./in-expression', './real.js']);
});

test('extractImports scans objects with import properties in linear time', () => {
  const source = `export default [${Array(100000).fill('{ import: 0 }').join(',')}];`;
  const start = Date.now();
  assert.deepEqual(extractImports(source), []);
  assert.ok(Date.now() - start < 5000);
});
