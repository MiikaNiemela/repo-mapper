import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
