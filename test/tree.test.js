import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDependencyGraph, buildModuleTree, orderByConnectivity } from '../src/index.js';
import { SAMPLE_APP, createFixture } from './helpers.js';

const find = (node, id) =>
  node.id === id ? node : node.children?.map((c) => find(c, id)).find(Boolean);

test('buildModuleTree turns directories into modules and files into components', () => {
  const graph = buildDependencyGraph(createFixture(SAMPLE_APP), { useGit: false });
  const tree = buildModuleTree(graph);
  assert.equal(tree.type, 'module');
  assert.deepEqual(tree.children.map((c) => c.id), ['src']);
  const src = find(tree, 'src');
  assert.equal(src.value, graph.files.reduce((sum, f) => sum + f.lines, 0));
  assert.equal(find(tree, 'src/api').type, 'module');
  assert.equal(find(tree, 'src/api/users.ts').type, 'component');

  const api = find(tree, 'src/api');
  // api -> db (router, users), nothing depends on api from outside except main
  assert.equal(api.dependencies, 2);
  assert.equal(api.dependents, 1);
  const db = find(tree, 'src/db');
  assert.equal(db.dependents, 4);
  assert.equal(tree.links.length, graph.links.length);
});

test('the most connected module is at the logical centre of its parent', () => {
  const graph = buildDependencyGraph(createFixture(SAMPLE_APP), { useGit: false });
  const src = find(buildModuleTree(graph), 'src');
  const ids = src.children.map((c) => c.id);
  // src/db has the most connections (4 dependents, 0 dependencies)
  assert.equal(ids.length, 4);
  const hubIndex = ids.indexOf('src/db');
  assert.ok(hubIndex === 1 || hubIndex === 2, `hub should be central, got order ${ids.join(', ')}`);

  const api = find(src, 'src/api');
  // router declares the most dependencies within api and is tied on connections with users
  assert.equal(api.children[1].id, 'src/api/router.ts');
});

test('orderByConnectivity places the hub in the middle and connected nodes next to each other', () => {
  const edges = {
    'hub-a': 3, 'hub-b': 3, 'hub-c': 1, 'hub-d': 1, 'c-e': 5, 'd-f': 5,
  };
  const weight = (x, y) => edges[`${x}-${y}`] ?? edges[`${y}-${x}`] ?? 0;
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'hub'];
  const score = (n) => nodes.reduce((sum, m) => sum + weight(n, m), 0);
  const order = orderByConnectivity(nodes, { id: (n) => n, weight, score });
  assert.equal(order.indexOf('hub'), 3);
  assert.equal(Math.abs(order.indexOf('c') - order.indexOf('e')), 1);
  assert.equal(Math.abs(order.indexOf('d') - order.indexOf('f')), 1);
  assert.equal(Math.abs(order.indexOf('hub') - order.indexOf('a')), 1);
  assert.equal(Math.abs(order.indexOf('hub') - order.indexOf('b')), 1);
});

test('maxDepth collapses deep modules into a single leaf', () => {
  const graph = buildDependencyGraph(createFixture(SAMPLE_APP), { useGit: false });
  const tree = buildModuleTree(graph, { maxDepth: 2 });
  const api = find(tree, 'src/api');
  assert.equal(api.collapsed, true);
  assert.equal(api.children, undefined);
  assert.equal(api.files, 3);
  assert.ok(tree.links.some((l) => l.source === 'src/api' && l.target === 'src/db' && l.value === 2));
  assert.ok(!tree.links.some((l) => l.source === l.target));
});
