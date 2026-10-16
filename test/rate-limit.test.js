import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse,throttleMessage } from '../public/api-response.js';
import { createApp } from '../src/server.js';

test('API client handles text throttling and HTML errors without JSON syntax errors',async()=>{
  await assert.rejects(readApiResponse(new Response('Too many requests, please try again later.',{status:429})),{message:throttleMessage,status:429});
  await assert.rejects(readApiResponse(new Response('<html>Bad Gateway</html>',{status:502})),{message:'Request failed',status:502});
  await assert.rejects(readApiResponse(new Response('not JSON',{status:200})),{message:'Invalid server response. Please refresh and try again.'});
  assert.deepEqual(await readApiResponse(Response.json({ok:true})),{ok:true});
});
test('login limiter returns JSON and Retry-After after ten invalid sign-ins',async t=>{
  const app=await createApp({store:{user:async()=>undefined}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/login`;
  for(let i=0;i<10;i++){
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"username":"unknown","password":"wrong"}'});
    assert.equal(response.status,401);await response.json();
  }
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"username":"unknown","password":"wrong"}'});
  assert.equal(response.status,429);assert.match(response.headers.get('content-type'),/application\/json/);
  assert.ok(Number(response.headers.get('retry-after'))>0);
  assert.equal((await response.json()).error,throttleMessage);
  assert.equal(response.headers.get('cache-control'),'no-store');
});
