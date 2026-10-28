/**
 * Turns a file level dependency graph into a hierarchy of modules
 * (directories), sub-modules and components (files) that d3 can lay out.
 * Siblings are ordered by connectivity so that closely connected modules are
 * neighbours and the most connected one sits at the logical centre.
 */

/**
 * Orders nodes so that the most connected node (the hub) is in the middle of
 * the sequence and nodes are placed next to the nodes they are most
 * connected with.
 *
 * Hub selection: highest `score` (total connections), then most declared
 * dependencies, then largest value, then name. The remaining nodes are added
 * greedily, strongest connection to the already placed nodes first, at the
 * outer end of the left or right side of the hub. The side is chosen by
 * minimising the distance to the nodes it is connected with (weighted by the
 * connection strength) plus a penalty for unbalancing the value of both
 * sides, which keeps the hub in the centre.
 *
 * @template T
 * @param {T[]} nodes
 * @param {{
 *   id: (node: T) => string,
 *   weight: (a: T, b: T) => number,
 *   score?: (node: T) => number,
 *   dependencies?: (node: T) => number,
 *   value?: (node: T) => number,
 * }} accessors
 * @returns {T[]}
 */
export function orderByConnectivity(nodes, accessors) {
  const { id, weight, score = () => 0, dependencies = () => 0, value = () => 1 } = accessors;
  if (nodes.length < 2) return [...nodes];
  const rank = (a, b) =>
    score(b) - score(a) ||
    dependencies(b) - dependencies(a) ||
    value(b) - value(a) ||
    (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0);

  const sorted = [...nodes].sort(rank);
  const hub = sorted[0];
  const meanValue = nodes.reduce((sum, n) => sum + value(n), 0) / nodes.length || 1;

  // Sparse adjacency (index -> [[index, weight]]) computed once.
  const neighbours = sorted.map(() => []);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const w = weight(sorted[i], sorted[j]);
      if (w > 0) {
        neighbours[i].push([j, w]);
        neighbours[j].push([i, w]);
      }
    }
  }

  // Positions: left[i] = -(i + 1), hub = 0, right[i] = i + 1.
  const position = new Map([[0, 0]]);
  const placedWeight = new Array(sorted.length).fill(0);
  const remaining = new Set(sorted.keys());
  const place = (index, pos) => {
    position.set(index, pos);
    remaining.delete(index);
    for (const [other, w] of neighbours[index]) placedWeight[other] += w;
  };
  place(0, 0);

  const left = [];
  const right = [];
  let leftValue = 0;
  let rightValue = 0;
  const distanceCost = (index, pos) => {
    let cost = 0;
    for (const [other, w] of neighbours[index]) {
      if (position.has(other)) cost += w * Math.abs(pos - position.get(other));
    }
    return cost;
  };

  while (remaining.size) {
    let best = -1;
    for (const index of remaining) {
      if (best === -1 || placedWeight[index] > placedWeight[best]) best = index;
    }
    const node = sorted[best];
    const v = value(node);
    const balanceFactor = 0.5 * Math.max(1, placedWeight[best]);
    const leftPos = -(left.length + 1);
    const rightPos = right.length + 1;
    const costLeft = distanceCost(best, leftPos) + (balanceFactor * Math.abs(leftValue + v - rightValue)) / meanValue;
    const costRight = distanceCost(best, rightPos) + (balanceFactor * Math.abs(rightValue + v - leftValue)) / meanValue;
    const goLeft = costLeft !== costRight ? costLeft < costRight : leftValue < rightValue;
    if (goLeft) {
      left.push(node);
      leftValue += v;
      place(best, leftPos);
    } else {
      right.push(node);
      rightValue += v;
      place(best, rightPos);
    }
  }
  return [...left.reverse(), hub, ...right];
}

function createNode(id, name, type) {
  return { id, name, type, value: 0, dependencies: 0, dependents: 0, connections: 0, children: [] };
}

/**
 * @param {{ name: string, files: { path: string, lines: number }[], links: { source: string, target: string }[] }} graph
 * @param {{ maxDepth?: number }} [options] collapse everything deeper than
 *   `maxDepth` directory levels into a single module leaf
 * @returns {object} root node; `root.links` holds the weighted links between leaves
 */
export function buildModuleTree(graph, options = {}) {
  const maxDepth = options.maxDepth > 0 ? Math.floor(options.maxDepth) : Infinity;
  const root = createNode('.', graph.name || '.', 'module');
  const nodes = new Map([['.', root]]);
  const chains = new Map();
  const fileToLeaf = new Map();

  for (const file of graph.files) {
    const segments = file.path.split('/');
    const collapsed = segments.length > maxDepth;
    const leafSegments = collapsed ? segments.slice(0, maxDepth) : segments;
    let parent = root;
    const chain = [root];
    leafSegments.forEach((segment, index) => {
      const id = leafSegments.slice(0, index + 1).join('/');
      let node = nodes.get(id);
      if (!node) {
        const isLeaf = index === leafSegments.length - 1;
        node = createNode(id, segment, isLeaf && !collapsed ? 'component' : 'module');
        if (isLeaf && collapsed) node.collapsed = true;
        nodes.set(id, node);
        parent.children.push(node);
      }
      chain.push(node);
      parent = node;
    });
    const leaf = parent;
    leaf.value += Math.max(1, file.lines);
    leaf.files = (leaf.files ?? 0) + 1;
    chains.set(leaf.id, chain);
    fileToLeaf.set(file.path, leaf.id);
  }

  const leafLinks = new Map();
  for (const { source, target } of graph.links) {
    const a = fileToLeaf.get(source);
    const b = fileToLeaf.get(target);
    if (!a || !b || a === b) continue;
    const key = `${a}\0${b}`;
    const link = leafLinks.get(key) ?? { source: a, target: b, value: 0 };
    link.value += 1;
    leafLinks.set(key, link);
  }

  const siblingWeights = new Map();
  const addSiblingWeight = (a, b, w) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      const map = siblingWeights.get(x) ?? new Map();
      map.set(y, (map.get(y) ?? 0) + w);
      siblingWeights.set(x, map);
    }
  };

  for (const link of leafLinks.values()) {
    const chainA = chains.get(link.source);
    const chainB = chains.get(link.target);
    let common = 0;
    while (common < chainA.length && common < chainB.length && chainA[common] === chainB[common]) common += 1;
    if (common < chainA.length && common < chainB.length) {
      addSiblingWeight(chainA[common].id, chainB[common].id, link.value);
    }
    for (const node of chainA.slice(common)) node.dependencies += link.value;
    for (const node of chainB.slice(common)) node.dependents += link.value;
  }

  const finalize = (node) => {
    node.connections = node.dependencies + node.dependents;
    if (!node.children.length) {
      delete node.children;
      return node.value;
    }
    node.value = node.children.reduce((sum, child) => sum + finalize(child), 0);
    node.children = orderByConnectivity(node.children, {
      id: (n) => n.id,
      weight: (a, b) => siblingWeights.get(a.id)?.get(b.id) ?? 0,
      score: (n) => n.connections,
      dependencies: (n) => n.dependencies,
      value: (n) => n.value,
    });
    return node.value;
  };
  finalize(root);
  root.links = [...leafLinks.values()];
  return root;
}
