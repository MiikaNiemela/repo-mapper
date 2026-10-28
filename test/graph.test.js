import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildDependencyGraph, listRepositoryFiles } from '../src/index.js';
import { SAMPLE_APP, createFixture } from './helpers.js';

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('buildDependencyGraph maps repository modules and never node_modules', () => {
  const root = createFixture(SAMPLE_APP);
  const graph = buildDependencyGraph(root, { useGit: false });
  assert.deepEqual(
    graph.files.map((f) => f.path),
    ['src/api/orders.ts', 'src/api/router.ts', 'src/api/users.ts', 'src/config.ts', 'src/db/index.ts', 'src/main.ts'],
  );
  const main = graph.files.find((f) => f.path === 'src/main.ts');
  assert.deepEqual(main.imports, ['src/api/router.ts', 'src/config.ts', 'src/db/index.ts']);
  assert.deepEqual(main.externalImports, ['express']);
  assert.equal(main.lines, 5);
  assert.ok(graph.links.every((l) => !l.source.includes('node_modules') && !l.target.includes('node_modules')));
  assert.equal(graph.links.length, 9);
  assert.equal(graph.name, path.basename(root));
});

test('listRepositoryFiles honours .gitignore in git repositories', { skip: !hasGit }, () => {
  const root = createFixture({
    ...SAMPLE_APP,
    '.gitignore': 'dist/\n',
    'dist/bundle.js': 'console.log(1);\n',
    'vendor/node_modules/x/index.js': 'console.log(1);\n',
  });
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(path.join(root, 'untracked.js'), 'export {};\n');
  const files = listRepositoryFiles(root);
  assert.ok(files.includes('src/main.ts'));
  assert.ok(files.includes('untracked.js'));
  assert.ok(!files.some((f) => f.startsWith('dist/')));
  assert.ok(!files.some((f) => f.split('/').includes('node_modules')));
});

test('extensions option selects the mapped files', () => {
  const root = createFixture(SAMPLE_APP);
  const graph = buildDependencyGraph(root, { useGit: false, extensions: ['.md'] });
  assert.deepEqual(graph.files.map((f) => f.path), ['docs/readme.md']);
  assert.deepEqual(graph.links, []);
});

test('local packages resolve conditional root exports', () => {
  const root = createFixture({
    'packages/a/package.json': JSON.stringify({ name: 'a', exports: { '.': { types: './lib/main.d.ts', import: './lib/main.js' } } }),
    'packages/a/lib/main.js': 'export const a = 1;\n',
    'packages/a/lib/main.d.ts': 'export declare const a: number;\n',
    'packages/b/package.json': JSON.stringify({ name: 'b', exports: { import: './lib/b.js' } }),
    'packages/b/lib/b.js': 'export const b = 1;\n',
    'app.js': "import { a } from 'a';\nimport { b } from 'b';\n",
  });
  const graph = buildDependencyGraph(root, { useGit: false });
  const app = graph.files.find((f) => f.path === 'app.js');
  assert.deepEqual(app.imports, ['packages/a/lib/main.js', 'packages/b/lib/b.js']);
});

test('listRepositoryFiles rejects symbolic links', () => {
  const root = createFixture({ 'src/a.js': 'export {};\n', 'node_modules/lib/index.js': 'export {};\n' });
  try {
    symlinkSync(path.join(root, 'node_modules/lib/index.js'), path.join(root, 'vendor.js'));
  } catch {
    return;
  }
  assert.deepEqual(listRepositoryFiles(root, { useGit: false }), ['src/a.js']);
  if (hasGit) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    assert.deepEqual(listRepositoryFiles(root), ['src/a.js']);
  }
});
