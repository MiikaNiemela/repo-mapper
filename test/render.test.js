import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeTreemap, mapRepository, render, renderHtml, renderSvg } from '../src/index.js';
import { SAMPLE_APP, createFixture } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/repo-mapper.js', import.meta.url));

function nodeMarkup(svg, id) {
  const start = svg.indexOf(`data-id="${id}"`);
  assert.notEqual(start, -1, `expected node ${id}`);
  return svg.slice(start, svg.indexOf('</g>', start));
}

for (const type of ['nested', 'cascaded']) {
  test(`computeTreemap lays out a ${type} treemap inside the requested size`, () => {
    const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
    const root = computeTreemap(tree, { type, width: 600, height: 400 });
    assert.deepEqual([root.x0, root.y0, root.x1, root.y1], [0, 0, 600, 400]);
    for (const d of root.descendants()) {
      if (!d.parent) continue;
      assert.ok(d.x0 >= d.parent.x0 && d.x1 <= d.parent.x1, `${d.data.id} inside parent horizontally`);
      assert.ok(d.y0 >= d.parent.y0 && d.y1 <= d.parent.y1, `${d.data.id} inside parent vertically`);
    }
    assert.equal(root.leaves().length, 6);
  });

  test(`renderSvg renders a ${type} treemap`, () => {
    const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
    const svg = renderSvg(tree, { type, showLinks: true });
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, new RegExp(`repo-map-${type}`));
    assert.match(svg, /data-id="src\/api\/router.ts"/);
    assert.equal((svg.match(/class="link"/g) ?? []).length, tree.links.length);
    assert.doesNotMatch(svg, /node_modules/);
    assert.equal(svg.includes('repo-map-shadow'), type === 'cascaded');
  });
}

test('computeTreemap rejects unknown types', () => {
  assert.throws(() => computeTreemap({ id: '.', name: 'x', value: 1 }, { type: 'radial' }), /Unknown treemap type/);
});

test('render escapes names and supports html and json', () => {
  const { tree } = mapRepository(createFixture({ 'a<b>&.js': 'export {};\n' }), { useGit: false });
  const svg = render(tree, { format: 'svg' });
  assert.match(svg, /a&lt;b&gt;&amp;\.js/);
  const html = render(tree, { format: 'html', type: 'cascaded' });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /Cascaded treemap/);
  assert.equal(JSON.parse(render(tree, { format: 'json' })).children[0].id, 'a<b>&.js');
  assert.throws(() => render(tree, { format: 'png' }), /Unknown output format/);
});

test('renderSvg applies defaults, type styles, and node rules in precedence order', () => {
  const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
  const svg = renderSvg(tree, {
    styles: {
      default: { fill: '#ffffff', opacity: 0.2, stroke: '#111111', strokeWidth: 2 },
      module: { fill: '#dddddd' },
      component: { fill: '#bbbbbb' },
      nodes: [
        { id: 'src', includeDescendants: true, fill: '#ffcc88', opacity: 0.4 },
        { id: 'src/api', fill: '#663399' },
        { id: 'src/api/router.ts', fill: '#ff0000', opacity: 1, stroke: '#00ff00', strokeWidth: 3 },
      ],
    },
  });

  assert.match(nodeMarkup(svg, '.'), /opacity="0\.2".*fill="#dddddd" stroke="#111111" stroke-width="2"/s);
  assert.match(nodeMarkup(svg, 'src'), /opacity="0\.4".*fill="#ffcc88"/s);
  assert.match(nodeMarkup(svg, 'src/api'), /opacity="0\.4".*fill="#663399"/s);
  assert.match(nodeMarkup(svg, 'src/api/users.ts'), /opacity="0\.4".*fill="#ffcc88"/s);
  assert.match(
    nodeMarkup(svg, 'src/api/router.ts'),
    /opacity="1".*fill="#ff0000" stroke="#00ff00" stroke-width="3"/s,
  );
});

test('renderSvg keeps an exact module style from cascading without includeDescendants', () => {
  const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
  const svg = renderSvg(tree, {
    styles: {
      component: { fill: '#eeeeee' },
      nodes: [{ id: 'src/api', fill: '#663399' }],
    },
  });
  assert.match(nodeMarkup(svg, 'src/api'), /fill="#663399"/);
  assert.match(nodeMarkup(svg, 'src/api/users.ts'), /fill="#eeeeee"/);
});

test('renderSvg rejects invalid styles', () => {
  const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
  assert.throws(() => renderSvg(tree, { styles: { nodes: [{ id: 'missing', fill: 'red' }] } }), /Unknown style node ID/);
  assert.throws(
    () => renderSvg(tree, { styles: { nodes: [{ id: 'src', fill: 'red' }, { id: 'src', fill: 'blue' }] } }),
    /Duplicate style rule/,
  );
  assert.throws(() => renderSvg(tree, { styles: { default: { opacity: 1.1 } } }), /opacity/);
  assert.throws(() => renderSvg(tree, { styles: { module: { strokeWidth: -1 } } }), /strokeWidth/);
  assert.throws(() => renderSvg(tree, { styles: { component: { fill: '' } } }), /fill/);
  assert.throws(
    () => renderSvg(tree, { styles: { nodes: [{ id: 'src/main.ts', includeDescendants: true }] } }),
    /component.*cannot include descendants/,
  );
});

test('cli writes the requested output', () => {
  const root = createFixture(SAMPLE_APP);
  const out = path.join(root, 'map.html');
  execFileSync(process.execPath, [BIN, root, '--type', 'cascaded', '--out', out, '--no-git']);
  assert.match(readFileSync(out, 'utf8'), /repo-map-cascaded/);
  const json = JSON.parse(execFileSync(process.execPath, [BIN, root, '-f', 'json', '--depth', '1', '--no-git'], { encoding: 'utf8' }));
  assert.equal(json.children[0].collapsed, true);
  assert.throws(() => execFileSync(process.execPath, [BIN, root, '--type', 'radial'], { stdio: 'pipe' }));
});

test('cli accepts repeatable aliases and prints config warnings to stderr', () => {
  const root = createFixture({
    'tsconfig.json': '{ invalid',
    'src/main.js': "import '@one';\nimport '@two/value';\n",
    'src/one.js': 'export {};\n',
    'src/two/value.js': 'export {};\n',
  });

  const result = spawnSync(process.execPath, [
    BIN,
    root,
    '--format',
    'json',
    '--no-git',
    '--alias',
    '@one=src/one',
    '--alias',
    '@two/*=src/two/*',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const tree = JSON.parse(result.stdout);
  assert.deepEqual(tree.links.map(({ source, target }) => [source, target]), [
    ['src/main.js', 'src/one.js'],
    ['src/main.js', 'src/two/value.js'],
  ]);
  assert.match(result.stderr, /warning \[invalid-config\]/);
});

test('cli filtering flags override committed configuration', () => {
  const root = createFixture({
    'repo-mapper.config.json': JSON.stringify({ only: ['test'] }),
    'src/app.ts': 'export {};\n',
    'src/app.test.ts': 'export {};\n',
    'src/fixture.ts': 'export {};\n',
  });
  const result = spawnSync(process.execPath, [
    BIN,
    root,
    '--format',
    'json',
    '--no-git',
    '--only',
    'code',
    '--ignore',
    '**/fixture.ts',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const tree = JSON.parse(result.stdout);
  assert.deepEqual(tree.children.map((child) => child.id), ['src']);
  assert.deepEqual(tree.children[0].children.map((child) => child.id), ['src/app.ts']);
});

test('renderSvg handles a large number of links', () => {
  const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
  const links = Array.from({ length: 200000 }, (_, i) => ({ source: 'x', target: 'y', value: i }));
  assert.doesNotThrow(() => renderSvg({ ...tree, links }, { showLinks: true }));
});

test('renderHtml keeps inherited-property names as literal connection keys', () => {
  const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
  const links = [{ source: 'constructor', target: '__proto__', value: 1 }];
  const html = renderHtml({ ...tree, links });
  assert.match(html, /new Map\(\[\["constructor",\["__proto__"\]\],\["__proto__",\["constructor"\]\]\]\)/);
});

test('renderHtml makes components keyboard focusable for highlighting', () => {
  const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
  const html = renderHtml(tree);
  assert.match(html, /setAttribute\('tabindex', '0'\)/);
  assert.match(html, /addEventListener\('focus', highlight\)/);
  assert.match(html, /addEventListener\('blur', clear\)/);
});

test('renderHtml preserves highlighting while crossing gaps between components', () => {
  const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
  const html = renderHtml(tree);
  assert.match(html, /svg\.addEventListener\('mouseleave', clear\)/);
  assert.doesNotMatch(html, /el\.addEventListener\('mouseleave', clear\)/);
});

test('renderHtml preserves configured opacity while highlighting components', () => {
  const { tree } = mapRepository(createFixture(SAMPLE_APP), { useGit: false });
  const html = renderHtml(tree, {
    styles: {
      component: { opacity: 0.4 },
      nodes: [{ id: 'src/api/router.ts', opacity: 1 }],
    },
  });
  assert.match(
    nodeMarkup(html, 'src/api/users.ts'),
    /opacity="0\.4" style="--repo-map-opacity:0\.4;--repo-map-dimmed-opacity:0\.1"/,
  );
  assert.match(html, /\.repo-map\.focus \.node\.leaf \{ opacity: var\(--repo-map-dimmed-opacity, 0\.25\); \}/);
  assert.match(html, /\.repo-map\.focus \.node\.leaf\.active \{ opacity: var\(--repo-map-opacity, 1\); \}/);
});
