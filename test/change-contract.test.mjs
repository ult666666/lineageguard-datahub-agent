import test from 'node:test';
import assert from 'node:assert/strict';
import {runLineageGuard} from '../src/agent.mjs';
import {analyzeImpact} from '../src/impact-engine.mjs';

const dataset = {urn:'urn:test:orders',name:'warehouse.orders',owner:'Data',downstream:[],tags:[],weeklyQueries:0};
const add = {kind:'add',field:'campaign_code',type:'VARCHAR',required:false};
function request(change = add) {
  let reads = 0;
  return {input:{datasetUrn:dataset.urn,changeRequest:{changes:[change]},
    catalog:{mode:'mock-datahub-snapshot',getDataset:async()=>{reads++;return dataset;}}},reads:()=>reads};
}
async function refusedBeforeRead(change, pattern) {
  const r=request(change);
  await assert.rejects(()=>runLineageGuard(r.input), pattern);
  assert.equal(r.reads(),0,'invalid input must not query a catalog');
}

test('rejects unknown schema operations instead of assigning a low default risk',async()=>{
  await refusedBeforeRead({...add,kind:'unrecognized_operation'},/change.kind/);
});
test('requires a real boolean for required and nullable changes',async()=>{
  await refusedBeforeRead({...add,required:'false'},/change.required/);
  await refusedBeforeRead({kind:'nullable',field:'campaign_code',to:'false'},/change.to/);
});
test('rejects identifiers that the SQL generator would silently rewrite',async()=>{
  await refusedBeforeRead({...add,field:'campaign-code'},/change.field/);
  await refusedBeforeRead({kind:'rename',field:'campaign_code',to:'new code'},/change.to/);
});
test('rejects statements and comments in generated SQL type positions',async()=>{
  for(const type of ['VARCHAR; SELECT 1; --','VARCHAR /* note */','TEXT\nSELECT 1']) {
    await refusedBeforeRead({...add,type},/change.type/);
  }
});
test('rejects malformed change entries before any metadata request',async()=>{
  for(const value of [null,[],{},'drop']) await refusedBeforeRead(value,/change/);
});
test('bounds change count and dataset identifier before catalog access',async()=>{
  const r=request();r.input.changeRequest.changes=Array.from({length:101},()=>({...add}));
  await assert.rejects(()=>runLineageGuard(r.input),/changes/);assert.equal(r.reads(),0);
  const s=request();s.input.datasetUrn={urn:'urn:test:orders'};
  await assert.rejects(()=>runLineageGuard(s.input),/datasetUrn/);assert.equal(s.reads(),0);
});
test('valid scalar and parameterized types keep the normal review working',async()=>{
  for(const type of ['VARCHAR','DECIMAL(12,2)','TIMESTAMP','DOUBLE PRECISION']) {
    const r=request({...add,type});const result=await runLineageGuard(r.input);
    assert.equal(r.reads(),1);assert.equal(result.decision,'proceed-with-checks');
    assert.match(result.migrationSql,/ADD COLUMN campaign_code/);
  }
});
test('validates direct impact-engine calls, not only the API orchestration',()=>{
  assert.throws(()=>analyzeImpact({dataset,changes:[{...add,required:1}]}),/change.required/);
});
test('rejects unsafe catalog table names before creating SQL suggestions',()=>{
  assert.throws(()=>analyzeImpact({dataset:{...dataset,name:'orders; SELECT 1'},changes:[add]}),/dataset.name/);
});
test('preserves accepted request and catalog inputs without mutation',async()=>{
  const r=request();const before=JSON.stringify(r.input.changeRequest);
  await runLineageGuard(r.input);
  assert.equal(JSON.stringify(r.input.changeRequest),before);
  assert.equal(dataset.name,'warehouse.orders');
});

test('validates inherited optional values read by direct-library SQL generation',()=>{
  for (const inherited of [{type:'VARCHAR; SELECT 1; --'}, {required:'false'}]) {
    const change=Object.assign(Object.create(inherited), {kind:'add',field:'campaign_code'});
    assert.throws(()=>analyzeImpact({dataset,changes:[change]}),/change\.(type|required)/);
  }
});

test('uses a single validated snapshot when a direct caller supplies an accessor',()=>{
  let reads=0;
  const change={kind:'add',field:'campaign_code',get type(){reads++;return reads===1?'VARCHAR':'VARCHAR; SELECT 1; --';}};
  const result=analyzeImpact({dataset,changes:[change]});
  assert.equal(reads,1);
  assert.match(result.migrationSql,/ADD COLUMN campaign_code VARCHAR;/);
  assert.doesNotMatch(result.migrationSql,/SELECT 1/);
});
test('catalog await cannot change the already validated input request',async()=>{
  const change={...add};
  const r=request(change);
  r.input.catalog.getDataset=async()=>{change.type='VARCHAR; SELECT 1; --';return dataset;};
  const result=await runLineageGuard(r.input);
  assert.match(result.migrationSql,/ADD COLUMN campaign_code VARCHAR;/);
  assert.doesNotMatch(result.migrationSql,/SELECT 1/);
  assert.equal(result.request.changes[0].type,'VARCHAR');
});
