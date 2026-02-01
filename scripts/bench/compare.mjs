import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

function getPreviousIndex() {
  const result = run('git', ['show', 'HEAD~1:src/index.ts'], { cwd: root });
  if (result.status !== 0) return null;
  return result.stdout;
}

function buildRouter(sourcePath, outDir) {
  const result = run('npx', [
    'tsc',
    '--target',
    'ES2019',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--declaration',
    '--esModuleInterop',
    '--skipLibCheck',
    '--outDir',
    outDir,
    sourcePath,
  ], { cwd: root });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'TypeScript build failed');
  }
  return resolve(outDir, 'index.js');
}

function runBench(routerPath) {
  const args = ['bench/bench.mjs', '--json', '--time', '1000'];
  if (routerPath) {
    args.push('--router', routerPath);
  }
  const result = run('node', args, { cwd: root });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Benchmark failed');
  }
  return JSON.parse(result.stdout);
}

function formatDelta(current, previous) {
  if (previous === 0) return 'n/a';
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

const previousIndex = getPreviousIndex();
if (!previousIndex) {
  console.log('No previous commit found. Running current benchmarks only.');
  const current = runBench();
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'balancing-router-'));
const previousSource = resolve(tmpDir, 'index.ts');
writeFileSync(previousSource, previousIndex, 'utf8');

const previousPath = buildRouter(previousSource, resolve(tmpDir, 'prev-dist'));
const currentPath = buildRouter(resolve(root, 'src', 'index.ts'), resolve(tmpDir, 'current-dist'));

const current = runBench(currentPath);
const previous = runBench(previousPath);

const previousMap = new Map(previous.results.map((entry) => [entry.name, entry]));

console.log('Benchmark comparison (current vs previous):');
for (const entry of current.results) {
  const prev = previousMap.get(entry.name);
  if (!prev) {
    console.log(`- ${entry.name}: ${Math.round(entry.hz)} ops/sec (no previous baseline)`);
    continue;
  }
  const delta = formatDelta(entry.hz, prev.hz);
  console.log(`- ${entry.name}: ${Math.round(entry.hz)} ops/sec (prev ${Math.round(prev.hz)}; ${delta})`);
}
