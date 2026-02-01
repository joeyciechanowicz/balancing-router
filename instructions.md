This is a novel request router to be used in Node HTTP applications. It supports express style routes as well as regexs.
Internally it converts everything to a trie (including splitting up regexs) and then when routing stores statistics so that at some interval it will balance and order all nodes in the trie to optimise for the highest traffic routes.

The project uses a benchmark driven approach where each change is automatically compared against the previous version. Additionally there are benchmarks against the current best routers for the JS ecosystem.

# Steps

## Step 1

Define the API for the route, with static types. These will be reused in each iteration

## Step 2

Create the tooling and benchmarks to allow an iterative implementation

## Step 3

Write the tests

## Step 4

Implement the router
