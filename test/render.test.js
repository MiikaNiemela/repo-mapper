import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeTreemap, mapRepository, render, renderHtml, renderSvg } from '../src/index.js';
import { SAMPLE_APP, createFixture } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/repo-mapper.js', import.meta.url));

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

test('cli writes the requested output', () => {
  const root = createFixture(SAMPLE_APP);
  const out = path.join(root, 'map.html');
  execFileSync(process.execPath, [BIN, root, '--type', 'cascaded', '--out', out, '--no-git']);
  assert.match(readFileSync(out, 'utf8'), /repo-map-cascaded/);
  const json = JSON.parse(execFileSync(process.execPath, [BIN, root, '-f', 'json', '--depth', '1', '--no-git'], { encoding: 'utf8' }));
  assert.equal(json.children[0].collapsed, true);
  assert.throws(() => execFileSync(process.execPath, [BIN, root, '--type', 'radial'], { stdio: 'pipe' }));
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
