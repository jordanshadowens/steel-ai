# Run a workflow

Use Python 3 and complete the [quick start](quickstart.md). Put a workflow-scoped `steel_dev_` key in the root `.env` as `STEEL_AGENT_KEY`.

From the repository root, list the published workflows available to your key:

```sh
npm run agent -- list
```

Open an example for the [hello-world workflow](../examples/hello-world/README.md) or a [custom workflow](../examples/custom-workflow/README.md). Use the workflow ID and version from the list.

Read the run using the returned ID:

```sh
npm run agent -- get --run-id RETURNED_RUN_ID
```

Use the same request ID to retry the same submission. If the run is `pending_approval`, open Workflow Creator to handle the approval, then fetch the run again.
