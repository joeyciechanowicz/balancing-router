A novel and new type of HTTP router which leans on the learnings of compiler theory to deliver incredible performance.

Instead of creating a trie, or other data structure, it will compile the routes in path-regex form into a parser which can then be executed to match routes. We could first use `eval` and if the performance is good, look at a full compiler.

Example syntax could, but doesn't have to, look like this

```ts
const setup = createRouterParser({});
setup.add(
  "get",
  "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved",
  requestHandler1,
);
setup.add(
  "get",
  "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/sites/:siteId/items/:itemId",
  requestHandler2,
);
setup.add(
  "get",
  "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/offers",
  requestHandler3,
);
setup.add(
  "post",
  "/(catalog|portal)/:locale([a-z]{2}-[A-Z]{2})?/saved",
  requestHandler4,
);

const router = setup.compile();
```

The key idea with this approach is we end up with something that can be executed and JIT'd by the V8 runtime.

We should also consider the HTTP method at the final point of matching, meaning the following two routes do exactly the same matching and only perform a different check the HTTP method once they've matched a route.
