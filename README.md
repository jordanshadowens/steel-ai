# Steel AI

Building the foundation of your AI systems.

Public React/TypeScript Workflow Creator, Runner, template-authoring interface, and developer contracts. Redux Toolkit manages state/API access; Motion provides transitions.

## Develop

Requires Node.js 24+ and npm. Run `npm run setup`, `npm run check`, `npm test`, and `npm run build`. Run `npm --prefix UI run dev` and open the printed `/app/` URL. The dev proxy expects a separately licensed Steel runtime at `http://127.0.0.1:3100`, exposing `/api`.

This source builds the client. It is not a standalone engine or runtime installer. The server, interpreter, database/graph memory, capability acquisition/repair implementation and native Document/Spreadsheet/Presentation editors remain proprietary and are not bundled here. Without a runtime, data/run/approval/AI operations are unavailable; the UI reports that state. Template configuration forms are public; native editor implementations are excluded.

## Contracts

`packages/sdk/contracts.ts` exports API/workflow/template types under Apache-2.0. `UI/client/src/api/steelApi.ts` contains the application's typed API integration. Never put model credentials in browser code.

## License

Application source: AGPL-3.0-only. Standalone SDK contracts: Apache-2.0. See LICENSING.md and the full license texts. Third-party dependencies retain their own licenses; proprietary components are not licensed by this repository.

## JavaScript SDK

```js
import { SteelClient } from "@steel-ai/sdk";
const steel = new SteelClient({baseUrl: "http://127.0.0.1:3100/api"});
console.log(await steel.workflows());
```

SDK transport tests use synthetic response fixtures, not a live runtime.
