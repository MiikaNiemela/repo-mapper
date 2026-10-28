import { extractImports, resolveImport } from './imports.js';
import { SCRIPT_EXTENSIONS } from './scan.js';

const javascript = Object.freeze({
  extensions: SCRIPT_EXTENSIONS,
  extractImports,
  resolveImport,
});

const analyzers = new Map(
  javascript.extensions.map((extension) => [extension, javascript]),
);

/** Returns the internal language analyser registered for an extension. */
export function analyserFor(extension) {
  return analyzers.get(extension.toLowerCase()) ?? null;
}

