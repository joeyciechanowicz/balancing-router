# balancing-router

Trie-based HTTP router with adaptive rebalancing. It supports Express-style path patterns and full RegExp routes, and tracks match frequency so you can reorder hot paths via `rebalance()`.

## API

### `createRouter(): Router`

Creates a new router instance.

### `createRouterParser(options?): RouterParserSetup`

Creates an opt-in compiled parser setup. Register routes with `add(...)`, then call `compile()` to build a matcher router.

```js
import { createRouterParser } from "balancing-router";

const setup = createRouterParser({ mode: "generated" });
setup.add("GET", "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved", () => {});
const router = setup.compile();
const match = router.find("GET", "/catalog/en-US/saved");
```

Options:
- `mode: "generated" | "interpreted"` (default `"generated"`)

### `router.on(method, path, handler, store?)`

Register a handler for one or more HTTP methods.

- `method`: string (e.g. `"GET"`) or array of strings. `"*"` registers a method wildcard.
- `path`: string route pattern or a `RegExp`.
- `handler`: `(req, res, params) => any`.
- `store`: optional metadata attached to the route, returned in matches.

### `router.find(method, path): RouteMatch | null`

Find a matching route. Returns `null` when there is no match.

`RouteMatch` shape:

- `handler`: the registered handler
- `params`: captured parameters (empty object when none)
- `store`: optional metadata passed to `on`

### `router.rebalance(): void`

Reorders dynamic branches (params, wildcards, regex routes) by observed hit counts. Call this either on an interval or after a given number of requests.

## Path Patterns

- Static: `/users`
- Params: `/users/:id` → `{ id: "42" }`
- Param with regex: `/orders/:id(\\d+)` → only digits
- Wildcard: `/files/*` → `{ "*": "a/b/c" }`
- Named wildcard: `/assets/:path*` → `{ path: "css/app.css" }`
- Regex routes: `/^\\/api\\/v\\d+\\/health$/`

Notes:

- Methods are case-insensitive and trimmed.
- Paths are normalized to start with `/`.
- If a method-specific route and a `"*"` method route both match, the specific method wins.

## Usage

```js
import { createRouter } from "balancing-router";
import http from "node:http";

const router = createRouter();

router.on("GET", "/users/:id", (req, res, params) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: params.id }));
});

router.on(["GET", "POST"], /^\/api\/v\d+\/health$/, (req, res) => {
  res.writeHead(204);
  res.end();
});

const server = http.createServer((req, res) => {
  const match = router.find(req.method ?? "GET", req.url ?? "/");
  if (!match) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  match.handler(req, res, match.params);
});

server.listen(3000);
```

## Development

- Build: `npm run build`
- Tests: `npm test`
- Benchmarks: `npm run bench`
- Compare to previous commit: `npm run bench:compare`
- Benchmarks replay a prebuilt, shuffled URL corpus generated from per-route `count` values in `bench/routes.mjs`.
- Rebalancing (for `balancing-router`) happens in warmup only, not during timed measurement.
