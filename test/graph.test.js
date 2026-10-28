import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildDependencyGraph,
  fileCategory,
  listRepositoryFiles,
  scanRepository,
} from '../src/index.js';
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

test('built-in categories classify framework and tool files', () => {
  const cases = {
    'src/app.ts': 'code',
    'src/app.test.ts': 'test',
    'src/app.spec.tsx': 'test',
    'src/__tests__/app.js': 'test',
    'tests/integration.js': 'test',
    'tests/jest.config.js': 'config',
    'cypress/e2e/login.ts': 'test',
    'jest.config.js': 'config',
    'vitest.config.ts': 'config',
    'eslint.config.js': 'config',
    '.prettierrc.json': 'config',
    'tsconfig.build.json': 'config',
    'vite.config.ts': 'config',
    'webpack.config.js': 'config',
    'rollup.config.mjs': 'config',
    'babel.config.cjs': 'config',
    'next.config.js': 'config',
    'src/index.d.ts': 'types',
    'src/button.stories.tsx': 'story',
    '.storybook/main.ts': 'story',
    'src/client.generated.ts': 'generated',
  };
  for (const [file, expected] of Object.entries(cases)) {
    assert.equal(fileCategory(file), expected, file);
  }
});

test('category filters select mapped fixture files', () => {
  const root = createFixture({
    'src/app.ts': 'export {};\n',
    'src/app.test.ts': 'export {};\n',
    'src/types.d.ts': 'export {};\n',
    'src/button.stories.ts': 'export {};\n',
    'src/api.generated.ts': 'export {};\n',
    'vite.config.ts': 'export {};\n',
  });
  const code = buildDependencyGraph(root, { useGit: false, only: ['code'] });
  assert.deepEqual(code.files.map((file) => file.path), ['src/app.ts']);
  const withoutTestsAndConfig = buildDependencyGraph(root, {
    useGit: false,
    skip: ['test', 'config'],
  });
  assert.deepEqual(withoutTestsAndConfig.files.map((file) => file.path), [
    'src/api.generated.ts',
    'src/app.ts',
    'src/button.stories.ts',
    'src/types.d.ts',
  ]);
});

test('include and ignore globs match repo-relative paths with exclusions winning', () => {
  const root = createFixture({
    'src/app.ts': 'export {};\n',
    'src/app.test.ts': 'export {};\n',
    'src/fixtures/data.ts': 'export {};\n',
    'packages/a/src/index.ts': 'export {};\n',
  });
  const graph = buildDependencyGraph(root, {
    useGit: false,
    include: ['src/**', 'packages/*/src/**'],
    ignore: ['**/*.test.ts', '**/fixtures/**'],
  });
  assert.deepEqual(graph.files.map((file) => file.path), [
    'packages/a/src/index.ts',
    'src/app.ts',
  ]);
});

test('filtering a resolved target does not redirect its import to another file', () => {
  const root = createFixture({
    'src/main.ts': "import './foo.js';\n",
    'src/foo.js': 'export {};\n',
    'src/foo.ts': 'export {};\n',
  });
  const graph = buildDependencyGraph(root, {
    useGit: false,
    ignore: ['src/foo.js'],
  });
  const main = graph.files.find((file) => file.path === 'src/main.ts');
  assert.deepEqual(main.imports, []);
  assert.deepEqual(main.externalImports, ['./foo.js']);
  assert.deepEqual(graph.links, []);
});

test('exclude supports exact relative directories and legacy segment names', () => {
  const root = createFixture({
    'src/index.ts': 'export {};\n',
    'packages/a/lib/index.ts': 'export {};\n',
    'packages/b/lib/index.ts': 'export {};\n',
    'packages/b/src/index.ts': 'export {};\n',
  });
  assert.deepEqual(listRepositoryFiles(root, {
    useGit: false,
    exclude: ['packages/a/lib'],
  }), [
    'packages/b/lib/index.ts',
    'packages/b/src/index.ts',
    'src/index.ts',
  ]);
  assert.deepEqual(listRepositoryFiles(root, {
    useGit: false,
    exclude: ['lib'],
  }), ['packages/b/src/index.ts', 'src/index.ts']);
  for (const exact of ['src/', './src']) {
    const files = listRepositoryFiles(root, { useGit: false, exclude: [exact] });
    assert.ok(!files.includes('src/index.ts'), exact);
    assert.ok(files.includes('packages/b/src/index.ts'), exact);
  }
});

test('filter config sources and explicit options follow precedence', () => {
  const root = createFixture({
    'package.json': JSON.stringify({ repoMapper: { include: ['from-package/**'] } }),
    'repo-mapper.config.json': JSON.stringify({ include: ['from-config/**'] }),
    'from-package/a.ts': 'export {};\n',
    'from-config/b.ts': 'export {};\n',
    'from-options/c.ts': 'export {};\n',
  });
  assert.deepEqual(
    scanRepository(root, { useGit: false }).files.map((file) => file.path),
    ['from-config/b.ts'],
  );
  assert.deepEqual(
    scanRepository(root, { useGit: false, include: ['from-options/**'] }).files.map((file) => file.path),
    ['from-options/c.ts'],
  );
});

test('filtering mapped files preserves package and project config discovery', () => {
  const root = createFixture({
    'package.json': JSON.stringify({
      name: 'app',
      repoMapper: { skip: ['config'] },
    }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    }),
    'packages/local/package.json': JSON.stringify({
      name: 'local',
      main: 'src/index.ts',
    }),
    'packages/local/src/index.ts': 'export {};\n',
    'src/value.ts': 'export {};\n',
    'src/main.ts': "import '@/value';\nimport 'local';\n",
  });
  const graph = buildDependencyGraph(root, { useGit: false });
  assert.deepEqual(graph.files.find((file) => file.path === 'src/main.ts').imports, [
    'src/value.ts',
    'packages/local/src/index.ts',
  ]);
  assert.ok(!graph.files.some((file) => file.path.endsWith('.json')));
});

test('invalid filtering options produce structured warnings', () => {
  const root = createFixture({
    'package.json': JSON.stringify({
      repoMapper: { skip: ['mystery'], include: 'src/**', exclude: ['../outside'] },
    }),
    'src/app.ts': 'export {};\n',
  });
  const graph = buildDependencyGraph(root, { useGit: false });
  assert.deepEqual(
    graph.warnings.map((warning) => warning.code).sort(),
    ['invalid-exclude', 'invalid-filter-option', 'unknown-file-category'],
  );
  assert.deepEqual(graph.files.map((file) => file.path), ['src/app.ts']);
});

test('an unknown only category does not disable the allowlist', () => {
  const root = createFixture({
    'src/app.ts': 'export {};\n',
    'src/app.test.ts': 'export {};\n',
  });
  const graph = buildDependencyGraph(root, { useGit: false, only: ['mystery'] });
  assert.deepEqual(graph.files, []);
  assert.deepEqual(graph.warnings.map((warning) => warning.code), ['unknown-file-category']);
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

test('listRepositoryFiles never maps dist build output', () => {
  const root = createFixture({ 'src/a.js': 'export {};\n', 'dist/a.js': 'export {};\n', 'pkg/dist/b.js': 'export {};\n' });
  assert.deepEqual(listRepositoryFiles(root, { useGit: false }), ['src/a.js']);
});

test('resolves JSONC tsconfig paths, relative extends and nearest configs', () => {
  const root = createFixture({
    'configs/base.json': `{
      "compilerOptions": {
        "baseUrl": "..",
        "paths": { "@root/*": ["src/*"], }, // trailing comma before a comment
      },
    }`,
    'tsconfig.json': '{ "extends": "./configs/base", }\n',
    'src/root.ts': 'export const root = 1;\n',
    'src/main.ts': "import { root } from '@root/root';\n",
    'packages/app/tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } },
    }),
    'packages/app/src/value.ts': 'export const value = 1;\n',
    'packages/app/src/main.ts': "import { value } from '@app/value';\nimport '@root/root';\n",
  });
  const graph = buildDependencyGraph(root, { useGit: false });
  assert.deepEqual(graph.files.find((file) => file.path === 'src/main.ts').imports, ['src/root.ts']);
  const app = graph.files.find((file) => file.path === 'packages/app/src/main.ts');
  assert.deepEqual(app.imports, ['packages/app/src/value.ts']);
  assert.deepEqual(app.externalImports, ['@root/root']);
  assert.deepEqual(graph.warnings, []);
});

test('resolves tsconfig extends from an npm package without mapping node_modules', () => {
  const root = createFixture({
    'package.json': JSON.stringify({ name: 'app' }),
    'node_modules/@config/base/package.json': JSON.stringify({ name: '@config/base' }),
    'node_modules/@config/base/tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '../../..', paths: { '@/*': ['src/*'] } },
    }),
    'tsconfig.json': JSON.stringify({ extends: '@config/base/tsconfig.json' }),
    'src/value.ts': 'export const value = 1;\n',
    'src/main.ts': "import { value } from '@/value';\n",
  });
  const graph = buildDependencyGraph(root, { useGit: false });
  assert.deepEqual(graph.files.find((file) => file.path === 'src/main.ts').imports, ['src/value.ts']);
  assert.ok(graph.files.every((file) => !file.path.includes('node_modules')));
});

test('resolves package imports, explicit aliases and declarative Jest mappings', () => {
  const root = createFixture({
    'package.json': JSON.stringify({
      name: 'app',
      imports: {
        '#exact': { types: './types/exact.d.ts', import: './src/exact.ts' },
        '#lib/*': ['./missing/*', './src/lib/*'],
      },
      jest: { moduleNameMapper: { '^old$': '<rootDir>/src/wrong.ts' } },
    }),
    'jest.config.json': JSON.stringify({
      moduleNameMapper: { '^test/(.*)$': '<rootDir>/src/test/$1' },
    }),
    'src/exact.ts': 'export {};\n',
    'types/exact.d.ts': 'export {};\n',
    'src/lib/value.ts': 'export {};\n',
    'src/test/mock.ts': 'export {};\n',
    'src/explicit.ts': 'export {};\n',
    'src/main.ts': [
      "import '#exact';",
      "import '#lib/value';",
      "import 'test/mock';",
      "import '@explicit';",
      "import 'old';",
    ].join('\n'),
  });
  const graph = buildDependencyGraph(root, {
    useGit: false,
    aliases: [{ find: '@explicit', replacement: 'src/explicit' }],
  });
  const main = graph.files.find((file) => file.path === 'src/main.ts');
  assert.deepEqual(main.imports, ['src/exact.ts', 'src/lib/value.ts', 'src/test/mock.ts', 'src/explicit.ts']);
  assert.deepEqual(main.externalImports, ['old']);
});

test('reports malformed and unsupported configs as structured warnings', () => {
  const root = createFixture({
    'package.json': JSON.stringify({
      name: 'app',
      jest: { moduleNameMapper: { 'complex(?=x)': '<rootDir>/src/x' } },
    }),
    'tsconfig.json': '{ invalid',
    'src/main.ts': 'export {};\n',
  });
  const graph = buildDependencyGraph(root, { useGit: false, aliases: [{ find: '**', replacement: 1 }] });
  assert.deepEqual(
    graph.warnings.map((warning) => warning.code).sort(),
    ['invalid-alias', 'invalid-config', 'unsupported-jest-alias'],
  );
});
