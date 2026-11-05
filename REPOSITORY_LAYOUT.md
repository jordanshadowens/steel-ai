# Public developer-machine setup

This repository (`jordanshadowens/steel-ai`) contains the code customers install on their own developer machines. It does not contain the private AI runtime or the hosted website's server.

| Location | Purpose |
| --- | --- |
| `UI/` | Browser client for an authorized runtime |
| `packages/sdk/` | Client SDK and external contracts |
| `packages/connector/` | Outbound local-model connector |
| `INSTALL.md`, `ACCOUNT_WORKSPACES.md` | Customer installation and account connection instructions |
| `.github/workflows/` | Checks for this public client repository |

The private `steel-ai-core` repository owns the AI system, execution, approval enforcement, storage, interpreter, operator agents, hosted portal and website publishing. Public clients use documented interfaces; they must not import or bundle private server implementation. A website status-test key, model connector key and workflow-agent key have different permissions and are not interchangeable.

The public checkout is not a hosted runtime. Customers need an explicitly provisioned endpoint and credentials from the operator. Local connector installation does not grant server access. Never copy `.env`, registry files, credentials, account databases, evidence packets or publisher journals into this repository.

For operator development on Dadcomputer, clean canonical checkouts live beside each other under `C:\Kalshi\Steel\steel-ai` (public) and `C:\Kalshi\Steel\steel-ai-core` (private). These operator paths are not customer installation requirements. Older working directories are preserved until their changes have been reviewed and migrated; do not bulk-copy their contents or discard their edits.
