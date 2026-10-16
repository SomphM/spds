export const throttleMessage = 'Too many requests. Please wait before trying again.';
export async function readApiResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { /* Proxies and older servers can return text or HTML. */ }
  if (response.status === 429) throw Object.assign(new Error(throttleMessage), { status:429 });
  if (!response.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'Request failed'), { status:response.status });
  if (!data || typeof data !== 'object') throw new Error('Invalid server response. Please refresh and try again.');
  return data;
}
