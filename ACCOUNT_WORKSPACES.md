# Your workspace and saved skills

## Website preview

Sign in at [steelai.dev](https://steelai.dev/), then choose **My workspace** in your developer account. You can create, save and reopen private workflow draft definitions. The preview allows five drafts, up to8KB each and32KB total, with30 saves per day. A draft is data, not an approved executable workflow. Hosted workflow execution and model calls remain disabled.

The server derives the workspace from your verified Firebase identity. Selecting a workflow ID, adding a UID to JSON, or changing a URL does not grant another account's workspace. Signing out clears the browser's draft state. If a save conflicts with another revision, your unsaved text stays available until you choose to reopen the saved version.

## Local development

The ordinary local Steel server is one workspace. Everyone authorized to use that same server uses its skill pool and CBR records. Separate data directories mean separate workspaces. Installing the connector on your computer does not change where a server saves a generated skill: accepted capabilities belong to the workspace handling the request.

The skill picker hides starter examples by default. Choose **Show starter examples** to browse them; an example already pinned in a workflow remains visible. This is a display choice, not an account-isolation mechanism.

## Account-isolated runtime

The private account-mode server supports separate databases, skills/CBR, workflows, runs, templates, checkpoints and connector jobs for each verified, provisioned account. It checks Firebase revocation and uses account-bound connector credentials. New account libraries start empty; there is no automatic sharing or shared CBR learning pool.

Account mode is a private-server integration, separate from the hosted website preview. The client reads the runtime mode before opening Creator or Runner. An account runtime requires Firebase email-link sign-in and server confirmation that the account is provisioned. Account changes clear editor, request-cache and document-preview state; late responses from a previous session are discarded. Tokens stay in memory and are not saved in browser storage. Reloading requires sign-in again. Unsaved account edits are not restored from local browser drafts. Save changes to the server before leaving.

The server owner must configure the public Firebase web settings and an authorized application domain. The email-link return URL must be the same origin at `/app/`. A localhost development origin is not automatically authorized in Firebase; do not disable authentication to get around this requirement. The ordinary local runtime uses explicit local mode and retains local draft recovery. Ask your server owner for supported access and use the [provider guide](packages/connector/MUSE_PROVIDER.md) for model setup.

The restricted interpreter, database and native editor implementations remain private. Account separation does not itself provide process/container isolation for untrusted code; hosted execution stays off until its additional runtime gates pass.

## Hosted website session integration

The client supports an opt-in session-cookie runtime mode. The website exchanges a recent verified owner login for a one-hour Secure, HttpOnly, SameSite=Strict Firebase session cookie; browser JavaScript cannot read that credential. Creator checks the website session and the private runtime workspace before mounting. Cookie mutations require same-origin requests and a CSRF header. Waitlist accounts cannot acquire an owner session or open the runtime preview. Local/private bearer sign-in remains available separately.

This integration is currently reviewed source and isolated-test functionality. It does not establish a live hosted execution service. The execution host/gateway and full signed-in browser walkthrough remain pending.
