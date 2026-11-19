# Authentication

## Sign in and create a key

1. Open [https://steelai.dev/signin](https://steelai.dev/signin) and enter the email address for your account.
2. Open the newest message in the same browser. The link works once. You land on [https://steelai.dev/dashboard](https://steelai.dev/dashboard).
3. Create an account key, copy the `steel_api_` value, and store it on the server that will call the API. The website shows it once.
4. Revoke a key from the dashboard when you no longer want it used. A new key does not replace an older one.

The website session is an HttpOnly cookie. Do not send it to `GET /api/v1/identity`. From PowerShell, paste the next command as a single line. A trailing `\` does not continue a line there, and `curl` is an alias for `Invoke-WebRequest`, so `-H` and `-d` are not accepted:

```powershell
Invoke-RestMethod -Method Post -Uri https://steelai.dev/api/dev-keys -Headers @{ Authorization = 'Bearer YOUR_ACCOUNT_KEY' } -ContentType 'application/json' -Body '{"workflowIds":["workflow-id"]}'
```

Call the identity route with the developer key that response returns:

```powershell
Invoke-RestMethod -Uri https://steelai.dev/api/v1/identity -Headers @{ Authorization = 'Bearer YOUR_DEVELOPER_KEY' }
```

Those two names are placeholders. `https://steelai.dev` issues the keys. `https://api.steelai.dev` is the cloud runtime those keys call.


## Configure local credentials

Copy `.env.example` to `.env` at the repository root. Keep the file local.

- Use your browser session when working in the web app.
- Set `STEEL_AGENT_KEY` to a workflow-scoped `steel_dev_` key for the developer CLI.
- Set `STEEL_API_KEY` to the connector key issued by your runtime operator. The connector endpoint must speak `steel-connector/1`.
- Set `STEEL_PROVIDER_KEY` only when the model endpoint requires a credential. It authenticates to the model provider.
