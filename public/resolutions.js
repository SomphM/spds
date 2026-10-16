import { t, locale, initializePreferences } from './i18n.js';
import { readApiResponse } from './api-response.js';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat(locale()).format(value);
const stamp = value => value ? new Date(value).toISOString().replace('T',' ').slice(0,19) : '—';
const percent = value => new Intl.NumberFormat(locale(),{maximumFractionDigits:1}).format(value)+'%';
let page=1,lastData=null,generation=0,busy=false,retryAt=0;
function dates() { const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);$('resolution-filters').elements.from.value=today;$('resolution-filters').elements.to.value=today; }
async function api(path,options={}) {
  const response=await fetch('/api'+path,options);
  if(response.status===401){$('sign-in').hidden=false;$('logout').hidden=true;}
  if(response.status===429){const seconds=Number(response.headers.get('Retry-After'));retryAt=Date.now()+(seconds>0?seconds:60)*1000;}
  return readApiResponse(response);
}
function render(data) {
  lastData=data;
  $('failed').textContent=number(data.totalFailed);$('fixed').textContent=number(data.fixed);$('needs-attention').textContent=number(data.needsAttention);
  const rate=data.totalFailed?data.fixed/data.totalFailed*100:0;
  $('resolution-rate').textContent=percent(rate);$('coverage-fixed').style.width=rate+'%';$('coverage-text').textContent=number(data.fixed)+' / '+number(data.totalFailed);
  $('fixed-count').textContent=number(data.fixed);$('period').textContent=data.period.from+' / '+data.period.to;
  $('updated').textContent=t('Updated')+' '+stamp(data.updatedAt)+' UTC';
  $('operators').innerHTML=data.operators.length?data.operators.map(row=>`<tr><td>${escape(row.DisplayName==='Unassigned'?t('Unassigned'):row.DisplayName)}${row.UserId==null?'':`<small>#${escape(row.UserId)}</small>`}</td><td><b>${number(row.Fixed)}</b></td><td>${percent(data.fixed?row.Fixed/data.fixed*100:0)}</td></tr>`).join(''):`<tr><td colspan="3" class="empty">${escape(t('No fixed purchases in this period'))}</td></tr>`;
  $('fixed-rows').innerHTML=data.items.length?data.items.map(row=>`<tr><td>#${escape(row.Id)}<small>${stamp(row.CreatedAt)}</small></td><td>${escape(row.CustomerPhone)}</td><td class="package">${escape(row.PackageName)}</td><td>${escape(row.FailReason||t('Unspecified'))}</td><td>${escape(row.HandledByDisplayName==='Unassigned'?t('Unassigned'):row.HandledByDisplayName)}</td><td>${stamp(row.HandledAt)}</td></tr>`).join(''):`<tr><td colspan="6" class="empty">${escape(t('No fixed purchases in this period'))}</td></tr>`;
  $('previous').disabled=page<=1;$('next').disabled=page*25>=data.fixed;
  $('page-info').textContent=data.fixed?`${number((page-1)*25+1)}–${number(Math.min(page*25,data.fixed))} ${t('of')} ${number(data.fixed)}`:'0';
}
async function refresh() {
  if(Date.now()<retryAt)return;
  const current=++generation;busy=true;$('refresh').disabled=true;
  try {
    const params=new URLSearchParams(new FormData($('resolution-filters')));params.set('page',page);
    const data=await api('/resolutions?'+params);
    if(current!==generation)return;
    if(page>1&&!data.items.length){page=Math.max(1,Math.ceil(data.fixed/25));return refresh();}
    render(data);$('notice').hidden=true;
  }catch(error){if(current===generation){$('notice').textContent=t(error.message);$('notice').hidden=false;}}
  finally{if(current===generation){busy=false;$('refresh').disabled=false;}}
}
$('resolution-filters').onsubmit=event=>{event.preventDefault();page=1;refresh();};
$('resolution-filters').onreset=event=>{event.preventDefault();dates();page=1;refresh();};
$('previous').onclick=()=>{page--;refresh();};$('next').onclick=()=>{page++;refresh();};$('refresh').onclick=refresh;
$('logout').onclick=async()=>{try{await api('/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});location.href='/';}catch(error){$('notice').textContent=t(error.message);$('notice').hidden=false;}};
initializePreferences(()=>{document.title='TPLUS - '+t('Resolution dashboard');if(lastData)render(lastData);});
document.title='TPLUS - '+t('Resolution dashboard');dates();
try { const info=await api('/me');$('operator').textContent=info.user.name;$('mode').textContent=info.mode==='demo'?t('Workbook demo'):'SQL Server';$('logout').hidden=info.mode==='demo';await refresh(); }
catch(error){$('notice').textContent=t(error.message);$('notice').hidden=false;}
setInterval(()=>{if(!document.hidden&&!busy&&$('sign-in').hidden)refresh();},30000);
