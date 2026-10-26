// SAM WEB RADIO FREE - o service worker: guarda SO' a pagina e os icones (para abrir depressa e como app).
// NUNCA guarda o audio: tudo o que nao esta' na lista (os streams, que sao de outros servidores) passa direto.
const VERSAO = 'sam-webradio-free-1.5';
const PAGINA = ['./', 'index.html', 'baixar.html', 'manifest.webmanifest', 'logo.png',
  'icones/icone-192.png', 'icones/icone-512.png', 'icones/apple-touch-icon.png', 'icones/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(PAGINA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;                       // os streams e o titulo: nunca passam por aqui
  if (r.headers.has('range') || r.destination === 'audio') return;     // audio: nunca em cache
  const base = new URL(self.registration.scope).pathname;              // ex.: /ouvir/
  if (!u.pathname.startsWith(base)) return;
  const caminho = u.pathname.slice(base.length) || './';
  if (!PAGINA.includes(caminho)) return;                                // o APK e o resto: direto, sem cache
  // a pagina: primeiro a rede (para chegar a versao nova), a copia so' sem internet
  e.respondWith(fetch(r).then(resp => {
    if (resp.ok) { const c = resp.clone(); caches.open(VERSAO).then(k => k.put(r, c)); }
    return resp;
  }).catch(() => caches.match(r).then(m => m || caches.match('./'))));
});
