# Next Iteration Research: Throughput-First Router v2

## Goals

- Maximize steady-state lookup throughput under low-locality, production-like traffic.
- Preserve industry-standard route syntax support, including regex-in-segment patterns.
- Eliminate runtime adaptation/rebalancing in favor of startup-time compilation.
- Assume build-once/query-many: all route registration happens at startup.
- Implement v2 additively as a new router in `src/`, without replacing the existing router during experimentation.

## Confirmed Constraints

- Regex-in-segment compatibility is required.
- Runtime `rebalance()` can be removed for v2.
- Registration is startup-only (immutable runtime structures are acceptable and preferred).
- Throughput is prioritized over memory efficiency.
- Existing router remains available as the baseline/control implementation.

## What We Know From Current Router

- Current hot path is `find -> _findGET -> _walk`, with cache checks and segment splitting still in the critical path.
- Current structure is an object-heavy mixed trie (static children object + dynamic arrays + regex route arrays).
- Runtime hit counters and reordering (`rebalance`) introduce mutable state, pointer chasing, and write traffic.
- Under shuffled production-like URL corpora, locality is lower, so raw match engine cost dominates over cache-hit wins.

Implication: v2 should bias toward immutable, method-specialized, cache-local data structures with tight monomorphic loops.

## v2 Architecture Direction

## Repository Integration Strategy

Develop v2 as a parallel engine under `src/` and keep current behavior stable:

- Keep existing router code and `createRouter` behavior unchanged.
- Add dedicated v2 modules (for example `src/router-v2.ts`, compiler/matcher support files).
- Export a new factory for v2 (for example `createRouterV2`), selected explicitly by tests/bench.
- Reuse current bench corpus/tooling; choose router implementation via CLI/env switch.
- Maintain side-by-side tests:
  - shared semantic tests run against both implementations
  - v2-specific tests for compiler/runtime internals

### 1) Compile routes into immutable IR at startup

Build a route compiler that parses route definitions once and emits a compact intermediate representation (IR) for matching.

- Parse path tokens into static/dynamic/regex segment ops.
- Precompute per-segment metadata used for fast rejection.
- Produce final immutable matcher tables per method.

### 2) Method-specialized match engines

Generate one matcher per method (`GET`, `POST`, etc.) plus one wildcard (`*`) matcher.

- Avoid method switching in hot loops.
- Lookup flow:
  1. method-specific matcher
  2. wildcard matcher fallback

### 3) Flat, cache-local trie representation

Replace object graphs with contiguous arrays and integer indexes.

- Node metadata arrays (parallel arrays / struct-of-arrays style).
- Edge tables grouped by node and edge type.
- Handler table indexed directly by terminal node id.

This reduces hidden-class churn and pointer chasing, improving CPU cache locality.

### 4) Two-lane segment matching

At each node, evaluate in fixed order:

1. static edge lane (exact segment match)
2. dynamic lane (param/regex), ordered by offline selectivity score

Static-lane first keeps the common path branch-predictable. Dynamic order is fixed at compile-time, not runtime.

### 5) Specialized validators for common regex classes

Preserve full regex support while accelerating common patterns with custom scanners.

Examples:

- `\\d+` => integer scanner
- `[a-zA-Z]+` => alpha scanner
- `[a-z0-9-]+` => slug scanner
- locale pattern `[a-z]{2}-[A-Z]{2}` => locale scanner
- UUID-like canonical formats => uuid scanner

Fallback for non-specializable patterns remains `RegExp`.

Ensure this is abstracted so experiments on scanners can be performed

### 6) Lazy params materialization

Capture params into fixed arrays during traversal and allocate object only on successful dynamic match return.

- Avoid per-lookup object shape churn when no dynamic params are used.
- Return monomorphic `RouteMatch` shape.

### 7) Optional custom syntax aliases (backward compatible)

Add opt-in short-hands that compile to specialized validators, while still accepting regex syntax.

Examples:

- `:id#int`
- `:slug#slug`
- `:locale#locale`
- `:id#uuid`

These are an authoring convenience only; not required for compatibility.

## Why Remove Runtime Rebalancing

Given startup-only registration and throughput-first objectives:

- Runtime mutation harms predictability and adds write overhead.
- Offline/static ordering from corpus statistics is enough.
- Immutable lookup structures simplify monomorphism and JIT optimization.

For v2, all route ordering decisions happen at compile/startup time.
This applies to the new v2 engine only; the existing router remains unchanged for comparison.

## Performance Hypotheses to Validate

1. Flat-array matcher beats object-graph trie under low-locality traffic.
2. Method-specialized loops beat generalized method dispatch.
3. Specialized regex scanners reduce regex engine overhead on common segment patterns.
4. Lazy params object creation reduces allocations/GC pressure.
5. First-segment bucketing materially lowers average fanout and branch misses.

## Iterative Implementation Plan (Perf-Gated)

Each step must be benchmarked against previous commit and only kept if it improves balancing-router throughput.

### Step 0: Baseline and profiling

- Build and run baseline compare.
- Capture profile focused on balancing-router with production-like corpus.
- Record baseline `hz`, `rme`, and hot functions.
- Baseline must continue to include the existing router as control.

### Step 1: Introduce route compiler + IR (no behavior change)

- Add parser/IR emission path while preserving current matcher behavior.
- Verify full test parity.
- Benchmark to ensure no regression before switching runtime.
- Land compiler/IR in v2-specific modules; no replacement of current router.

### Step 2: Method-specialized immutable matcher skeleton

- Implement per-method matcher entrypoints.
- Remove runtime rebalancing from timed lookup path.
- Benchmark and profile.
- Rebalancing removal is scoped to v2 implementation only.

### Step 3: Flat-array node/edge storage

- Port from object-node traversal to index-based traversal.
- Keep semantics identical.
- Benchmark and profile.

### Step 4: Common regex specialization

- Add detector + specialized segment validators.
- Keep fallback to `RegExp` for unsupported patterns.
- Benchmark with regex-heavy corpus routes.

### Step 5: Lazy params materialization

- Move param capture to fixed buffers.
- Allocate params object only on successful dynamic match.
- Benchmark GC behavior and throughput.

### Step 6: First-segment bucketing and dynamic selectivity ordering

- Pre-bucket routes by first segment.
- Order dynamic checks by compile-time selectivity heuristics.
- Benchmark under shuffled production corpus.

### Step 7: Optional custom syntax aliases

- Add parser support for shorthand validators.
- Confirm backwards compatibility with existing route patterns.
- Benchmark to validate authoring-level gains where aliases are adopted.

### Step 8: Side-by-side validation and adoption gate

- Run full benchmark/test matrix with both routers.
- Keep v2 as opt-in until it demonstrates consistent throughput wins with semantic parity.

## Benchmark and Profiling Discipline

- Use static URL corpus derived from route `count` weights.
- Use low-locality shuffled order as primary workload.
- Track `hz`, `rme`, and sample count for each step.
- If `rme` is high, increase bench time before deciding.
- Keep each win as a separate commit; revert regressions immediately.

## Risks and Mitigations

- Risk: semantic drift during compiler transition.
  - Mitigation: parity tests and dual-run checks (old vs new matcher) during migration.

- Risk: regex specialization changes edge-case behavior.
  - Mitigation: strict fallback to original regex on any uncertain specialization.

- Risk: code complexity increases.
  - Mitigation: keep IR explicit, document invariants, and isolate match engine modules.

## Definition of Success for v2

- Higher balancing-router throughput on production-like shuffled corpus.
- No functional regression versus existing route semantics.
- Runtime lookup path is immutable, method-specialized, and free of rebalancing.
- Regex-in-segment compatibility retained with optional fast-path specialization.
