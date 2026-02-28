import { existsSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
function readArg(name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

const seed = readArg('--seed', process.env.BENCH_SEED ?? '424242');
const time = readArg('--time', process.env.BENCH_TIME ?? '5000');
const target = readArg('--static-target', process.env.BENCH_STATIC_URLS_TARGET ?? '3000000');
const routesArg = readArg('--routes', 'bench/routes-generic.mjs,bench/routes-specific.mjs');
const routeModules = routesArg
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0)
  .filter((value) => existsSync(resolve(process.cwd(), value)));

if (routeModules.length === 0) {
  throw new Error('No route modules found for matrix run.');
}

const routers = ['balancing-router', 'balancing-router-v2'];
const modes = ['sync', 'async'];

function run(label, cmd, args, env = {}) {
  process.stdout.write(`\n[step10] ${label}\n`);
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function toModuleEnvPath(routeModule) {
  if (routeModule.startsWith('./') || routeModule.startsWith('../') || routeModule.startsWith('/')) {
    return routeModule;
  }
  return `./${routeModule}`;
}

function toUrlsModule(routeModule) {
  const abs = resolve(process.cwd(), routeModule);
  const urls = `${basename(abs, '.mjs')}.urls.mjs`;
  return resolve(dirname(abs), urls);
}

function runBench(routeModule, urlsModule, routerName, mode) {
  const args = ['bench/bench.mjs', '--json', '--only', routerName, '--time', time, '--seed', String(seed)];
  if (mode === 'async') args.push('--async');
  const out = run(`${routerName} ${mode} routes=${routeModule}`, 'node', args, {
    BENCH_ROUTES_MODULE: routeModule,
    BENCH_PRECOMPUTED_URLS_MODULE: urlsModule,
  });
  const parsed = JSON.parse(out);
  return parsed.results[0];
}

function fmt(value) {
  return Math.round(value).toLocaleString();
}

run('build', 'npm', ['run', 'build']);
run('test', 'npm', ['test']);

const matrix = [];
for (const routeModule of routeModules) {
  const routeModuleEnv = toModuleEnvPath(routeModule);
  run(`generate static urls (${routeModule})`, 'node', ['scripts/bench/generate-static-urls.mjs'], {
    BENCH_STATIC_ROUTES_MODULE: routeModuleEnv,
    BENCH_STATIC_URLS_TARGET: String(target),
  });

  const urlsModule = toUrlsModule(routeModule);
  for (const mode of modes) {
    for (const routerName of routers) {
      const result = runBench(routeModuleEnv, urlsModule, routerName, mode);
      matrix.push({
        routeModule,
        mode,
        routerName,
        hz: result.hz,
        rme: result.rme,
        samples: result.samples,
      });
    }
  }
}

process.stdout.write('\n[step10] Matrix Summary\n');
for (const routeModule of routeModules) {
  process.stdout.write(`\n- routes=${routeModule}\n`);
  for (const mode of modes) {
    const rows = matrix.filter((entry) => entry.routeModule === routeModule && entry.mode === mode);
    rows.sort((a, b) => b.hz - a.hz);
    for (const row of rows) {
      process.stdout.write(
        `  ${row.mode.padEnd(5)} ${row.routerName.padEnd(21)} ${fmt(row.hz)} ops/sec (rme ${row.rme.toFixed(2)}%, samples ${row.samples})\n`,
      );
    }
  }
}

process.stdout.write(`\n[step10] matrix_json ${JSON.stringify(matrix)}\n`);
