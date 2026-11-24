'use strict';
/* Mr. B Reader — funciona sem internet depois da primeira visita.
   Guarda os arquivos do próprio site; nada do Google nem de outros sites passa por aqui. */
const VERSAO = "2.2.0-5a8c6c3774";
const CACHE = 'mrb-' + VERSAO;
const ESSENCIAIS = ["./","app.js","config.js","img/apple-touch-icon.png","img/favicon-32.png","img/icone-192.png","img/icone-256.png","img/icone-64.png","img/logo-256.png","index.html","lib/epub.min.js","lib/jszip.min.js","lib/pdf.min.js","lib/pdf.worker.min.js","manifest.webmanifest","ponte.js","sincronia.js","style.css","textlayer.css"];   // baixados na instalação
const SOB_DEMANDA = /\/(fontes|lib)\//; // fontes e bibliotecas extras: guardadas na primeira vez que forem usadas

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ESSENCIAIS.map(a => new Request(a, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('mrb-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || !u.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    // a página do app: sempre a guardada (o login do Google volta para cá com #… no endereço)
    if (req.mode === 'navigate') {
      const r = await c.match('index.html');
      if (r) return r;
      return fetch(req);
    }
    const guardada = await c.match(req, { ignoreSearch: true });
    if (guardada) return guardada;
    const r = await fetch(req);
    if (r.ok && SOB_DEMANDA.test(u.pathname)) c.put(req, r.clone()).catch(() => {});
    return r;
  })());
});
