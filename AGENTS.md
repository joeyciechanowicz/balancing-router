# AGENTS.md

This repo uses an iterative, benchmark- and profiler-driven workflow. Every performance change must be measured, compared against the previous commit, and only kept if it improves the metrics.

## Workflow

1) **Baseline**
   - Ensure a clean worktree.
   - Run `npm run bench:compare` to establish the current baseline.

2) **Profile Before Changing**
   - Use Node V8 profiler to capture hotspots:
     - `node --prof bench/bench.mjs --json`
     - `node --prof-process isolate-*.log > profile.txt`
   - Focus on hot functions in `src/index.ts` (route matching, regex checks, params handling).

3) **Iterate in Small Steps**
   - Make a single focused change.
   - Run `npm run bench:compare`.
   - Keep only improvements; revert regressions immediately.

4) **Commit Each Win**
   - Each performance improvement is its own commit.
   - Commit message should describe the optimization.

5) **Rebalance of Routes**
   - Benchmarks should not rebalance during the timed run.
   - Rebalancing belongs in warmup only.

## Benchmark Rules

- Default bench time is 1000ms per task; use `--time` for longer runs.
- Always look at `rme` (relative margin of error) and samples.
- If `rme` is high, increase time and rerun.

## Bench Commands

- `npm run bench` (default 1000ms)
- `node bench/bench.mjs --time 3000`
- `npm run bench:compare`

## Definition of Done for Perf Changes

- Bench compare shows improvement for balancing-router.
- No functional regressions.
- Change committed with a clear message.
