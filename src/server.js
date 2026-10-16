import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { verifyPassword } from './auth.js';
import { filters, handles } from './domain.js';
import { closeDatabase } from './db.js';
export async function createApp({ demo = false, store } = {}) {
  store ||= await createStore(demo);
  const app = express(), sessions = new Map();
  app.disable('x-powered-by'); app.use(helmet()); app.use(express.json({ limit: '8kb' }));
  const sweep = setInterval(() => { for (const [id,s] of sessions) if (s.expires < Date.now()) sessions.delete(id); }, 60000); sweep.unref();
  app.use('/api', (req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  const throttled = (req,res) => res.status(429).json({ error:'Too many requests. Please wait before trying again.' });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders:'draft-8', legacyHeaders:false, handler:throttled }));
  app.get('/api/health', (req,res)=>res.json({ status: 'ok', mode: demo ? 'demo' : 'sqlserver' }));
  app.post('/api/login', rateLimit({ windowMs: 900000, limit: 10, standardHeaders:'draft-8', legacyHeaders:false, handler:throttled,
    skipSuccessfulRequests:true, requestWasSuccessful:(req,res)=>res.statusCode!==401 }), async (req,res) => {
    if (demo) return res.status(400).json({ error: 'Demo mode does not require login' });
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || username.length > 50 || typeof password !== 'string' || password.length > 200) return res.status(400).json({ error: 'Invalid credentials' });
    const user = await store.user(username);
    if (!user || !await verifyPassword(password,user)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { user: { Id:user.Id, name:user.DisplayName || user.Username }, expires:Date.now()+8*3600000 });
    res.cookie('tplus_session',token,{ httpOnly:true, sameSite:'strict', secure:process.env.NODE_ENV==='production', maxAge:8*3600000, path:'/' }); res.json({ ok:true });
  });
  app.use('/api', (req,res,next)=> {
    // Same-origin JSON mutations, together with SameSite cookies, prevent cross-site writes.
    if (['POST','PATCH','DELETE'].includes(req.method) && (!req.is('application/json') || (req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`))) return res.status(403).json({ error:'Same-origin JSON request required' });
    if (demo) { req.user={Id:null,name:'Demo operator'}; return next(); }
    const token = req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('tplus_session='))?.slice(14);
    const session=sessions.get(token);
    if (!session || session.expires < Date.now()) return res.status(401).json({error:'Please sign in'});
    req.user=session.user; req.token=token; next();
  });
  app.get('/api/me',(req,res)=>res.json({user:req.user,mode:demo?'demo':'sqlserver'}));
  app.post('/api/logout',(req,res)=>{sessions.delete(req.token);res.clearCookie('tplus_session');res.json({ok:true});});
  app.get('/api/options',async(req,res)=>res.json({channels:await store.options()}));
  app.get('/api/dashboard',async(req,res)=>{let f;try{f=filters(req.query);}catch(e){return res.status(400).json({error:e.message});} const [summary,alerts]=await Promise.all([store.summary(f),store.alerts(f)]);res.json({...summary,alerts:alerts.items,alertCount:alerts.total,period:{from:f.from,to:f.to,dateField:'CreatedAt',timeZone:'database'},updatedAt:new Date()});});
  app.get('/api/transactions',async(req,res)=>{
    let f;try{f=filters(req.query);}catch(e){return res.status(400).json({error:e.message});}
    const page=Number(req.query.page || 1),pageSize=Number(req.query.pageSize || 25);
    if (!Number.isSafeInteger(page)||page<1||page>Math.floor(Number.MAX_SAFE_INTEGER/pageSize)||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100) return res.status(400).json({error:'Invalid pagination'});
    res.json(await store.rows(f,{page,pageSize}));
  });
  app.get('/api/transactions/:id',async(req,res)=>{
    if(!/^\d{1,18}$/.test(req.params.id)||BigInt(req.params.id)<1n)return res.status(400).json({error:'Invalid transaction or handling status'});
    const transaction=await store.transaction(req.params.id);
    if(!transaction)return res.status(404).json({error:'Transaction not found'});
    res.json(transaction);
  });
  app.patch('/api/transactions/:id/handling',async(req,res)=>{
    if (!/^\d{1,18}$/.test(req.params.id) || BigInt(req.params.id)<1n || !handles.includes(req.body?.handleStatus)) return res.status(400).json({error:'Invalid transaction or handling status'});
    if (!await store.update(req.params.id,req.body.handleStatus,req.user.Id)) return res.status(404).json({error:'Transaction not found'});
    res.json({ok:true});
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found'}));
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
  app.use((error,req,res,next)=>{const bad=error.type==='entity.parse.failed'; console.error('Request failed:',error.code || error.name);res.status(bad?400:503).json({error:bad?'Invalid JSON':'Service unavailable. Check the server and database connection.'});});
  return app;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app=await createApp({demo:process.argv.includes('--demo')});
  const server=app.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`TPLUS monitor: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close(async()=>{await closeDatabase();process.exit(0);});});
}
