# Your workspace and saved skills

## Website preview

Sign in at [steelai.dev](https://steelai.dev/), then choose **My workspace** in your developer account. You can create, save and reopen private workflow draft definitions. The preview allows five drafts, up to8KB each and32KB total, with30 saves per day. A draft is data, not an approved executable workflow. Hosted workflow execution and model calls remain disabled.

The server derives the workspace from your verified Firebase identity. Selecting a workflow ID, adding a UID to JSON, or changing a URL does not grant another account's workspace. Signing out clears the browser's draft state. If a save conflicts with another revision, your unsaved text stays available until you choose to reopen the saved version.

## Local development

The ordinary local Steel server is one workspace. Everyone authorized to use that same server uses its skill pool and CBR records. Separate data directories mean separate workspaces. Installing the connector on your computer does not change where a server saves a generated skill: accepted capabilities belong to the workspace handling the request.

The skill picker hides starter examples by default. Choose **Show starter examples** to browse them; an example already pinned in a workflow remains visible. This is a display choice, not an account-isolation mechanism.

## Account-isolated runtime

The private account-mode server supports separate databases, skills/CBR, workflows, runs, templates, checkpoints and connector jobs for each verified, provisioned account. It checks Firebase revocation and uses account-bound connector credentials. New account libraries start empty; there is no automatic sharing or shared CBR learning pool.

Account mode is a private-server integration, not the current hosted website runtime. The ordinary Creator client has no account sign-in integration yet and must not be presented as private account mode. Shared hosting requires account-aware authentication and cache clearing as well as the server boundary. Ask your server owner for supported access and use the [provider guide](packages/connector/MUSE_PROVIDER.md) for model setup.

The restricted interpreter, database and native editor implementations remain private. Account separation does not itself provide process/container isolation for untrusted code; hosted execution stays off until its additional runtime gates pass.
