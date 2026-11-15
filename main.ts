// A token-radar-01 entry (Node 22, standard library only): the radar-2 model.
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol the exclusion rule leaves standing with the model in model.ts — a multiple
// calibrated per category from the snapshot's own live-token protocols, times TVL, growth and
// maturity — writes the ranked board to /output/board.json, and lays out this repository's dashboard
// files and screenshots under /output/dashboard/ and /output/screenshots/. Last, it writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: index.html, app.css and app.js read
// /output/data.js, which this program writes from the same board. The page re-derives every row's farm
// plan and implied value from the same figures, so the code the judge reads and the board it scores
// are visibly the same arithmetic. The repository is flat (every file at the root) so the entry is one
// upload; main.ts sorts the files into the output's directories.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** The dashboard's files, at this repository's root, laid out under /output/dashboard/. */
const DASHBOARD_FILES = ['index.html', 'app.css', 'app.js'];
/** The screenshots, at this repository's root, laid out under /output/screenshots/. */
const SCREENSHOT_FILES = ['1-board.png', '2-detail.png', '3-filtered.png'];

/** --name <value> out of the arguments, or the fallback. */
function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const input = flag('input', '/input');
const snapshotPath = input.endsWith('.json') ? input : join(input, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  process.stderr.write(`token radar: no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy the named files from this repository's root into `to`, each a regular file. */
function copyAll(files: string[], to: string): string[] {
  mkdirSync(to, { recursive: true });
  const done: string[] = [];
  for (const name of files) {
    const p = join(here, name);
    if (!existsSync(p) || !statSync(p).isFile()) {
      process.stderr.write(`token radar: ${name} is missing from the repository\n`);
      process.exit(1);
    }
    copyFileSync(p, join(to, name));
    done.push(name);
  }
  return done;
}

copyAll(DASHBOARD_FILES, join(outDir, 'dashboard'));
const images = copyAll(SCREENSHOT_FILES, join(outDir, 'screenshots'));
if (images.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${images.length} image${images.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of images) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const DOSSIER_OPTS = { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } };
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_OPTS));

process.stdout.write(
  [
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`,
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${images.length} images) and ${join(outDir, 'dossier.json')}`,
  ].join('\n') + '\n',
);
