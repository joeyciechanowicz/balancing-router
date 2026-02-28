import { spawnSync } from 'node:child_process';

const seed = process.env.BENCH_SEED ?? '424242';
const time = process.env.BENCH_TIME ?? '5000';
const root = process.cwd();

function run(label, cmd, args) {
  process.stdout.write(`\n[step8] ${label}\n`);
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`[step8] ${label} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function runBench(name, extra = []) {
  const out = run(
    `bench ${name} ${extra.join(' ')}`.trim(),
    'node',
    ['bench/bench.mjs', '--json', '--only', name, '--time', time, '--seed', seed, ...extra],
  );
  const parsed = JSON.parse(out);
  const entry = parsed.results?.[0];
  if (!entry) {
    throw new Error(`[step8] Missing benchmark result for ${name}`);
  }
  return entry;
}

function pctDelta(current, baseline) {
  if (!baseline) return 0;
  return ((current - baseline) / baseline) * 100;
}

function fmt(n) {
  return Math.round(n).toLocaleString();
}

function main() {
  run('build', 'npm', ['run', 'build']);
  run('test', 'npm', ['test']);

  const v2Sync = runBench('balancing-router-v2');
  const v2Async = runBench('balancing-router-v2', ['--async']);
  const fmwAsync = runBench('find-my-way', ['--async']);

  const asyncDelta = pctDelta(v2Async.hz, fmwAsync.hz);
  const passAsync = v2Async.hz >= fmwAsync.hz;

  process.stdout.write('\n[step8] Summary\n');
  process.stdout.write(`- balancing-router-v2 sync:  ${fmt(v2Sync.hz)} ops/sec (rme ${v2Sync.rme.toFixed(2)}%)\n`);
  process.stdout.write(`- balancing-router-v2 async: ${fmt(v2Async.hz)} ops/sec (rme ${v2Async.rme.toFixed(2)}%)\n`);
  process.stdout.write(`- find-my-way async:         ${fmt(fmwAsync.hz)} ops/sec (rme ${fmwAsync.rme.toFixed(2)}%)\n`);
  process.stdout.write(`- async delta vs find-my-way: ${asyncDelta >= 0 ? '+' : ''}${asyncDelta.toFixed(2)}%\n`);
  process.stdout.write(`- async gate: ${passAsync ? 'PASS' : 'FAIL'}\n`);

  if (!passAsync) {
    process.exitCode = 2;
  }
}

main();
