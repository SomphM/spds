import test from 'node:test';
import assert from 'node:assert/strict';
import { filters,matches,summarize,dateBounds,localDay } from '../src/domain.js';
import { hashPassword,verifyPassword } from '../src/auth.js';
import { createApp } from '../src/server.js';
test('filters reject malformed statuses and dates and enforce inclusive Laos days',()=>{
  assert.throws(()=>filters({status:'unknown'}));assert.throws(()=>filters({from:'2026-02-30'}));assert.throws(()=>filters({from:'2026-10-12',to:'2026-10-01'}));
  assert.equal(matches({CreatedAt:'2026-10-16T16:59:59Z',Status:'failed',CustomerPhone:'123',PackageName:'Data'},filters({from:'2026-10-16',to:'2026-10-16',status:'failed',search:'data',handle:'pending'})),true);
});
test('metrics distinguish purchase failure from operator resolution',()=>{
  const result=summarize([{CreatedAt:'2026-10-16',Status:'success',Channel:'APP'},{CreatedAt:'2026-10-16',Status:'failed',HandleStatus:'fixed',Channel:'APP'},{CreatedAt:'2026-10-17',Status:'failed',Channel:'USSD',FailReason:'Timeout'}]);
  assert.equal(result.total,3);assert.equal(result.failed,2);assert.equal(result.unresolved,1);assert.equal(result.trend.length,2);assert.equal(result.channels[0].count,2);assert.equal(summarize([]).successRate,0);
});
test('scrypt hashes verify and reject wrong passwords',async()=>{
  const {hash,salt}=await hashPassword('a long test password');const user={PasswordHash:hash,PasswordSalt:salt};assert.equal(await verifyPassword('a long test password',user),true);assert.equal(await verifyPassword('incorrect',user),false);
});
async function serve(t, options) { const app=await createApp(options);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return async(path,options)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,options);return {status:response.status,data:await response.json(),headers:response.headers};}; }
test('workbook demo: metrics, pagination, filter validation and handling round trip',async t=>{
  const request=await serve(t,{demo:true});
  const api=(path,options)=>request(path+(path.startsWith('/dashboard')||path.startsWith('/transactions?')||path==='/transactions'? (path.includes('?')?'&':'?')+'from=2020-01-01&to=2030-12-31':''),options);
  const summary=await api('/dashboard');assert.equal(summary.status,200);assert.equal(summary.data.total,1000);assert.equal(summary.data.success+summary.data.failed+summary.data.checking,1000);
  const off=await api('/transactions?autoRenew=off');
  assert.equal(off.data.total,summary.data.autoRenewOff);assert.ok(off.data.items.every(row=>row.AutoRenewOff));
  const failedOff=await api('/transactions?autoRenew=off&status=failed');
  assert.equal(failedOff.data.total,summary.data.failedAutoRenewOff);assert.ok(failedOff.data.items.every(row=>row.AutoRenewOff&&row.Status==='failed'));
  assert.equal((await api('/transactions?autoRenew=invalid')).status,400);
  assert.ok(summary.data.alerts.every(r=>r.Status==='failed'&&r.Message.trim().toLowerCase()!=='balance is not enough'));
  assert.ok(summary.data.alerts.length<=20);
  const reason=summary.data.failures[0];
  const reasonPage=await api('/transactions?status=failed&failureReason='+encodeURIComponent(reason.name));
  assert.equal(reasonPage.data.total,reason.count);
  assert.ok(reasonPage.data.items.every(row=>(row.FailReason||'Unspecified')===reason.name&&row.Status==='failed'));
  assert.equal((await api('/transactions?failureReason='+encodeURIComponent('x'.repeat(201)))).status,400);
  const result=await api('/transactions?status=failed&pageSize=5');assert.equal(result.data.items.length,5);assert.ok(result.data.items.every(r=>r.Status==='failed'));
  assert.equal((await api('/transactions?page=0')).status,400);assert.equal((await api('/dashboard?status=bogus')).status,400);
  const id=result.data.items[0].Id;
  const detail=await api('/transactions/'+id);assert.equal(detail.status,200);assert.equal(detail.data.Id,id);
  assert.equal((await api('/transactions/not-an-id')).status,400);
  assert.equal((await api('/transactions/999999999999')).status,404);
  assert.equal((await api(`/transactions/${id}/handling`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({handleStatus:'fixed'})})).status,200);
  const fixed=await api('/transactions?handle=fixed&pageSize=100');assert.ok(fixed.data.items.some(r=>r.Id===id&&r.isFixed===1));
  const last=await api('/transactions?page=40');assert.equal(last.data.items.length,25);assert.equal(last.data.total,1000);
  const beyond=await api('/transactions?page=41');assert.equal(beyond.data.items.length,0);assert.equal(beyond.data.total,1000);
  assert.equal((await api(`/transactions/${id}/handling`,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{"handleStatus":"pending"}'})).status,403);
});
test('SQL mode requires login and attributes handling changes to the session user',async t=>{
  const {hash,salt}=await hashPassword('test-password-123');let actor;
  const api=await serve(t,{store:{user:async()=>({Id:7,Username:'operator',PasswordHash:hash,PasswordSalt:salt}),update:async(id,status,user)=>{actor=user;return true;}}});
  assert.equal((await api('/transactions')).status,401);
  const login=await api('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"username":"operator","password":"test-password-123"}'});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await api('/transactions/1/handling',{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{"handleStatus":"fixed"}'})).status,200);assert.equal(actor,7);
  await api('/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});assert.equal((await api('/me',{headers:{Cookie:cookie}})).status,401);
});


test('default date uses Laos today; CreatedAt filtering uses database midnight',()=>{
  assert.equal(localDay('2026-10-15T16:59:59Z'),'2026-10-15');
  assert.equal(localDay('2026-10-15T17:00:00Z'),'2026-10-16');
  const f=filters({from:'2026-10-16',to:'2026-10-16'}), bounds=dateBounds(f);
  assert.equal(bounds.start.toISOString(),'2026-10-16T00:00:00.000Z');
  assert.equal(bounds.end.toISOString(),'2026-10-17T00:00:00.000Z');
  for(const [time,expected] of [['2026-10-15T23:59:59Z',false],['2026-10-16T00:00:00Z',true],['2026-10-16T23:59:59Z',true],['2026-10-17T00:00:00Z',false]])assert.equal(matches({CreatedAt:time},f),expected);
  assert.equal(filters({}).from,localDay());assert.equal(filters({}).to,localDay());
});


test('auto-renew signals count purchase flags and intersect correctly with failures',()=>{
  const rows=[{CreatedAt:'2026-10-16T03:00:00Z',Status:'failed',AutoRenewOff:1},{CreatedAt:'2026-10-16T03:00:00Z',Status:'success',AutoRenewOff:1},{CreatedAt:'2026-10-16T03:00:00Z',Status:'failed',AutoRenewOff:0}];
  const summary=summarize(rows);assert.equal(summary.autoRenewOff,2);assert.equal(summary.failedAutoRenewOff,1);
  const f=filters({from:'2026-10-16',to:'2026-10-16',autoRenew:'off',status:'failed'});
  assert.equal(rows.filter(row=>matches(row,f)).length,1);
  assert.throws(()=>filters({autoRenew:'invalid'}));
});


test('unresolved failures and work queue exclude insufficient balance and resolved purchases',()=>{
  const rows=[
    {Status:'failed',FailReason:' Balance Is Not Enough ',HandleStatus:'pending'},
    {Status:'failed',FailReason:'Timeout',HandleStatus:'pending'},
    {Status:'failed',FailReason:null,HandleStatus:null},
    {Status:'failed',FailReason:'Timeout',HandleStatus:'fixed'},
    {Status:'failed',FailReason:'Timeout',HandleStatus:'closing'},
    {Status:'success',FailReason:null,HandleStatus:'pending'}
  ].map(row=>({...row,CreatedAt:'2026-10-16T03:00:00Z'}));
  assert.equal(summarize(rows).unresolved,2);
  const f=filters({from:'2026-10-16',to:'2026-10-16',unresolvedOnly:'true'});
  assert.equal(rows.filter(row=>matches(row,f)).length,2);
  assert.throws(()=>filters({unresolvedOnly:'invalid'}));
});


test('marking fixed enables auto-renew on that purchase; pending preserves the flag',async()=>{
  const {createStore}=await import('../src/store.js');
  const store=await createStore(true),record=await store.transaction('1');
  record.AutoRenewOff=true;
  assert.equal(await store.update('1','fixed',7),true);
  assert.equal(record.AutoRenewOff,false);assert.equal(record.HandleStatus,'fixed');assert.equal(record.HandledByUserId,7);
  record.AutoRenewOff=true;
  await store.update('1','pending',7);assert.equal(record.AutoRenewOff,true);
  assert.equal(await store.update('99999999','fixed',7),false);
});


test('resolution report counts actual failed fixes and attributes the last handler',async()=>{
  const {createStore}=await import('../src/store.js');const store=await createStore(true);
  const failed=await store.transaction('1');Object.assign(failed,{Status:'failed',CreatedAt:new Date('2026-10-16T12:00:00Z'),HandleStatus:'pending'});
  const success=await store.transaction('2');Object.assign(success,{Status:'success',CreatedAt:new Date('2026-10-16T12:00:00Z')});
  await store.update('1','fixed',7);await store.update('2','fixed',7);
  const f=filters({from:'2026-10-16',to:'2026-10-16'}),report=await store.resolutions(f);
  assert.equal(report.fixed,report.operators.reduce((total,row)=>total+row.Fixed,0));
  assert.ok(report.items.some(row=>String(row.Id)==='1'&&row.HandledByUserId===7));
  assert.ok(!report.items.some(row=>String(row.Id)==='2'));
  assert.ok(report.operators.some(row=>row.UserId===7&&row.Fixed>=1));
  const empty=await store.resolutions(filters({from:'2000-01-01',to:'2000-01-01'}));assert.equal(empty.fixed,0);assert.equal(empty.totalFailed,0);
});
test('resolution endpoint validates dates and pagination',async t=>{
  const api=await serve(t,{demo:true});assert.equal((await api('/resolutions?page=0')).status,400);assert.equal((await api('/resolutions?from=2026-02-30')).status,400);
  const result=await api('/resolutions?from=2000-01-01&to=2000-01-01');assert.equal(result.status,200);assert.equal(result.data.fixed,0);assert.deepEqual(result.data.operators,[]);
});
