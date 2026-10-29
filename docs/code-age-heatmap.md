# Code age heatmap with a TypeScript Node.js app

Generate `age-heatmap.md` with a cascaded treemap and, directly below it, a
ten-color legend. Older code is lighter: code unchanged for **over 365 days**
is white, `rgb(255, 255, 255)`, and code changed **within the last seven days**
is Falu Red, using the requested value `rgb(80, 18, 18)`.

Here, "code age" means elapsed time since the latest commit touching a file at
`HEAD`, not the age of individual lines. Each directory module takes the age
of its most recently changed mapped descendant. Rectangle area still represents
lines of code, not age.

## Prerequisites

- Node.js **22.18 or newer**, which can execute the example's TypeScript directly.
  Node strips the types; it does not type-check the script.
- Git and a repository with commits and complete history. In GitHub Actions,
  use `actions/checkout` with `fetch-depth: 0`.
- A repo-mapper release containing the `styles` rendering API described in the
  [README](../README.md#highlighting-modules-and-components). If the published
  package predates it, install from a local checkout of `main` instead.

Create a small tooling app outside the repository you want to map:

```sh
mkdir code-age-report
cd code-age-report
npm init -y
npm pkg set type=module
npm install @miikaniemela/repo-mapper
# Before a release with styles support is available, replace the install above:
# npm install /absolute/path/to/repo-mapper
```

For GitHub Packages authentication, follow the package access guidance in the
[GitHub Actions example](github-pr-diagram.md#notes).

## Complete example

Save this as `generate-age-heatmap.mts` in the tooling app:

```typescript
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mapRepository, renderSvg } from '@miikaniemela/repo-mapper';

type AgeNode = {
  id: string;
  children?: AgeNode[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const repository = path.resolve(process.argv[2] ?? '.');
const outputDirectory = path.resolve(process.argv[3] ?? './report');

function git(...args: string[]): string {
  return execFileSync('git', ['--literal-pathspecs', '-C', repository, ...args], {
    encoding: 'utf8',
  }).trim();
}

if (git('rev-parse', '--is-shallow-repository') === 'true') {
  throw new Error('Fetch the complete Git history before generating the heatmap.');
}
const head = git('rev-parse', '--verify', 'HEAD');

// Ten bands, newest first. Boundaries use elapsed 24-hour days without rounding.
const bands = [
  { maxDays: 7, label: 'Within the last 7 days' },
  { maxDays: 14, label: 'Over 7 to 14 days' },
  { maxDays: 30, label: 'Over 14 to 30 days' },
  { maxDays: 60, label: 'Over 30 to 60 days' },
  { maxDays: 90, label: 'Over 60 to 90 days' },
  { maxDays: 120, label: 'Over 90 to 120 days' },
  { maxDays: 180, label: 'Over 120 to 180 days' },
  { maxDays: 270, label: 'Over 180 to 270 days' },
  { maxDays: 365, label: 'Over 270 to 365 days' },
  { maxDays: Infinity, label: 'Over 365 days (one year)' },
].map((band, index) => {
  // Linear RGB interpolation, from the exact red endpoint to white.
  const t = index / 9;
  const channel = (redChannel: number) => Math.round(redChannel + (255 - redChannel) * t);
  return {
    ...band,
    fill: `rgb(${channel(80)}, ${channel(18)}, ${channel(18)})`,
  };
});

function colorFor(timestamp: number): string {
  // Treat future-dated commits as new rather than assigning a negative age.
  const ageDays = Math.max(0, now - timestamp) / DAY_MS;
  const band = bands.find(({ maxDays }) => ageDays <= maxDays);
  if (!band) throw new Error(`No color band for age ${ageDays}`);
  return band.fill;
}

const { graph, tree } = mapRepository(repository, { only: ['code'] });
for (const warning of graph.warnings) {
  console.warn(`repo-mapper: [${warning.code}] ${warning.message}`);
}
if (graph.files.length === 0) throw new Error('No source files matched the repository filters.');

const timestamps = new Map<string, number>();
for (const file of graph.files) {
  const seconds = git('log', '-1', '--format=%ct', head, '--', file.path);
  if (!/^\d+$/.test(seconds)) {
    throw new Error(`No committed history for ${file.path}; commit it or exclude it from the map.`);
  }
  timestamps.set(file.path, Number(seconds) * 1000);
}

const nodes: { id: string; fill: string }[] = [];
function styleNode(node: AgeNode): number {
  let latest = timestamps.get(node.id);
  for (const child of node.children ?? []) {
    const childTimestamp = styleNode(child);
    latest = latest === undefined ? childTimestamp : Math.max(latest, childTimestamp);
  }
  if (latest === undefined) throw new Error(`No age available for diagram node ${node.id}`);
  nodes.push({ id: node.id, fill: colorFor(latest) });
  return latest;
}
styleNode(tree);

const svg = renderSvg(tree, {
  type: 'cascaded',
  width: 1600,
  height: 1000,
  styles: {
    default: { fill: 'rgb(255, 255, 255)', stroke: '#808080' },
    nodes,
  },
});

// A separate SVG keeps the color swatches visible in Markdown renderers
// that sanitize inline SVG or inline background-color styles.
const legendRows = [...bands].reverse().map(({ label, fill }, index) => {
  const y = 12 + index * 30;
  return [
    `<rect x="12" y="${y}" width="32" height="20" fill="${fill}" stroke="#808080"/>`,
    `<text x="56" y="${y + 15}">${label} - ${fill}</text>`,
  ].join('\n');
});
const legend = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="324" viewBox="0 0 640 324">',
  '<rect width="640" height="324" fill="#ffffff"/>',
  '<g font-family="system-ui, sans-serif" font-size="14" fill="#1d1d1d">',
  ...legendRows,
  '</g>',
  '</svg>',
].join('\n');

const markdown = [
  '# Code age heatmap',
  '',
  `Generated: ${new Date(now).toISOString()}`,
  '',
  `Commit: \`${head}\``,
  '',
  '![Cascaded code age treemap](./age-heatmap.svg)',
  '',
  '## Color legend',
  '',
  '![Ten age bands, from white for over a year old to dark red for the last week](./age-heatmap-legend.svg)',
  '',
  '| Code age | Color |',
  '| --- | --- |',
  ...[...bands].reverse().map(({ label, fill }) => `| ${label} | \`${fill}\` |`),
  '',
  'File age is based on the latest touching commit; modules use their newest mapped descendant.',
  '',
].join('\n');

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(path.join(outputDirectory, 'age-heatmap.svg'), svg);
writeFileSync(path.join(outputDirectory, 'age-heatmap-legend.svg'), legend);
writeFileSync(path.join(outputDirectory, 'age-heatmap.md'), markdown);
console.log(`Created ${path.join(outputDirectory, 'age-heatmap.md')}`);
```

Run it with the repository directory and output directory:

```sh
node generate-age-heatmap.mts /absolute/path/to/typescript-node-app ./report
```

The output is three files:

```text
report/
  age-heatmap.md
  age-heatmap.svg
  age-heatmap-legend.svg
```

Open `age-heatmap.md` in a Markdown preview, or commit all three files together.
It embeds the treemap **as an SVG image**, rather than inline `<svg>` markup
that GitHub Markdown would sanitize. The SVG legend and its accessible text
table appear below the treemap. Keeping the three files together preserves the
relative image links.

## Interpretation and limitations

- Colors use exactly ten discrete RGB values. The legend is generated from
  the same bands as the diagram, ordered white (oldest) to red (newest).
- A "year" here is 365 elapsed days, not a calendar-year calculation.
- Git committer timestamps determine age. A rename counts as a change;
  working-tree edits do not affect timestamps. Commit changes before generating
  a report if they should count as recent. Untracked mapped files fail
  explicitly instead of being assigned a misleading old-code color.
- Directory colors show their **newest** descendant, not average age. A
  recently changed small file can therefore make its entire module red.
- This is a file-recency report, not a `git blame` analysis or an indicator of
  code quality, ownership, or risk.
- Source filtering follows repo-mapper's normal rules and committed
  configuration. The example additionally selects the `code` category.
- The example runs one `git log` per mapped file for clarity. This can be slow
  for very large repositories.
- Generate outside the mapped repository as shown above, or ignore the output
  directory. Use a clean checkout for reports that should match `HEAD` exactly.
- The Markdown and SVGs are static artifacts; rerun the app to refresh ages.
