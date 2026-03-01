# Plan: Compiler-Theory-Inspired Router Parser

## Goal
Build a new router mode that compiles path-regex route definitions into executable matcher code so V8 can optimize the hot path, while preserving correctness and showing benchmark wins versus the current baseline.

## Theory Basis (Research-Informed)
1. Finite automata for linear-time matching.
   - Compile route patterns into automaton-like states/transitions instead of per-request backtracking.
   - Use deterministic dispatch for common static and constrained-param segments.
2. Partial evaluation / staging.
   - Treat `setup.compile()` as specialization time: precompute route structure, validators, and dispatch order into a residual matcher function.
   - Runtime then executes mostly straight-line code over input path segments.
3. JIT-friendly object/model design.
   - Keep stable object shapes for match results and params.
   - Keep hot callsites monomorphic (same handler record layout, predictable control flow).
4. Profile-guided optimization loop.
   - Use V8/Node profiling to confirm hotspots move from generic traversal logic to compact generated code.

## Scope and Non-Goals
- In scope:
  - String route patterns with static segments, params, param regex, wildcard, optional groups, and segment alternation (as in `idea.md` examples).
  - Final method check at accept points so method does not fragment early path matching.
  - Fast path for common methods (`GET`, `POST`) and wildcard fallback.
- Out of scope for first iteration:
  - Full user-extensible grammar beyond documented pattern features.
  - AOT native compilation or non-JS codegen.

## Architecture Plan
1. Front-end parser.
   - Parse path-regex DSL into an AST:
     - `Static`, `Param(name, regex?)`, `Wildcard(name)`, `Group(alternatives)`, `Optional(node)`.
   - Normalize into segment-level IR with explicit branching and optional expansions.
   - Validate unsupported constructs early with actionable compile errors.

2. Middle-end normalization + route graph.
   - Convert normalized routes into a shared state graph keyed by segment position and matcher predicate.
   - Factor shared prefixes and shared constrained-param validators.
   - Record accept states with:
     - route priority/order
     - method table (specific methods + `*`)
     - handler/store references

3. Back-end code generation.
   - Emit JS source for a matcher function:
     - single path normalization/segmentation
     - state dispatch with `switch`/if ladders per depth
     - validator calls inlined for common aliases (`int`, `alpha`, `locale`, etc.)
     - lazy param object creation only when captures occur
   - Compile with `new Function(...)` behind an internal factory.
   - Keep an interpreter fallback (existing automaton path) for debug parity and regression isolation.

4. Method-at-accept strategy.
   - Match path first, then resolve method at terminal route record:
     - check exact method
     - fallback to `*`
   - Ensure tie-breaking matches existing router semantics.

5. Caching strategy.
   - Reuse current cache concept but bind to compiled matcher output shape.
   - Preserve fixed-shape cache entries to avoid polymorphic IC churn.

## Implementation Milestones
1. Baseline and profiling snapshot.
   - Confirm clean tree.
   - Run `npm run bench:compare`.
   - Run:
     - `node --prof bench/bench.mjs --json`
     - `node --prof-process isolate-*.log > profile.txt`
   - Capture current hotspots and save notes in a short benchmark log section in this file or `README`.

2. Parser + IR skeleton (no behavior change in default path).
   - Implement parser and IR builder with unit tests only.
   - Add compile-time validation tests for invalid patterns.

3. Interpreter prototype over IR.
   - Execute IR without generated code to prove semantics.
   - Differential tests against current router for route corpora in `bench/routes.mjs`.

4. Generated matcher v1.
   - Emit JS matcher from IR and wire into opt-in constructor/API.
   - Validate parity across existing `test/*.test.ts` plus new DSL-specific tests.

5. Performance pass v1.
   - Optimize hottest generated blocks (branch order, validator inlining, param allocation).
   - Keep only changes with positive `bench:compare` results.
   - Commit each winning optimization separately.

6. Performance pass v2 (PGO-style refinements).
   - Re-profile with `--prof` after each accepted optimization batch.
   - Tune generated control flow based on measured hotspots.

7. Stabilization and defaulting decision.
   - If consistently faster and stable, make compiled parser path default.
   - Otherwise keep behind feature flag while documenting known gaps.

## Benchmark and Acceptance Gates
- Required per optimization:
  - `npm run bench:compare` with default time.
  - If `rme` is high, rerun with `node bench/bench.mjs --time 3000`.
- Required before merge:
  - No functional regressions in `npm test`.
  - Bench compare shows improvement for this router.
  - Profiling confirms reduced time in generic traversal hotspots.

## Testing Strategy
- Unit:
  - Parser grammar and error cases.
  - Validator correctness and edge cases.
  - Method dispatch precedence (`METHOD` over `*`).
- Property/differential:
  - Generate random supported patterns + URLs; compare compiled matcher vs interpreter/fallback matcher.
- Regression:
  - Replay `bench/routes*.mjs` corpora as correctness fixtures.

## Risks and Mitigations
1. Codegen bugs are hard to debug.
   - Keep IR interpreter and run differential tests on every PR.
2. Deopts from unstable shapes.
   - Freeze record layouts and param creation patterns; avoid optional fields changing order.
3. Regex-heavy patterns can erase gains.
   - Split fast alias validators from generic regex validator path; short-circuit early on static mismatches.
4. Compile-time cost growth with large route sets.
   - Track compile latency and memory as secondary metrics; cap expensive expansions for optional/alternation combinations.

## Suggested API Sketch
```ts
const setup = createRouterParser({ mode: "compiled" });
setup.add("GET", "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved", handler);
const router = setup.compile();
const match = router.find("GET", "/catalog/en-US/saved");
```

## Definition of Done
1. Compiled parser router supports documented route syntax from `idea.md`.
2. Method check is performed at accept stage without semantic regressions.
3. Bench compare shows repeatable improvement over current baseline.
4. Profiling confirms hotspot shift toward generated matcher code.
5. Changes are landed as small, benchmark-validated commits.

## Execution Checklist
1. Preflight
   - [ ] `git status --short` is clean (or only intentional changes).
   - [ ] Run baseline compare: `npm run bench:compare`.
   - [ ] Capture profile baseline:
     - `node --prof bench/bench.mjs --json`
     - `node --prof-process isolate-*.log > profile.txt`
   - [ ] Record baseline numbers + top hotspots in a short note.
2. PR 1: Parser + IR (no runtime switch yet)
   - [ ] Add parser and IR modules.
   - [ ] Add parser/IR unit tests.
   - [ ] Expose only internal helpers (no public API break).
   - [ ] Run `npm test` and ensure green.
3. PR 2: IR Interpreter + Differential Tests
   - [ ] Add interpreter that executes IR.
   - [ ] Add differential tests vs existing automaton behavior.
   - [ ] Validate route corpora compatibility.
   - [ ] Run `npm test`.
4. PR 3: Codegen Matcher (feature flagged)
   - [ ] Add code generator and `new Function` compile path.
   - [ ] Keep interpreter fallback for verification.
   - [ ] Add parity tests for `compiled` vs `interpreted`.
   - [ ] Run `npm test`.
5. PR 4+: Performance Iterations (small, benchmark-gated)
   - [ ] Make one targeted optimization per commit.
   - [ ] Run `npm run bench:compare` after each change.
   - [ ] If noisy, run `node bench/bench.mjs --time 3000`.
   - [ ] Keep only improvements; revert regressions immediately.
6. Release decision
   - [ ] Confirm repeatable perf wins and no semantic regressions.
   - [ ] Decide default enablement vs feature-flag hold.
   - [ ] Update README docs and migration notes.

## First PR Slice (Concrete)
Title: `Add route pattern parser and IR builder for compiled router`

Goal:
- Land compiler front-end only, with zero behavior change in request matching.

Planned file changes:
- Add [src/compiler/parser.ts](/Users/uk45110465/git/balancing-router/src/compiler/parser.ts)
  - Tokenize and parse supported route DSL from `idea.md`.
- Add [src/compiler/ir.ts](/Users/uk45110465/git/balancing-router/src/compiler/ir.ts)
  - AST-to-IR normalization and route expansion (optional/group handling).
- Add [src/compiler/types.ts](/Users/uk45110465/git/balancing-router/src/compiler/types.ts)
  - AST/IR type definitions used by parser and later back-ends.
- Add [test/compiler-parser.test.ts](/Users/uk45110465/git/balancing-router/test/compiler-parser.test.ts)
  - Positive/negative parser cases, including helpful error positions.
- Add [test/compiler-ir.test.ts](/Users/uk45110465/git/balancing-router/test/compiler-ir.test.ts)
  - IR shape snapshots/invariants for representative route patterns.
- Update [src/index.ts](/Users/uk45110465/git/balancing-router/src/index.ts)
  - Export internal parser/IR factory only if needed for tests (no new public runtime surface unless required).

PR 1 acceptance criteria:
1. Parser supports:
   - static segments
   - `:param`
   - `:param(<regex>)`
   - `:param?`
   - `:param*`
   - simple group alternation in segment context (e.g. `(catalog|portal)`)
2. Invalid grammar fails fast with actionable errors.
3. Existing router behavior and API remain unchanged.
4. `npm test` passes.
5. Benchmark is run once post-merge candidate to verify no accidental regression from added code paths.

PR 1 command runbook:
1. `npm test`
2. `npm run build`
3. `npm run bench:compare`

Commit suggestion:
- `feat(compiler): add route pattern parser and IR normalization scaffold`

## References
- Russ Cox, "Regular Expression Matching Can Be Simple And Fast": https://swtch.com/~rsc/regexp/regexp1.html
- V8 docs, "Using V8's sample-based profiler": https://v8.dev/docs/profile
- Node.js CLI docs (`--prof`, `--prof-process`): https://nodejs.org/api/cli.html
- V8 blog, "Fast properties in V8" (HiddenClasses and object shape effects): https://v8.dev/blog/fast-properties
- Jones, Gomard, Sestoft, "Partial Evaluation and Automatic Program Generation": https://www.itu.dk/~sestoft/pebook/
