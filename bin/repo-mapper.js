#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { OUTPUT_FORMATS, TREEMAP_TYPES, mapRepository, render } from '../src/index.js';

const USAGE = `Usage: repo-mapper [directory] [options]

Creates a d3 treemap of the modules implemented in a git repository.

Options:
  -t, --type <type>       treemap type: ${TREEMAP_TYPES.join(' | ')} (default: nested)
  -f, --format <format>   output format: ${OUTPUT_FORMATS.join(' | ')} (default: inferred from --out, else svg)
  -o, --out <file>        write the output to a file instead of stdout
  -w, --width <px>        width of the treemap (default: 1200)
  -H, --height <px>       height of the treemap (default: 800)
  -d, --depth <n>         collapse modules deeper than n directory levels
  -e, --ext <list>        comma separated file extensions to map (default: JS/TS)
  -x, --exclude <list>    comma separated directory names to exclude (node_modules is always excluded)
      --links             draw the connections between components (always on for html)
      --no-git            do not use git to list files (walk the file system instead)
  -h, --help              show this help
`;

function fail(message) {
  process.stderr.write(`repo-mapper: ${message}\n\n${USAGE}`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      type: { type: 'string', short: 't' },
      format: { type: 'string', short: 'f' },
      out: { type: 'string', short: 'o' },
      width: { type: 'string', short: 'w' },
      height: { type: 'string', short: 'H' },
      depth: { type: 'string', short: 'd' },
      ext: { type: 'string', short: 'e' },
      exclude: { type: 'string', short: 'x' },
      links: { type: 'boolean' },
      'no-git': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (error) {
  fail(error.message);
}

const { values, positionals } = parsed;
values.type ??= 'nested';
values.width ??= '1200';
values.height ??= '800';
if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (positionals.length > 1) fail('only one directory can be mapped at a time');

const list = (value) => value?.split(',').map((s) => s.trim()).filter(Boolean);
const positive = (value, name) => {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(`--${name} must be a positive number`);
  return number;
};

const format = values.format ?? (values.out ? path.extname(values.out).slice(1).toLowerCase() : 'svg');
if (!OUTPUT_FORMATS.includes(format)) fail(`unknown format "${format}"`);
if (!TREEMAP_TYPES.includes(values.type)) fail(`unknown treemap type "${values.type}"`);

const extensions = list(values.ext)?.map((e) => (e.startsWith('.') ? e : `.${e}`));
const { tree } = mapRepository(positionals[0] ?? '.', {
  extensions,
  exclude: list(values.exclude),
  useGit: !values['no-git'],
  maxDepth: positive(values.depth, 'depth'),
});

const output = render(tree, {
  format,
  type: values.type,
  width: positive(values.width, 'width'),
  height: positive(values.height, 'height'),
  showLinks: values.links || undefined,
});

if (values.out) writeFileSync(values.out, output);
else process.stdout.write(output);
