export const isUnresolvedFailure = row => row.Status === 'failed' && (row.FailReason || '').trim().toLowerCase() !== 'balance is not enough' && !['fixed','closing'].includes(row.HandleStatus);
export const localDay = (value = Date.now()) => new Date(new Date(value).getTime()+7*3600000).toISOString().slice(0,10);
export function dateBounds(f) { return { start:new Date(f.from+'T00:00:00Z'), end:new Date(new Date(f.to+'T00:00:00Z').getTime()+86400000) }; }
export const statuses = ['success', 'failed', 'checking'];
export const handles = ['pending', 'fixed', 'closing'];
export function filters(query) {
  const result = { unresolvedOnly: String(query.unresolvedOnly || ''), autoRenew: String(query.autoRenew || ''), failureReason: String(query.failureReason || ''), search: String(query.search || '').trim(), status: String(query.status || ''), channel: String(query.channel || ''), handle: String(query.handle || ''), from: String(query.from || localDay()), to: String(query.to || query.from || localDay()) };
  if ((result.unresolvedOnly && result.unresolvedOnly !== 'true') || (result.autoRenew && !['on','off'].includes(result.autoRenew)) || result.failureReason.length > 200 || result.search.length > 100 || result.channel.length > 30 || (result.status && !statuses.includes(result.status)) || (result.handle && !handles.includes(result.handle))) throw new Error('Invalid filter');
  for (const key of ['from', 'to']) if (result[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(result[key]) || !Number.isFinite(Date.parse(result[key])) || new Date(result[key]).toISOString().slice(0,10) !== result[key])) throw new Error('Invalid date');
  if (result.from && result.to && result.from > result.to) throw new Error('Start date must precede end date');
  return result;
}
export function matches(row, f) {
  const day = new Date(row.CreatedAt).toISOString().slice(0,10);
  return (!f.unresolvedOnly || isUnresolvedFailure(row)) && (!f.autoRenew || Boolean(row.AutoRenewOff) === (f.autoRenew === 'off')) && (!f.failureReason || (row.FailReason || 'Unspecified') === f.failureReason) && (!f.search || `${row.CustomerPhone} ${row.PackageName}`.toLowerCase().includes(f.search.toLowerCase())) && (!f.status || row.Status === f.status) && (!f.channel || row.Channel === f.channel) && (!f.handle || (row.HandleStatus || 'pending') === f.handle) && (!f.from || day >= f.from) && (!f.to || day <= f.to);
}
export function summarize(rows) {
  const count = status => rows.filter(r => r.Status === status).length;
  const group = (key, select = () => true) => Object.entries(rows.filter(select).reduce((out, r) => { const name = r[key] || 'Unspecified'; out[name] = (out[name] || 0) + 1; return out; }, {})).map(([name, count]) => ({ name, count })).sort((a,b) => b.count-a.count);
  const daily = new Map();
  for (const r of rows) { const day = new Date(r.CreatedAt).toISOString().slice(0,10); const v = daily.get(day) || { day, success: 0, failed: 0, checking: 0 }; v[r.Status]++; daily.set(day,v); }
  return { total: rows.length, success: count('success'), failed: count('failed'), checking: count('checking'), unresolved: rows.filter(isUnresolvedFailure).length, autoRenewOff: rows.filter(r => r.AutoRenewOff).length, failedAutoRenewOff: rows.filter(r => r.AutoRenewOff && r.Status === 'failed').length, successRate: rows.length ? count('success') / rows.length * 100 : 0, channels: group('Channel'), packages: group('PackageName').slice(0,6), failures: group('FailReason', r => r.Status === 'failed').slice(0,6), trend: [...daily.values()].sort((a,b) => a.day.localeCompare(b.day)) };
}
