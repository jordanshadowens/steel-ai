# Custom workflow

Publish a workflow in Workflow Creator and give your developer key access to it. Replace the fields in `inputs.json` with the names and types the workflow declares.

```sh
npm run agent -- run --workflow YOUR_WORKFLOW_ID --version 1 --inputs examples/custom-workflow/inputs.json --request-id custom-workflow-001
```

Use the ID and version from `npm run agent -- list`. See [run a workflow](../../docs/workflows.md) for retrieving results.
