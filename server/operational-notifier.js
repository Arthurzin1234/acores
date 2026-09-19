import { safeLog } from './reliability.js';

export function createOperationalNotifier({ url = '', fetchImpl = fetch, now = Date.now } = {}) {
  const lastSent = new Map();
  return async (code) => {
    if (!url || !/^[a-z_]{1,50}$/.test(code)) return;
    if (lastSent.has(code) && now() - lastSent.get(code) < 600000) return;
    lastSent.set(code, now());
    try {
      const target = new URL(url);
      if (target.protocol !== 'https:') return;
      const result = await fetchImpl(target, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'acores', event: code, at: new Date(now()).toISOString() }),
        signal: AbortSignal.timeout(7000),
      });
      if (!result.ok) safeLog('alert_delivery_failed');
    } catch { safeLog('alert_delivery_failed'); }
  };
}
