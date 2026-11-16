// Driver for the markdown-render-speed entry.
//
// The harness runs `node /bot/main.ts` on Node 22, which strips
// TypeScript types natively, so this file uses erasable syntax only.
// It reads every case from /input/cases.json (or from
// $MAKEFUN_INPUT_DIR/cases.json for local runs), renders each case
// alone through parse(), and writes the HTML array to
// /output/html.json (or $MAKEFUN_OUTPUT_DIR/html.json).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

type Case = { id: string; markdown: string };

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as Case[];
  const html = new Array<string>(cases.length);
  // Each case is rendered alone: parse() keeps nothing between calls,
  // so the result for a case depends only on that case's markdown.
  for (let i = 0; i < cases.length; i++) {
    html[i] = parse(cases[i].markdown);
  }

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
}

main();
