import { t, locale, initializePreferences } from './i18n.js';
import { readApiResponse, throttleMessage } from './api-response.js';
const $ = id => document.getElementById(id);
const number = value => new Intl.NumberFormat(locale()).format(value);
const databaseTime = value => value ? new Date(value).toISOString().replace('T',' ').slice(0,19) : '\u2014';
const displayedHandling = row => row.Status === 'success' || (row.Status === 'failed' && row.FailReason?.trim().toLowerCase() === 'balance is not enough') ? 'success' : row.HandleStatus || 'pending';
const time = value => value ? new Date(new Date(value).getTime()+7*3600000).toISOString().replace('T',' ').slice(0,19) : '—';
const escape = value => String(value ?? '—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let page=1,total=0,items=[],selected=null,query=new URLSearchParams(),generation=0,busy=false,lastSummary=null,lastTable=null,mode=null;
const cooldowns = new Map();
async function api(path,options={}) {
  const key=path==='/login'?'login':'api';
  if(Date.now()<(cooldowns.get(key)||0))throw new Error(throttleMessage);
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  if(response.status===429){
    const retry=response.headers.get('Retry-After');
    const delay=/^\d+$/.test(retry||'')?Number(retry)*1000:Date.parse(retry)-Date.now();
    cooldowns.set(key,Date.now()+(Number.isFinite(delay)&&delay>0?delay:60000));
  }
  if(response.status===401){$('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;}
  return readApiResponse(response);
}
function bars(id,rows,totalValue) {
  const max=totalValue || Math.max(...rows.map(r=>r.count),1);
  $(id).innerHTML=rows.length?rows.map(r=>`<div class="bar-row"><div class="bar-title"><span title="${escape(r.name)}">${escape(r.name)}</span><b>${number(r.count)}${totalValue?` <small>· ${Math.round(r.count/max*100)}%</small>`:''}</b></div><div class="track"><div style="width:${r.count/max*100}%"></div></div></div>`).join(''):`<div class="empty">${escape(t('No records in this selection'))}</div>`;
  if(id==='failures')$(id).querySelectorAll('.bar-row').forEach((row,index)=>{
    const button=document.createElement('button');button.type='button';button.className='bar-row failure-reason';
    button.dataset.reason=rows[index].name;button.innerHTML=row.innerHTML;
    button.title=t('View matching transactions');row.replaceWith(button);
  });
}
function dashboard(data) {
  lastSummary=data;
  const percent=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:1}).format(data.total?value/data.total*100:0)+'%';
  $('unresolved-total').textContent=number(data.unresolved);
  $('failure-rate').textContent=percent(data.failed)+' '+t('of selected purchases');
  $('renew-off-total').textContent=number(data.autoRenewOff);
  $('renew-on').textContent=number(data.total-data.autoRenewOff);$('renew-off').textContent=number(data.autoRenewOff);
  $('renew-on-rate').textContent=percent(data.total-data.autoRenewOff);$('renew-off-rate').textContent=percent(data.autoRenewOff);
  $('renew-failed').textContent=number(data.failedAutoRenewOff);
  $('renew-on-bar').style.width=(data.total?(data.total-data.autoRenewOff)/data.total*100:0)+'%';
  $('renew-off-bar').style.width=(data.total?data.autoRenewOff/data.total*100:0)+'%';
  $('alert-count').textContent=number(data.alertCount);
  $('period').textContent=data.period.from+' / '+data.period.to+' (CreatedAt)';
  for(const id of ['total','success','failed','checking'])$(id).textContent=number(data[id]);
  $('rate').textContent=new Intl.NumberFormat(locale(),{minimumFractionDigits:1,maximumFractionDigits:1}).format(data.successRate)+'%';$('unresolved').textContent=number(data.unresolved)+' '+t('awaiting resolution');
  bars('channel-mix',data.channels,data.total);bars('failures',data.failures,data.failed);bars('packages',data.packages);
  const max=Math.max(...data.trend.map(r=>r.success+r.failed+r.checking),1);
  $('trend').innerHTML=data.trend.length?data.trend.map(r=>`<div class="trend-column" title="${escape(r.day)} · ${r.success} ${escape(t('success'))} · ${r.failed} ${escape(t('failed'))} · ${r.checking} ${escape(t('checking'))}"><div class="stack" style="height:${(r.success+r.failed+r.checking)/max*100}%">${['success','failed','checking'].map(key=>`<span style="flex:${r[key]}"></span>`).join('')}</div><small>${escape(r.day.slice(5))}</small></div>`).join(''):`<div class="empty">${escape(t('No activity in this selection'))}</div>`;
  $('alerts').innerHTML=data.alerts.length?data.alerts.map(r=>`<button type="button" class="alert alert-detail" data-alert-id="${escape(r.Id)}"><span class="badge ${escape(r.Level)}">${escape(t(r.Level))}</span> ${escape(r.Message)}<small>${escape(r.PackageName)} / #${escape(r.Id)}<br>${databaseTime(r.AlertTime)}</small><span class="alert-link">${escape(t('Review'))} &#8599;</span></button>`).join(''):`<div class="empty">${escape(t('No system alerts'))}</div>`;
  $('updated').textContent=t('Updated')+' '+time(data.updatedAt).slice(11)+' UTC+7';
}
function table(data) {
  lastTable=data;
  total=data.total;items=data.items;
  $('rows').innerHTML=items.length?items.map((r,i)=>`<tr><td>#${escape(r.Id)}<small>${databaseTime(r.CreatedAt)}</small></td><td>${escape(r.CustomerPhone)}<small>${escape(t(r.AutoRenewOff?'Auto-renew off':'Auto-renew on'))}</small></td><td class="package">${escape(r.PackageName)}</td><td>${escape(r.Channel)}</td><td><span class="badge ${escape(r.Status)}">${escape(t(r.Status))}</span></td><td><span class="badge ${escape(displayedHandling(r))}">${escape(t(displayedHandling(r)))}</span></td><td><button class="quiet" data-index="${i}">${escape(t('Review'))} &#8599;</button></td></tr>`).join(''):`<tr><td colspan="7" class="empty">${escape(t('No purchases match your filters.'))}</td></tr>`;
  $('result-count').textContent=number(total);$('page-info').textContent=total?`${number((page-1)*25+1)}–${number(Math.min(page*25,total))} ${t('of')} ${number(total)} ${t('purchases')}`:'0 '+t('purchases');
  $('previous').disabled=page<=1;$('next').disabled=page*25>=total;
}
async function refresh() {
  const current=++generation;busy=true;$('refresh').disabled=true;
  try {
    const params=new URLSearchParams(query);params.set('page',page);
    const [summary,transactions]=await Promise.all([api('/dashboard?'+query),api('/transactions?'+params)]);
    if(current!==generation)return;
    if(page>1&&!transactions.items.length){page=Math.max(1,Math.ceil(transactions.total/25));return refresh();}
    dashboard(summary);table(transactions);$('notice').hidden=true;
  }catch(error){if(current===generation){$('notice').textContent=t(error.message)+' '+t('Displayed data may be outdated.');$('notice').hidden=false;}}
  finally{if(current===generation){busy=false;$('refresh').disabled=false;}}
}
async function boot() {
  try {
    const info=await api('/me');$('login').hidden=true;$('dashboard').hidden=false;mode=info.mode;$('mode').textContent=info.mode==='demo'?t('Workbook demo'):'SQL Server';$('operator').textContent=info.user.name;$('logout').hidden=info.mode==='demo';$('demo-banner').hidden=info.mode!=='demo';
    const options=await api('/options');$('channels').innerHTML=`<option value="">${escape(t('All channels'))}</option>`+options.channels.map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('');await refresh();
  }catch(error){$('mode').textContent=t('Sign in');$('login-error').textContent=t(error.message);}
}
$('filters').addEventListener('submit',event=>{event.preventDefault();query=new URLSearchParams(new FormData(event.target));page=1;refresh();});
function resetFilters() {
  const form=$('filters');
  for(const element of form.elements) if(element.name)element.value='';
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  form.elements.from.value=today;form.elements.to.value=today;
}
$('filters').addEventListener('reset',event=>{event.preventDefault();resetFilters();query=new URLSearchParams();page=1;refresh();});
function investigate(values) {
  const form=$('filters');
  for(const [name,value] of Object.entries(values))form.elements[name].value=value;
  query=new URLSearchParams(new FormData(form));page=1;refresh();
  $('transactions').scrollIntoView({behavior:'smooth',block:'start'});
}
document.querySelectorAll('[data-renew]').forEach(button=>button.addEventListener('click',()=>investigate({autoRenew:button.dataset.renew})));
document.querySelectorAll('[data-renew-failures]').forEach(button=>button.addEventListener('click',()=>investigate({autoRenew:'off',status:'failed'})));
document.querySelectorAll('[data-investigate]').forEach(button=>button.addEventListener('click',()=>{
  const kind=button.dataset.investigate;
  investigate({status:kind==='pending'?'failed':kind,handle:kind==='pending'?'pending':'',unresolvedOnly:kind==='pending'?'true':''});
}));
$('failures').addEventListener('click',event=>{
  const button=event.target.closest('[data-reason]');if(!button)return;
  const form=$('filters');
  form.elements.unresolvedOnly.value='';form.elements.failureReason.value=button.dataset.reason;form.elements.status.value='failed';
  query=new URLSearchParams(new FormData(form));page=1;refresh();
  $('transactions').scrollIntoView({behavior:'smooth',block:'start'});
});
$('refresh').onclick=refresh;$('previous').onclick=()=>{page--;refresh();};$('next').onclick=()=>{page++;refresh();};
$('rows').onclick=async event=>{
  const button=event.target.closest('[data-index]');if(!button)return;
  const transaction=items[Number(button.dataset.index)];
  button.disabled=true;
  try {openDetails(await api('/transactions/'+encodeURIComponent(transaction.Id)));}
  catch(error){$('notice').textContent=t(error.message);$('notice').hidden=false;$('notice').scrollIntoView({block:'center'});}
  finally{button.disabled=false;}
};
function openDetails(transaction) {
  selected=transaction;renderDetails();$('handle-status').value=selected.HandleStatus==='closing'?'':selected.HandleStatus||'pending';
  $('handling-error').textContent='';if(!$('detail').open)$('detail').showModal();
}
$('alerts').addEventListener('click',async event=>{
  const button=event.target.closest('[data-alert-id]');if(!button)return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try {openDetails(await api('/transactions/'+encodeURIComponent(button.dataset.alertId)));}
  catch(error){$('notice').textContent=t(error.message);$('notice').hidden=false;$('notice').scrollIntoView({block:'center'});}
  finally{button.disabled=false;button.removeAttribute('aria-busy');}
});
function renderDetails() {
  const fields={ID:selected.Id,'Purchase time (UTC+7)':time(selected.TxnTime),Customer:selected.CustomerPhone,Package:selected.PackageName,Channel:selected.Channel,Status:t(selected.Status),'Failure reason':selected.FailReason,'Auto-renew':t(selected.AutoRenewOff?'Off':'On'),'Handled by user':selected.HandledByDisplayName,'Handled at (UTC+7)':time(selected.HandledAt)};
  $('detail-fields').innerHTML=Object.entries(fields).map(([key,value])=>`<dt>${escape(t(key))}</dt><dd>${escape(value)}</dd>`).join('');
}
$('close-detail').onclick=()=>$('detail').close();
$('handling-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await api(`/transactions/${selected.Id}/handling`,{method:'PATCH',body:JSON.stringify({handleStatus:$('handle-status').value})});$('detail').close();await refresh();}catch(error){$('handling-error').textContent=t(error.message);}finally{button.disabled=false;}};
$('login-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await api('/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});event.target.reset();await boot();}catch(error){$('login-error').textContent=t(error.message);}finally{button.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/logout',{method:'POST',body:'{}'});$('dashboard').hidden=true;$('login').hidden=false;$('logout').hidden=true;$('mode').textContent=t('Sign in');}catch(error){$('notice').textContent=t(error.message);$('notice').hidden=false;}};
setInterval(()=>{if(!document.hidden&&!$('dashboard').hidden&&!busy&&!$('detail').open)refresh();},30000);
initializePreferences(() => {
  if(lastSummary) dashboard(lastSummary);
  if(lastTable) table(lastTable);
  if(selected && $('detail').open) renderDetails();
  $('mode').textContent=mode==='demo'?t('Workbook demo'):mode==='sqlserver'?'SQL Server':t('Sign in');
  const allChannels=$('channels').querySelector('option[value=""]');
  if(allChannels) allChannels.textContent=t('All channels');
});
resetFilters();
boot();

