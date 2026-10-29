import { interpolateRgb, path as d3Path, scaleOrdinal, schemeTableau10 } from 'd3';
import { LABEL_HEIGHT, computeTreemap } from './layout.js';

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const CHAR_WIDTH = 6.5;

function fitLabel(text, width) {
  const maxChars = Math.floor((width - 6) / CHAR_WIDTH);
  if (maxChars < 2) return '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function describe(d) {
  const { data } = d;
  const kind = data.type === 'component' ? 'component' : data.collapsed ? 'module (collapsed)' : 'module';
  return [
    `${data.id === '.' ? data.name : data.id} (${kind})`,
    `${d.value} lines of code`,
    `${data.dependencies} dependencies, ${data.dependents} dependents`,
  ].join('\n');
}

/**
 * Renders a module tree as a d3 treemap SVG document.
 *
 * @param {object} tree output of `buildModuleTree`
 * @param {{
 *   type?: 'nested' | 'cascaded',
 *   width?: number,
 *   height?: number,
 *   showLinks?: boolean,
 * }} [options]
 * @returns {string}
 */
export function renderSvg(tree, options = {}) {
  const { type = 'nested', width = 1200, height = 800, showLinks = false } = options;
  const root = computeTreemap(tree, { type, width, height });
  const color = scaleOrdinal(schemeTableau10);
  const topLevel = (d) => (d.depth === 0 ? d : d.ancestors().find((a) => a.depth === 1));
  const fill = (d) => {
    if (d.depth === 0) return '#f2f2f2';
    const base = color(topLevel(d).data.id);
    const t = type === 'cascaded' ? Math.min(0.75, 0.15 * (d.depth - 1)) : d.children ? 0.85 : 0.45;
    return interpolateRgb(base, '#ffffff')(t);
  };

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="repo-map repo-map-${type}" ` +
      `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
      `font-family="system-ui, sans-serif" font-size="11">`,
  );
  if (type === 'cascaded') {
    out.push(
      '<defs><filter id="repo-map-shadow" x="-10%" y="-10%" width="130%" height="130%">' +
        '<feDropShadow dx="2" dy="2" stdDeviation="2.5" flood-opacity="0.4"/></filter></defs>',
    );
  }
  out.push('<g class="nodes">');
  for (const d of root.descendants()) {
    const w = Math.max(0, d.x1 - d.x0);
    const h = Math.max(0, d.y1 - d.y0);
    if (d.depth > 0 && (w <= 0 || h <= 0)) continue;
    const leaf = !d.children;
    const classes = ['node', d.data.type, leaf ? 'leaf' : 'branch'];
    const filter = type === 'cascaded' && d.depth > 0 ? ' filter="url(#repo-map-shadow)"' : '';
    const stroke = type === 'nested' ? (leaf ? '#ffffff' : '#555555') : '#ffffff';
    out.push(
      `<g class="${classes.join(' ')}" data-id="${escapeXml(d.data.id)}" data-depth="${d.depth}" ` +
        `transform="translate(${d.x0},${d.y0})">`,
    );
    out.push(`<title>${escapeXml(describe(d))}</title>`);
    out.push(
      `<rect width="${w}" height="${h}" fill="${fill(d)}" stroke="${stroke}" stroke-width="${leaf ? 0.5 : 1}"${filter}/>`,
    );
    const label = fitLabel(d.data.name, w);
    if (label && (leaf ? h >= 14 : h >= LABEL_HEIGHT)) {
      const weight = leaf ? 'normal' : 'bold';
      out.push(`<text x="4" y="13" fill="#1d1d1d" font-weight="${weight}">${escapeXml(label)}</text>`);
    }
    out.push('</g>');
  }
  out.push('</g>');

  if (showLinks) {
    const leaves = new Map(root.leaves().map((d) => [d.data.id, d]));
    const center = (d) => [(d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2];
    let maxValue = 1;
    for (const link of tree.links ?? []) if (link.value > maxValue) maxValue = link.value;
    out.push(`<g class="links" fill="none" stroke="#333333" pointer-events="none">`);
    for (const link of tree.links ?? []) {
      const s = leaves.get(link.source);
      const t = leaves.get(link.target);
      if (!s || !t) continue;
      const [x1, y1] = center(s);
      const [x2, y2] = center(t);
      const p = d3Path();
      p.moveTo(x1, y1);
      p.quadraticCurveTo((x1 + x2) / 2 + (y2 - y1) / 4, (y1 + y2) / 2 - (x2 - x1) / 4, x2, y2);
      const opacity = (0.15 + 0.45 * (link.value / maxValue)).toFixed(2);
      out.push(
        `<path class="link" data-source="${escapeXml(link.source)}" data-target="${escapeXml(link.target)}" ` +
          `d="${p.toString()}" stroke-opacity="${opacity}" stroke-width="${(1 + link.value / maxValue).toFixed(2)}"/>`,
      );
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

/**
 * Renders a module tree as a standalone HTML page containing the treemap.
 * Hovering a component highlights the components it is connected with.
 *
 * @param {object} tree output of `buildModuleTree`
 * @param {Parameters<typeof renderSvg>[1] & { title?: string }} [options]
 * @returns {string}
 */
export function renderHtml(tree, options = {}) {
  const title = options.title ?? `Repository map: ${tree.name}`;
  const svg = renderSvg(tree, { ...options, showLinks: options.showLinks ?? true });
  const connections = new Map();
  const connect = (from, to) => {
    if (!connections.has(from)) connections.set(from, []);
    connections.get(from).push(to);
  };
  for (const { source, target } of tree.links ?? []) {
    connect(source, target);
    connect(target, source);
  }
  const data = JSON.stringify([...connections]).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeXml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; color: #1d1d1d; }
  .repo-map .links path { display: none; }
  .repo-map.focus .node.leaf { opacity: 0.25; }
  .repo-map.focus .node.leaf.active { opacity: 1; }
  .repo-map.focus .links path.active { display: inline; stroke-opacity: 0.8; }
  .repo-map .node.leaf:focus { outline: 2px solid #1d1d1d; }
</style>
</head>
<body>
<h1>${escapeXml(title)}</h1>
<p>${options.type === 'cascaded' ? 'Cascaded' : 'Nested'} treemap of the modules implemented in the repository. Hover or focus a component to highlight its connections.</p>
${svg}
<script>
(() => {
  const connections = new Map(${data});
  const svg = document.querySelector('svg.repo-map');
  const leaves = new Map([...svg.querySelectorAll('.node.leaf')].map((el) => [el.dataset.id, el]));
  const links = [...svg.querySelectorAll('.links path')];
  const clear = () => {
    svg.classList.remove('focus');
    svg.querySelectorAll('.active').forEach((el) => el.classList.remove('active'));
  };
  leaves.forEach((el, id) => {
    const highlight = () => {
      clear();
      svg.classList.add('focus');
      el.classList.add('active');
      (connections.get(id) || []).forEach((other) => leaves.get(other)?.classList.add('active'));
      links
        .filter((l) => l.dataset.source === id || l.dataset.target === id)
        .forEach((l) => l.classList.add('active'));
    };
    el.setAttribute('tabindex', '0');
    el.addEventListener('mouseenter', highlight);
    el.addEventListener('focus', highlight);
    el.addEventListener('blur', clear);
  });
  svg.addEventListener('mouseleave', clear);
})();
</script>
</body>
</html>
`;
}
