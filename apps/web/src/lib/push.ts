import { api } from './api.ts';

/**
 * Timer alerts through Web Push: the server sends them, the service worker shows them, even
 * with Helm closed or the phone locked. On iPhone this needs Helm added to the home screen.
 */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  // No worker in dev (Vite) or before the first install; don't wait forever for one.
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active ? reg : null;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  return (await reg.pushManager.getSubscription()) && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Ask for permission and register this device with the server. Must run from a tap or click. */
export async function enablePush(): Promise<PushState> {
  const reg = await registration();
  if (!reg) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const { publicKey } = await api.pushKey();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key can't receive our pushes; replace it.
  if (sub && !sameKey(sub.options.applicationServerKey, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
  const json = sub.toJSON();
  await api.subscribePush({ endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.unsubscribePush(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
  return pushState();
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sameKey(key: ArrayBuffer | null, publicKey: string): boolean {
  if (!key) return false;
  const a = new Uint8Array(key);
  const b = fromBase64Url(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
