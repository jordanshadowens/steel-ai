# Hello world

In Workflow Creator, publish a workflow named `hello-world` with a string input called `name` and a string output called `greeting`. Give your developer key access to that workflow. See [authentication](../../docs/authentication.md).

```sh
npm run agent -- run --workflow hello-world --version 1 --inputs examples/hello-world/inputs.json --request-id hello-world-001
```

Use the ID and version from `npm run agent -- list` if yours differ. See [run a workflow](../../docs/workflows.md) for retrieving results.
