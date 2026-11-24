'use strict';
/* Mr. B Reader — funciona sem internet depois da primeira visita.
   Com internet, o app busca sempre a versão mais nova (e guarda uma cópia); sem internet, usa a cópia.
   Nada do Google nem de outros sites passa por aqui. */
const VERSAO = "2.2.1-80b6888b23";
const CACHE = 'mrb-' + VERSAO;
const ESSENCIAIS = ["./","app.js","config.js","img/apple-touch-icon.png","img/favicon-32.png","img/icone-192.png","img/icone-256.png","img/icone-64.png","img/logo-256.png","index.html","lib/epub.min.js","lib/jszip.min.js","lib/pdf.min.js","lib/pdf.worker.min.js","manifest.webmanifest","ponte.js","sincronia.js","style.css","textlayer.css"];          // baixados na instalação, para abrir sem internet
const ESTAVEIS = /\/(fontes|lib|img)\//;    // fontes, bibliotecas e imagens: quase nunca mudam, vêm da cópia
const ESPERA_REDE = 4000;                   // internet lenta: depois de 4 s usa a cópia

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ESSENCIAIS.map(a => new Request(a, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const velhos = (await caches.keys()).filter(k => k.startsWith('mrb-') && k !== CACHE);
    await Promise.all(velhos.map(k => caches.delete(k)));
    await self.clients.claim();
    // havia uma versão anterior: recarrega as abas abertas uma vez, para a versão nova valer na hora
    // (a leitura é gravada o tempo todo, então nada se perde)
    if (velhos.length) for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
  })());
});
async function daRede(req, c, chave) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ESPERA_REDE);
  try {
    const r = await fetch(req, { cache: 'no-cache', signal: ctrl.signal });
    if (r.ok) c.put(chave, r.clone()).catch(() => {});
    return r;
  } finally { clearTimeout(t); }
}
self.addEventListener('fetch', e => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || !u.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    // a página do app (o login do Google volta para cá com #… no endereço)
    if (req.mode === 'navigate') {
      try { return await daRede(new Request(new URL('./', self.registration.scope).href), c, 'index.html'); }
      catch (err) { return (await c.match('index.html')) || Response.error(); }
    }
    if (ESTAVEIS.test(u.pathname)) {
      const guardada = await c.match(req, { ignoreSearch: true });
      if (guardada) return guardada;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone()).catch(() => {});
      return r;
    }
    // código do app (app.js, estilo, config…): primeiro a internet, depois a cópia
    try { return await daRede(req, c, req); }
    catch (err) { return (await c.match(req, { ignoreSearch: true })) || Response.error(); }
  })());
});
