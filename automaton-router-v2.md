# Automaton Router v2

## Objective

Design a new router architecture that compiles route definitions into an automaton-like runtime form (DAG/state machine), optimized for throughput under low-locality production traffic.

Implementation must be additive: keep the existing router and tooling intact, and introduce this as a new router in `src/` for side-by-side validation.

## Why Automaton-Based Routing

Current trie/object traversal incurs pointer chasing, polymorphism, and per-lookup branching overhead. A compiled automaton can shift work to startup and run lookups as a tight, monomorphic state-machine loop over segment input.

Expected wins:

- Better cache locality from contiguous tables.
- Fewer unpredictable branches in hot path.
- Centralized global optimization (prefix sharing, state merging).
- Clear method specialization (`GET` automaton, etc.).

## Compatibility Requirements

- Preserve current route semantics, including regex-in-segment support.
- Build once at startup; no runtime route registration.
- No runtime rebalancing.
- Throughput prioritized over memory.
- Existing router must remain available and unchanged as the control implementation.

## High-Level Model

Compile routes into a segmented automaton:

- Input alphabet: path segments (between `/`), not characters.
- States represent positions in route-matching progress.
- Transitions represent segment match rules:
  - `LITERAL("users")`
  - `TYPE(INT)` or other specialized predicates
  - `REGEX(index)` fallback predicate
  - `WILDCARD_REST(name)` consuming remaining segments
- Accept states map to route handlers + param binding metadata.

Each HTTP method has its own automaton; wildcard method (`*`) has a separate automaton used as fallback.

## Core Runtime Data Structures

Use flat arrays (SoA style) for locality and monomorphic access.

- `stateFirstEdge: Int32Array`
- `stateEdgeCount: Int32Array`
- `stateAcceptIndex: Int32Array` (`-1` for non-accept)
- `edgeType: Uint8Array` (`literal`, `type`, `regex`, `wildcard`)
- `edgeNextState: Int32Array`
- `edgeDataIndex: Int32Array` (points into literal/type/regex tables)
- `acceptHandlerIndex: Int32Array`
- `acceptParamPlanIndex: Int32Array`

Auxiliary tables:

- `literalPool: string[]`
- `regexTable: RegExp[]`
- `typeValidatorTable: Function[]` (specialized scanners)
- `paramPlanTable` describing capture slot -> param name mapping

## Repository Integration Strategy

Implement this as a parallel engine under `src/`:

- Keep current router implementation as-is.
- Add new files for the automaton router (for example `src/automaton-router.ts` and `src/automaton-compiler.ts`).
- Export a dedicated factory (for example `createAutomatonRouter`) without changing current `createRouter` behavior.
- Reuse the existing bench harness and route generation tooling by selecting router implementation via CLI/env switch.
- Keep tests split into:
  - shared behavior tests reused by both routers
  - engine-specific tests for compiler/runtime internals

This allows experimentation without destabilizing baseline performance or developer workflow.

## Matching Loop

Given `method` and `path`:

1. Select method automaton (then `*` fallback if needed).
2. Segment-scan `path` once into reusable view/array.
3. Run state machine per segment:
  - Check literal transitions first.
  - Check typed predicate transitions.
  - Check regex transitions.
  - Handle wildcard-rest transitions.
4. On accept state, construct `RouteMatch`.
5. Materialize params lazily only if captures exist.

Design target: monomorphic loop with stable array accesses and minimal object allocation.

## Route Compilation Pipeline

### Phase 1: Parse

Parse each route pattern into segment tokens:

- Static token
- Param token (optional regex constraint)
- Wildcard token (`*`, `:name*`)
- Optional segment expansions
- Alternation expansions already supported by route patterns

### Phase 2: Normalize and Expand

- Expand optional segments into explicit variants.
- Preserve route specificity ordering metadata.

### Phase 3: Specialize Constraints

Recognize common regex forms and map to typed validators:

- `\\d+` -> `TYPE_INT`
- `[a-zA-Z]+` -> `TYPE_ALPHA`
- `[a-z0-9-]+` -> `TYPE_SLUG`
- `[a-z]{2}-[A-Z]{2}` -> `TYPE_LOCALE`
- UUID canonical -> `TYPE_UUID`

Fallback: keep exact `RegExp` for non-specializable constraints.

### Phase 4: Build NFA-like graph

- Build graph from token sequences.
- Annotate capture operations for param segments.

### Phase 5: Determinize (Hybrid)

- Determinize static and typed transitions aggressively.
- Keep regex-heavy ambiguity as bounded NFA side paths to avoid state explosion.

Result: hybrid DFA/NFA segmented automaton.

### Phase 6: Freeze to Table Form

- Emit immutable typed-array tables and side pools.
- Emit method-specialized automata.

## Capture Strategy (Params)

Avoid per-step object writes.

- Maintain capture slots (`values[]`) during match.
- Each transition can write a slot index.
- Accept state references `paramPlan` to map slots to names.
- Build params object only for successful match with captures.

This keeps non-param routes allocation-free on hot path.

## Regex-in-Segment Handling

Three-tier strategy:

1. Specialized typed scanner (fastest)
2. Lightweight prefilter checks (length/char-class hints)
3. Full `RegExp.test` fallback

Important: fallback preserves exact semantics.

## Optional Authoring Syntax (Backward Compatible)

Support custom aliases for common patterns:

- `:id#int`
- `:slug#slug`
- `:locale#locale`
- `:id#uuid`

Parser maps aliases directly to typed validators. Existing regex form remains fully supported.

## Complexity and Risks

### Benefits

- Stronger throughput potential under low-locality workloads.
- Better branch predictability and cache locality.
- Clean separation of compile-time vs runtime work.

### Risks

- Compiler complexity is significantly higher.
- Hybrid determinization logic can be subtle.
- Route debugging/introspection requires dedicated tooling.

### Mitigations

- Build dual-engine parity tests (current router vs automaton router).
- Keep strict fallback for all uncertain regex optimizations.
- Add compiler diagnostics output (state count, edge count, regex fallback count).

## Implementation Plan (Perf-Gated)

Each step is a separate commit and must beat or match previous benchmark before keeping.

1. Baseline and profiling
- Record `bench:compare` baseline and 30s profile hotspot snapshot.
- Baseline must continue to reference the current router implementation.

2. Add parser + IR layer
- Route tokens + normalized variants + constraint specialization metadata.
- No runtime behavior switch yet.
- Land in new automaton-specific modules only.

3. Build segmented NFA prototype
- Compile IR into graph representation.
- Implement reference matcher for correctness.
- Expose via a new factory in `src/` and keep old factory untouched.

4. Introduce hybrid determinization
- Determinize static/typed transitions.
- Keep regex side paths nondeterministic where needed.

5. Emit flat immutable tables
- Convert graph to typed arrays and pool tables.
- Replace object-heavy traversals in hot path.

6. Method-specialized entrypoints
- Per-method automata + wildcard fallback.
- Remove runtime rebalancing path from matching.
- This removal applies to the new automaton router only; existing router API/behavior stays available.

7. Lazy params materialization
- Capture slots and accept-time params object construction.

8. Typed validator fast-paths
- Add optimized scanners for common regex classes.
- Ensure strict regex fallback parity.

9. Optional alias syntax
- Parse and compile custom shorthand validators.

10. Stabilize and harden
- Extend tests for edge cases, wildcard precedence, regex captures, optional segments.
- Benchmark matrix (sync/async, static corpus, low-locality shuffled).
- Maintain side-by-side benchmark results for both routers throughout.

## Benchmark Protocol for This Track

- Use current production-weighted static URL corpus.
- Prioritize low-locality shuffled traffic.
- Measure `hz`, `rme`, sample count.
- Increase bench duration if `rme` is high.
- Reject regressions immediately.
- Always benchmark both:
  - existing router (control)
  - automaton router (candidate)

## Success Criteria

- Throughput improvement over current router on production-like corpus.
- No functional regression in route semantics.
- Runtime matcher is immutable, method-specialized, and rebalancing-free.
- Regex-in-segment compatibility fully preserved.

## Recommended First Prototype Scope

To reduce risk, first prototype should support:

- Static segments
- Named params
- Named wildcard
- Common typed validators
- Regex fallback (no full regex automata conversion)

Then incrementally add hybrid determinization and deeper regex optimizations once parity is proven.
