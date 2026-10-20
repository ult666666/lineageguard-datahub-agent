import test from 'node:test';
import assert from 'node:assert/strict';
import {DataHubMcpClient, extractToolJson} from '../src/datahub-mcp-client.mjs';
import {MockCatalogAdapter} from '../src/catalog-adapter.mjs';

const json = body => new Response(JSON.stringify(body), {headers:{'content-type':'application/json'}});
const client = (fn, extra={}) => new DataHubMcpClient({url:'http://127.0.0.1:9999/mcp',fetchImpl:fn,...extra});

test('MCP rejects a response belonging to another request', async()=>{
 const c=client(async()=>json({jsonrpc:'2.0',id:999,result:{ok:true}}));
 await assert.rejects(c.request('ping'), /identity|ID/i);
});
test('MCP requires an exact JSON-RPC result envelope', async()=>{
 for(const value of [{id:1,result:{}},{jsonrpc:'2.0',id:1},{jsonrpc:'2.0',id:1,result:{},error:{code:1}}]){
  await assert.rejects(client(async()=>json(value)).request('ping'));
 }
});
test('MCP rejects error-marked structured and text tool data',()=>{
 assert.throws(()=>extractToolJson({isError:true,structuredContent:{name:'not-evidence'}}),/tool/i);
 assert.throws(()=>extractToolJson({isError:true,content:[{type:'text',text:'{"name":"not-evidence"}'}]}),/tool/i);
});
test('MCP accepts structured tool results without needing a text duplicate',()=>{
 assert.deepEqual(extractToolJson({structuredContent:{count:0},isError:false}),{count:0});
});
test('MCP does not expose remote error text in its public error message',async()=>{
 await assert.rejects(client(async()=>new Response('SYNTHETIC_PRIVATE_CANARY',{status:500})).request('ping'),e=>!e.message.includes('CANARY'));
 await assert.rejects(client(async()=>json({jsonrpc:'2.0',id:1,error:{code:1,message:'SYNTHETIC_PRIVATE_CANARY'}})).request('ping'),e=>!e.message.includes('CANARY'));
});
test('MCP does not negotiate an unimplemented protocol era',async()=>{
 const c=client(async(_url,options)=>{const p=JSON.parse(options.body);return json({jsonrpc:'2.0',id:p.id,result:{protocolVersion:'2026-07-28',capabilities:{tools:{}}}});});
 await assert.rejects(c.initialize(),/version|profile/i);
});
test('MCP refuses catalog mutation tools before any network request',async()=>{
 let calls=0;const c=client(async()=>{calls++;return json({});});
 await assert.rejects(c.callTool('delete_entity',{urn:'synthetic'}),/allow|read.only/i);
 assert.equal(calls,0);
});
test('MCP timeout and cancellation also bound a noncooperative injected fetch',async()=>{
 const c=client(()=>new Promise(()=>{}),{timeoutMs:25});
 await assert.rejects(c.request('ping'),/timeout|deadline/i);
 const controller=new AbortController();controller.abort();
 await assert.rejects(c.request('ping',undefined,false,{signal:controller.signal}),/abort|cancel/i);
});
test('MCP limits successful response bytes',async()=>{
 const c=client(async()=>json({jsonrpc:'2.0',id:1,result:{text:'x'.repeat(5000)}}),{maxResponseBytes:1024});
 await assert.rejects(c.request('ping'),/limit|large/i);
});
test('MCP rejects userinfo and insecure non-loopback URLs',()=>{
 assert.throws(()=>client(async()=>json({}),{url:'http://example.com/mcp'}));
 assert.throws(()=>client(async()=>json({}),{url:'https://user:password@example.com/mcp'}));
});
test('mock catalog never substitutes a different dataset for an unknown target',async()=>{
 await assert.rejects(new MockCatalogAdapter().getDataset('urn:li:dataset:unknown'),/target|dataset|found/i);
});
