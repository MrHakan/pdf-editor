/**
 * Transfer monitor.
 *
 * Quire's whole pitch is that documents stay on the machine they are opened on,
 * so the page measures that instead of just claiming it. Every outbound call
 * the page is capable of making — fetch, XHR, sendBeacon, WebSocket — is wrapped
 * here at boot, before any other module runs, and counted. The numbers shown on
 * the home page are these counters, live.
 *
 * Loading the app's own files from the same origin is a download, not a
 * disclosure, so it is reported separately from bytes sent and off-site calls.
 */

const state = {
  sentBytes: 0,      // bytes of request bodies leaving the page
  offsite: 0,        // requests to any origin other than this one
  requests: 0,       // same-origin requests after boot (lazy modules, fonts, wasm)
  localBytes: 0,     // bytes of document data handled by the tools
  pages: 0,          // pages rendered or written
  jobs: 0,
};

const listeners = new Set();
const LIFETIME_KEY = 'quire.lifetime';

let lifetime = { pages: 0, jobs: 0, bytes: 0 };
try { lifetime = { ...lifetime, ...JSON.parse(localStorage.getItem(LIFETIME_KEY) || '{}') }; } catch { /* private mode */ }

function emit() { listeners.forEach((fn) => fn(snapshot())); }

function saveLifetime() {
  try { localStorage.setItem(LIFETIME_KEY, JSON.stringify(lifetime)); } catch { /* ignore */ }
}

export function snapshot() { return { ...state, lifetime: { ...lifetime } }; }
export function onChange(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); }

/** Tools call these so the meter can show how much work happened on-device. */
export function noteBytes(n) { if (n > 0) { state.localBytes += n; lifetime.bytes += n; saveLifetime(); emit(); } }
export function notePages(n) { if (n > 0) { state.pages += n; lifetime.pages += n; saveLifetime(); emit(); } }
export function noteJob() { state.jobs += 1; lifetime.jobs += 1; saveLifetime(); emit(); }

function sizeOf(body) {
  if (!body) return 0;
  if (typeof body === 'string') return new Blob([body]).size;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return new Blob([body.toString()]).size;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    let n = 0;
    for (const [k, v] of body.entries()) n += k.length + (v instanceof Blob ? v.size : String(v).length);
    return n;
  }
  return 0;
}

function record(url, body) {
  let sameOrigin = true;
  try { sameOrigin = new URL(url, location.href).origin === location.origin; } catch { sameOrigin = false; }
  const n = sizeOf(body);
  state.sentBytes += n;
  if (sameOrigin) state.requests += 1; else state.offsite += 1;
  emit();
}

/** Wrap the network surface. Called once, first thing in main.js. */
export function installMonitor() {
  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = function fetchWatched(input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      record(url, init?.body ?? null);
      return nativeFetch(input, init);
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url, ...rest) { this.__quireUrl = url; return open.call(this, method, url, ...rest); };
    XHR.prototype.send = function (body) { record(this.__quireUrl || '', body); return send.call(this, body); };
  }

  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { record(url, data); return beacon(url, data); };
  }

  if (window.WebSocket) {
    const WS = window.WebSocket;
    const Wrapped = function (url, protocols) { record(url, null); return new WS(url, protocols); };
    Wrapped.prototype = WS.prototype;
    Object.assign(Wrapped, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Wrapped;
  }
}
