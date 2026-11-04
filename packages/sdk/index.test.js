import test from 'node:test';
import assert from 'node:assert/strict';
import {SteelClient} from './index.js';
test('preserves explicit inputs and safely encodes run identity', async () => {
  let seen;
  const client = new SteelClient({baseUrl:'http://localhost:3100/api/', fetchImpl:async(url,init) => {
    seen={url,init}; return {ok:true,status:200,json:async()=>({run_id:'synthetic',status:'sealed'})};
  }});
  await client.run({workflow_id:'example',version:2,inputs:{units:7}});
  assert.equal(seen.url,'http://localhost:3100/api/runs');
  assert.deepEqual(JSON.parse(seen.init.body),{workflow_id:'example',version:2,inputs:{units:7}});
  await client.getRun('a/b'); assert.ok(seen.url.endsWith('/runs/a%2Fb'));
});
test('does not include potentially sensitive server error bodies', async () => {
  const client = new SteelClient({baseUrl:'http://localhost/api',fetchImpl:async()=>({ok:false,status:403})});
  await assert.rejects(client.health(),/HTTP 403/);
});
