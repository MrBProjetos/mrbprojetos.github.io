'use strict';
/* Mr. B Reader — recursos de leitura e de biblioteca (2.3)
   Busca no texto, links e prévias do PDF, voltar, exibição do PDF, ficha e citação, exportações,
   filtros e etiquetas, todas as anotações, marcadores, dicionário/tradução, voz, layout do texto,
   estatísticas, backup e atualização automática (Windows).
   Usa as variáveis e funções do app.js (carregado antes). */

/* ================= utilidades ================= */
const BLOCOS = 'p,div,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dd,dt,section,article,aside,figcaption,pre,header,footer,nav,tr,table,ul,ol,dl,figure,body';
/* texto normalizado (sem acento, minúsculo, espaços simples) com o mapa de volta para o texto original */
function normMapa(t) {
  let n = '', esp = true;
  const m = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '­') continue;                         // hífen invisível
    if (/\s/.test(c)) { if (!esp) { n += ' '; m.push(i); esp = true; } continue; }
    esp = false;
    const d = c.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < d.length; k++) { n += d[k]; m.push(i); }
  }
  return { n, m };
}
const normTermo = q => normMapa(String(q || '').trim()).n.trim();
function ocorrencias(n, q, max = 5000) {
  const r = [];
  if (!q) return r;
  let i = n.indexOf(q);
  while (i >= 0 && r.length < max) { r.push(i); i = n.indexOf(q, i + q.length); }
  return r;
}
/* junta os textos de um elemento; quebra de bloco ou <br> vira espaço */
function textoComNos(raiz, separarBlocos) {
  const nos = []; let txt = '';
  const doc = raiz.ownerDocument;
  const w = doc.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let ultimoBloco = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 1) { if (n.tagName.toLowerCase() === 'br') txt += ' '; continue; }
    if (!n.data) continue;
    const pai = n.parentElement && n.parentElement.tagName.toLowerCase();
    if (pai === 'script' || pai === 'style' || pai === 'title') continue;
    if (separarBlocos) {
      const b = n.parentElement && n.parentElement.closest(BLOCOS);
      if (ultimoBloco && b !== ultimoBloco) txt += ' ';
      ultimoBloco = b;
    }
    nos.push({ no: n, ini: txt.length });
    txt += n.data;
  }
  return { txt, nos };
}
/* posição no texto juntado → nó de texto e deslocamento */
function pontoNoTexto(nos, pos, fim) {
  let lo = 0, hi = nos.length - 1, k = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (nos[mid].ini <= pos) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  const x = nos[k], len = x.no.data.length;
  let off = pos - x.ini;
  if (off >= len) {                                         // caiu num espaço entre blocos
    if (fim) return [x.no, len];
    const nx = nos[k + 1]; return nx ? [nx.no, 0] : [x.no, len];
  }
  return [x.no, fim ? off + 1 : off];
}
function faixaNoTexto(doc, nos, a, b) {   // [a, b) no texto original
  if (!nos.length || b <= a) return null;
  const [n1, o1] = pontoNoTexto(nos, a, false), [n2, o2] = pontoNoTexto(nos, b - 1, true);
  const r = doc.createRange();
  try { r.setStart(n1, o1); r.setEnd(n2, o2); } catch (e) { return null; }
  return r;
}
function trechoEm(txt, ini, fim, folga = 50) {
  const a = Math.max(0, ini - folga), b = Math.min(txt.length, fim + folga);
  return { antes: (a > 0 ? '…' : '') + txt.slice(a, ini).replace(/\s+/g, ' ').trimStart(), achado: txt.slice(ini, fim), depois: txt.slice(fim, b).replace(/\s+/g, ' ').trimEnd() + (b < txt.length ? '…' : '') };
}
function abrirExterno(url) {
  try { const u = new URL(url); if (!/^(https?|mailto):$/.test(u.protocol)) return; window.open(u.toString(), '_blank', 'noopener,noreferrer'); } catch (e) {}
}
function hojeISO(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function duracao(seg, curto) {
  seg = Math.max(0, Math.round(seg));
  if (seg < 60) return curto ? 'menos de 1 min' : seg + ' s';
  const min = Math.round(seg / 60);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') + ' min' : '');
}
const esperaMs = ms => new Promise(r => setTimeout(r, ms));
function aparelhoId() {
  if (!/^[a-z0-9]{6,24}$/.test(dados.prefs.aparelho || '')) { dados.prefs.aparelho = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 14); gravar(); }
  return dados.prefs.aparelho;
}

/* ================= abrir / fechar um livro ================= */
let irDepoisDeAbrir = null;   // { marca } ou { marcador }: usado por "todas as anotações"
function aoAbrirLivro() {
  document.body.classList.toggle('lendo-pdf', !!pdf);
  document.body.classList.toggle('lendo-epub', !!epub);
  historicoLinks.length = 0; atualizarVoltar();
  atualizarListaMarcadores(); atualizarBotaoMarcador();
  est.iniciar();
  fichaAutomatica().catch(e => console.warn('ficha', e));
  if (pdf) capitulosPDF();
  if (irDepoisDeAbrir && reg) { const alvo = irDepoisDeAbrir; irDepoisDeAbrir = null; if (alvo.marca) irParaMarca(alvo.marca); }
}
function irParaMarca(id) {
  const m = reg && reg.marcas.find(x => x.id === id);
  if (!m) return;
  if (m.pagina) setTimeout(() => { if (pdf) irPaginaPDF(m.pagina, true, m.rects[0] ? m.rects[0][1] : undefined); }, 120);   // depois de o PDF terminar de montar
  else if (epub) epub.rend.display(m.cfi).then(() => redesenharMarcasLogo());
  setTimeout(() => { const r = $('#area').getBoundingClientRect(); abrirPop(m, r.left + r.width / 2, r.top + 80); }, 500);
}
function aoFecharLivro() {
  voz.parar();
  fecharBusca(true);
  est.parar();
  esconderPrevia();
  popLayout(false);
  historicoLinks.length = 0; atualizarVoltar();
  $('#rod-resta').hidden = true;
  document.body.classList.remove('lendo-pdf', 'lendo-epub');
}
function aoMudarPosicao(pag, loc) {
  atualizarBotaoMarcador();
  if (pag) est.pagina(pag);
  tempoRestante(pag, loc);
}

/* ================= busca no texto (Ctrl+F) ================= */
const busca = { termo: '', res: [], i: -1, rodada: 0, procurando: false, anotacao: null, textosPDF: new Map() };
function abrirBusca(termo) {
  if (!atual) return;
  const b = $('#busca'); b.hidden = false; $('#bt-busca').classList.add('ativo');
  const inp = $('#busca-txt');
  if (typeof termo === 'string' && termo) { inp.value = termo; buscar(termo); }
  inp.focus(); inp.select();
}
function fecharBusca(silencioso) {
  busca.rodada++; busca.termo = ''; busca.res = []; busca.i = -1; busca.procurando = false;
  $('#busca').hidden = true; $('#busca-lista').hidden = true; $('#busca-lista-bt').setAttribute('aria-expanded', 'false');
  $('#bt-busca').classList.remove('ativo');
  $('#busca-qtd').textContent = '';
  document.querySelectorAll('.camada-busca').forEach(c => c.replaceChildren());
  tirarAnotacaoBusca();
  if (!silencioso && document.activeElement === $('#busca-txt')) $('#busca-txt').blur();
}
function tirarAnotacaoBusca() {
  if (busca.anotacao && epub) { try { epub.rend.annotations.remove(busca.anotacao, 'underline'); } catch (e) {} }
  busca.anotacao = null;
}
function mostrarQtdBusca() {
  const q = $('#busca-qtd'), n = busca.res.length;
  if (!busca.termo) { q.textContent = ''; return; }
  if (!n) q.textContent = busca.procurando ? 'procurando…' : 'nada encontrado';
  else q.textContent = (busca.i >= 0 ? (busca.i + 1) + ' de ' : '') + n + (n >= 2000 ? '+' : '') + (busca.procurando ? '…' : '');
  q.classList.toggle('nada', !n && !busca.procurando);
}
async function textoPaginaPDF(i) {
  if (busca.textosPDF.has(i)) return busca.textosPDF.get(i);
  const pg = await pdf.doc.getPage(i);
  const tc = await pg.getTextContent();
  const t = tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join('');
  if (busca.textosPDF.size > 3000) busca.textosPDF.clear();
  busca.textosPDF.set(i, t);
  return t;
}
async function buscar(termo) {
  const rodada = ++busca.rodada;
  const q = normTermo(termo);
  busca.termo = q; busca.res = []; busca.i = -1;
  document.querySelectorAll('.camada-busca').forEach(c => c.replaceChildren());
  tirarAnotacaoBusca();
  $('#busca-lista').replaceChildren();
  if (q.length < 2) { busca.procurando = false; mostrarQtdBusca(); return; }
  busca.procurando = true; mostrarQtdBusca();
  const vivo = () => rodada === busca.rodada && atual;
  const add = r => {
    if (busca.res.length >= 2000) return false;
    busca.res.push(r);
    if (busca.res.length <= 400) itemListaBusca(r, busca.res.length - 1);
    return true;
  };
  let primeiro = true;
  const irPrimeiro = () => {
    if (!primeiro || !busca.res.length) return;
    primeiro = false;
    // primeiro resultado depois da posição atual
    let k = 0;
    if (pdf) { const p = paginaAtualPDF(); k = Math.max(0, busca.res.findIndex(r => r.pagina >= p)); }
    irResultado(k);
  };
  try {
    if (pdf) {
      const n = pdf.doc.numPages, docAtual = pdf.doc;
      const inicio = Math.max(1, (reg && reg.pos.pagina) || 1);
      // procura primeiro da página atual até o fim; depois o começo (a lista fica em ordem de página)
      const ordem = [];
      for (let i = 1; i <= n; i++) ordem.push(i);
      let achadosAntes = 0;
      for (let k = 0; k < ordem.length; k++) {
        if (!vivo() || pdf.doc !== docAtual) return;
        const i = ordem[k];
        const t = await textoPaginaPDF(i);
        const { n: tn, m } = normMapa(t);
        let j = 0;
        for (const pos of ocorrencias(tn, q)) {
          const a = m[pos], b = m[pos + q.length - 1] + 1;
          if (!add({ pagina: i, k: j++, trecho: trechoEm(t, a, b) })) break;
        }
        if (i >= inicio && busca.res.length > achadosAntes) irPrimeiro();
        achadosAntes = busca.res.length;
        if (k % 25 === 24) { mostrarQtdBusca(); await ocioso(60); }
      }
    } else if (epub) {
      const book = epub.book;
      const itens = book.spine.spineItems || [];
      const atualIdx = (() => { try { return epub.rend.currentLocation().start.index; } catch (e) { return 0; } })();
      for (const sec of itens) {
        if (!vivo() || !epub || epub.book !== book) return;
        let doc = null;
        try { await sec.load(book.load.bind(book)); doc = sec.document; } catch (e) { continue; }
        if (!doc || !doc.body) { try { sec.unload(); } catch (e) {} continue; }
        const { txt, nos } = textoComNos(doc.body, true);
        const { n: tn, m } = normMapa(txt);
        for (const pos of ocorrencias(tn, q)) {
          const a = m[pos], b = m[pos + q.length - 1] + 1;
          const rg = faixaNoTexto(doc, nos, a, b); if (!rg) continue;
          let cfi = null; try { cfi = sec.cfiFromRange(rg); } catch (e) {}
          if (!cfi) continue;
          if (!add({ cfi, indice: sec.index, trecho: trechoEm(txt, a, b) })) break;
        }
        try { sec.unload(); } catch (e) {}
        if (sec.index >= atualIdx) irPrimeiro();
        mostrarQtdBusca();
        await ocioso(40);
      }
    }
  } catch (e) { console.warn('busca', e); }
  if (!vivo()) return;
  busca.procurando = false;
  if (primeiro && busca.res.length) irPrimeiro();
  mostrarQtdBusca();
}
function itemListaBusca(r, k) {
  const b = document.createElement('button'); b.className = 'busca-item'; b.dataset.k = k;
  const onde = document.createElement('span'); onde.className = 'onde';
  onde.textContent = r.pagina ? 'pág. ' + r.pagina : (capituloPorIndice(r.indice) || 'Trecho');
  const t = document.createElement('span'); t.className = 'trecho';
  const mk = document.createElement('mark'); mk.textContent = r.trecho.achado;
  t.append(r.trecho.antes, mk, r.trecho.depois);
  b.append(onde, t);
  b.onclick = () => { irResultado(k); if (ehMovel()) listaBusca(false); };
  $('#busca-lista').appendChild(b);
}
function listaBusca(abrir) {
  const l = $('#busca-lista');
  if (abrir === undefined) abrir = l.hidden;
  l.hidden = !abrir || !busca.res.length; $('#busca-lista-bt').setAttribute('aria-expanded', String(!l.hidden));
}
async function irResultado(k) {
  if (!busca.res.length) return;
  k = ((k % busca.res.length) + busca.res.length) % busca.res.length;
  busca.i = k; mostrarQtdBusca();
  document.querySelectorAll('.busca-item.atual').forEach(x => x.classList.remove('atual'));
  const it = $('#busca-lista').querySelector(`.busca-item[data-k="${k}"]`);
  if (it) { it.classList.add('atual'); it.scrollIntoView({ block: 'nearest' }); }
  const r = busca.res[k];
  if (pdf && r.pagina) {
    const ja = pdf.renderizadas.has(r.pagina);
    if (paginaAtualPDF() !== r.pagina || !ja) irPaginaPDF(r.pagina, true);
    document.querySelectorAll('.camada-busca').forEach((c, i) => { const p = +c.closest('.pagina').dataset.p; if (p !== r.pagina) desenharBuscaPDF(p); });
    // espera a página aparecer (texto pronto) para destacar e centralizar
    for (let t = 0; t < 40; t++) {
      if (!pdf) return;
      const d = pdf.paginas[r.pagina - 1], tl = d && d.querySelector('.textLayer');
      if (tl && tl.childNodes.length) break;
      await esperaMs(75);
    }
    desenharBuscaPDF(r.pagina, true);
  } else if (epub && r.cfi) {
    tirarAnotacaoBusca();
    try {
      await epub.rend.display(r.cfi);
      epub.rend.annotations.underline(r.cfi, {}, null, 'mrb-busca', { fill: '#ff9632', 'fill-opacity': '0.42', 'mix-blend-mode': 'multiply', stroke: '#ff7a00', 'stroke-opacity': '0.9' });
      busca.anotacao = r.cfi;
    } catch (e) { console.warn('busca epub', e); }
  }
}
/* destaca na página do PDF as ocorrências do termo (chamado também quando a página é desenhada) */
function buscaNaPaginaPDF(i) { if (busca.termo && !$('#busca').hidden) desenharBuscaPDF(i); }
function desenharBuscaPDF(i, rolar) {
  if (!pdf) return;
  const d = pdf.paginas[i - 1]; if (!d) return;
  const camada = d.querySelector('.camada-busca'), tl = d.querySelector('.textLayer'), pc = d.querySelector('.pc');
  if (!camada || !tl || !pc) return;
  camada.replaceChildren();
  const q = busca.termo; if (!q) return;
  const { txt, nos } = textoComNos(tl, false);
  const { n, m } = normMapa(txt);
  const pr = pc.getBoundingClientRect();
  const atualR = busca.res[busca.i];
  let k = 0, alvo = null;
  for (const pos of ocorrencias(n, q, 400)) {
    const a = m[pos], b = m[pos + q.length - 1] + 1;
    const rg = faixaNoTexto(document, nos, a, b);
    if (!rg) { k++; continue; }
    const eAtual = atualR && atualR.pagina === i && atualR.k === k;
    for (const r of rg.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const el = document.createElement('div'); el.className = 'achado' + (eAtual ? ' atual' : '');
      Object.assign(el.style, { left: (r.left - pr.left) / pr.width * 100 + '%', top: (r.top - pr.top) / pr.height * 100 + '%', width: r.width / pr.width * 100 + '%', height: r.height / pr.height * 100 + '%' });
      camada.appendChild(el);
      if (eAtual && !alvo) alvo = el;
    }
    k++;
  }
  if (rolar && alvo) alvo.scrollIntoView({ block: 'center', inline: 'nearest' });
}
(() => {
  const inp = $('#busca-txt');
  let t = null;
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => buscar(inp.value), 280); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (normTermo(inp.value) !== busca.termo) { clearTimeout(t); buscar(inp.value); return; }
      irResultado(busca.i + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') { e.stopPropagation(); fecharBusca(); }
  });
  $('#busca-prox').onclick = () => irResultado(busca.i + 1);
  $('#busca-ant').onclick = () => irResultado(busca.i - 1);
  $('#busca-fechar').onclick = () => fecharBusca();
  $('#busca-lista-bt').onclick = () => listaBusca();
  $('#bt-busca').onclick = () => ($('#busca').hidden ? abrirBusca() : fecharBusca());
})();

/* ================= links do PDF, prévia e "voltar" ================= */
const historicoLinks = [];
async function destinoPDF(dest) {
  if (!pdf) return null;
  if (typeof dest === 'string') dest = await pdf.doc.getDestination(dest);
  if (!Array.isArray(dest) || !dest.length) return null;
  const ref = dest[0];
  let idx = null;
  if (ref && typeof ref === 'object') idx = await pdf.doc.getPageIndex(ref);
  else if (Number.isInteger(ref)) idx = ref;
  if (idx == null || idx < 0 || idx >= pdf.doc.numPages) return null;
  const tipo = dest[1] && dest[1].name;
  let x = null, y = null;
  if (tipo === 'XYZ') { x = dest[2]; y = dest[3]; }
  else if (tipo === 'FitH' || tipo === 'FitBH') y = dest[2];
  else if (tipo === 'FitR') { x = dest[2]; y = dest[5]; }
  let fy = null;
  if (typeof y === 'number') {
    const pg = await pdf.doc.getPage(idx + 1), v = pg.getViewport({ scale: 1 });
    fy = Math.max(0, Math.min(1, v.convertToViewportPoint(typeof x === 'number' ? x : 0, y)[1] / v.height));
  }
  return { pagina: idx + 1, fy };
}
async function linksPDF(i, page, pc) {
  const anns = await page.getAnnotations({ intent: 'display' });
  if (!pdf || !pdf.renderizadas.has(i)) return;
  const links = anns.filter(a => a.subtype === 'Link' && (a.dest || a.url || a.unsafeUrl) && Array.isArray(a.rect));
  pc.querySelectorAll('.camada-links').forEach(x => x.remove());
  if (!links.length) return;
  const vp = page.getViewport({ scale: 1 });
  const camada = document.createElement('div'); camada.className = 'camada-links';
  for (const a of links) {
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const el = document.createElement('a'); el.className = 'link-pdf'; el.draggable = false;
    Object.assign(el.style, { left: Math.min(x1, x2) / vp.width * 100 + '%', top: Math.min(y1, y2) / vp.height * 100 + '%', width: Math.abs(x2 - x1) / vp.width * 100 + '%', height: Math.abs(y2 - y1) / vp.height * 100 + '%' });
    const url = a.url || a.unsafeUrl;
    if (url) {
      if (!/^(https?:|mailto:)/i.test(url)) continue;
      el.href = url; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.title = url;
    } else {
      el.href = '#';
      el.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); esconderPrevia(); seguirDestinoPDF(a.dest); });
      el.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') agendarPrevia(() => previaPDF(a.dest, ev.clientX, ev.clientY)); });
      el.addEventListener('pointerleave', () => cancelarPrevia());
    }
    camada.appendChild(el);
  }
  pc.appendChild(camada);
}
async function seguirDestinoPDF(dest) {
  const d = await destinoPDF(dest).catch(() => null);
  if (!d) { aviso('Não encontrei o destino deste link.'); return; }
  const sc = $('#pdf-scroll');
  historicoLinks.push({ tipo: 'pdf', pagina: paginaAtualPDF(), topo: sc.scrollTop, escala: pdf.escala });
  if (historicoLinks.length > 50) historicoLinks.shift();
  irPaginaPDF(d.pagina, Math.abs(d.pagina - paginaAtualPDF()) > 3, d.fy);
  atualizarVoltar();
}
function atualizarVoltar() {
  const b = $('#bt-voltar-link'), h = historicoLinks[historicoLinks.length - 1];
  b.hidden = !h;
  if (h) b.lastChild.textContent = h.tipo === 'pdf' ? 'Voltar para a pág. ' + h.pagina : (h.pag ? 'Voltar para a pág. ' + h.pag : 'Voltar para onde eu estava');
  b.title = 'Voltar (Alt+←)';
}
function voltarLink() {
  const h = historicoLinks.pop(); if (!h) return;
  if (h.tipo === 'pdf' && pdf) {
    if (Math.abs(h.escala - pdf.escala) < 0.001) $('#pdf-scroll').scrollTo({ top: h.topo });
    else irPaginaPDF(h.pagina, true);
  } else if (h.tipo === 'epub' && epub) epub.rend.display(h.cfi);
  atualizarVoltar();
}
$('#bt-voltar-link').onclick = voltarLink;

/* prévia ao passar o mouse sobre um link interno (referência, figura, nota) */
let tPrevia = null, previaPedido = 0;
function agendarPrevia(fn) { clearTimeout(tPrevia); tPrevia = setTimeout(fn, 380); }
function cancelarPrevia() { clearTimeout(tPrevia); previaPedido++; setTimeout(() => { if (!$('#previa').matches(':hover')) esconderPrevia(); }, 120); }
function esconderPrevia() { clearTimeout(tPrevia); const p = $('#previa'); if (p) { p.hidden = true; p.replaceChildren(); } }
$('#previa').addEventListener('pointerleave', () => esconderPrevia());
function posicionarPrevia(x, y) {
  const p = $('#previa'); p.hidden = false;
  const w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
  p.style.top = (y + 18 + h > innerHeight - 8 ? Math.max(8, y - h - 14) : y + 18) + 'px';
}
async function previaPDF(dest, x, y) {
  const meu = ++previaPedido;
  const d = await destinoPDF(dest).catch(() => null);
  if (!d || meu !== previaPedido || !pdf) return;
  const pg = await pdf.doc.getPage(d.pagina);
  if (meu !== previaPedido || !pdf) return;
  const v1 = pg.getViewport({ scale: 1 }), c = cortePDF();
  const larg = Math.min(480, innerWidth - 24);
  const s = larg / (v1.width * (c.x1 - c.x0));
  const alt = Math.min(250, v1.height * s);
  let topo = d.fy != null ? d.fy * v1.height * s - 14 : c.y0 * v1.height * s;
  topo = Math.max(0, Math.min(topo, v1.height * s - alt));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = pg.getViewport({ scale: s * dpr, offsetX: -c.x0 * v1.width * s * dpr, offsetY: -topo * dpr });
  const cv = document.createElement('canvas'); cv.width = Math.round(larg * dpr); cv.height = Math.round(alt * dpr);
  cv.style.width = larg + 'px'; cv.style.height = alt + 'px';
  const ctx = cv.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise.catch(() => {});
  if (meu !== previaPedido) return;
  const p = $('#previa'); p.className = 'previa previa-pdf';
  const cab = document.createElement('div'); cab.className = 'previa-cab'; cab.textContent = 'pág. ' + d.pagina + ' · clique no link para ir até lá';
  p.replaceChildren(cab, cv);
  posicionarPrevia(x, y);
}

/* EPUB: links internos (notas de rodapé) guardam o "voltar" e mostram a nota ao passar o mouse */
function ganchosEPUB(contents) {
  const doc = contents.document, win = contents.window;
  const ehInterno = a => { const h = a.getAttribute('href') || ''; return h && !/^[a-z][a-z0-9+.-]*:/i.test(h); };
  doc.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || !ehInterno(a) || !epub) return;
    esconderPrevia();
    const l = epub.rend.currentLocation();
    if (l && l.start) {
      historicoLinks.push({ tipo: 'epub', cfi: l.start.cfi, pag: $('#in-pagina').value || '' });
      if (historicoLinks.length > 50) historicoLinks.shift();
      setTimeout(atualizarVoltar, 50);
    }
  }, true);
  doc.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || !ehInterno(a) || !(a.getAttribute('href') || '').includes('#')) return;
    const fr = win.frameElement ? win.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
    agendarPrevia(() => previaEPUB(contents, a, fr.left + e.clientX, fr.top + e.clientY));
  });
  doc.addEventListener('pointerout', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a) cancelarPrevia(); });
  // atalhos com o foco dentro do livro (Ctrl+F, Ctrl+D, Alt+←)
  doc.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey || e.altKey) && ['f', 'F', 'd', 'D', 'ArrowLeft'].includes(e.key)) teclas(e); });
  // atividade (para o tempo de leitura)
  doc.addEventListener('pointermove', () => est.atividade(), { passive: true });
  doc.addEventListener('wheel', () => est.atividade(), { passive: true });
}
async function previaEPUB(contents, a, x, y) {
  const meu = ++previaPedido;
  if (!epub) return;
  const href = a.getAttribute('href'), i = href.indexOf('#');
  const arq = href.slice(0, i), id = decodeURIComponent(href.slice(i + 1));
  let alvo = null, docAlvo = null, secCarregada = null;
  try {
    if (!arq) { docAlvo = contents.document; }
    else {
      const sec = epub.book.spine.get(contents.sectionIndex);
      const base = 'http://l/' + String((sec && (sec.url || sec.href)) || '').replace(/^\//, '');
      const caminho = new URL(arq, base).pathname;
      const outro = (epub.book.spine.spineItems || []).find(s => new URL(String(s.url || s.href || '').replace(/^\//, ''), 'http://l/').pathname === caminho);
      if (outro) { await outro.load(epub.book.load.bind(epub.book)); docAlvo = outro.document; secCarregada = outro; }
    }
    if (docAlvo) alvo = docAlvo.getElementById(id) || docAlvo.querySelector(`[name="${CSS.escape(id)}"]`);
  } catch (e) {}
  if (meu !== previaPedido || !alvo) { if (secCarregada) try { secCarregada.unload(); } catch (e) {} return; }
  let bloco = alvo.closest('aside,li,p,dd,div,section,td') || alvo;
  if ((bloco.textContent || '').trim().length < 3 && bloco.parentElement) bloco = bloco.parentElement.closest('aside,li,p,dd,div,section') || bloco;
  let t = (bloco.textContent || '').replace(/\s+/g, ' ').trim();
  if (secCarregada) try { secCarregada.unload(); } catch (e) {}
  if (!t) return;
  if (t.length > 700) t = t.slice(0, 700) + '…';
  const p = $('#previa'); p.className = 'previa previa-txt';
  const cab = document.createElement('div'); cab.className = 'previa-cab'; cab.textContent = 'Nota · clique no link para ir até ela';
  const corpo = document.createElement('div'); corpo.className = 'previa-corpo'; corpo.textContent = t;
  p.replaceChildren(cab, corpo);
  posicionarPrevia(x, y);
}

/* ================= exibição do PDF: duas páginas, ajuste, recorte ================= */
function mudarExibicaoPDF(mudar) {
  if (!pdf || !reg) return;
  const n = paginaAtualPDF();
  mudar();
  if (pdf.ajuste) pdf.escala = escalaAjuste(pdf.ajuste, n);
  reg.pos.zoom = pdf.escala;
  if (pdf.duas) reg.pos.duas = 1; else delete reg.pos.duas;
  if (pdf.ajuste) reg.pos.ajuste = pdf.ajuste; else delete reg.pos.ajuste;
  if (pdf.recorte) reg.pos.recorte = pdf.recorte; else delete reg.pos.recorte;
  reg.ultima = Date.now(); sujo(); gravar();
  montarPDF(n);
}
/* mede as margens brancas de algumas páginas e escolhe um recorte que serve para todas */
async function medirRecortePDF() {
  const doc = pdf.doc, n = doc.numPages;
  const amostra = [];
  for (let i = Math.min(2, n); i <= n && amostra.length < 8; i += Math.max(1, Math.floor(n / 8))) amostra.push(i);
  if (!amostra.length) amostra.push(1);
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const i of amostra) {
    const pg = await doc.getPage(i);
    const v1 = pg.getViewport({ scale: 1 });
    const s = 300 / v1.width, vp = pg.getViewport({ scale: s });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data, width: W, height: H } = ctx.getImageData(0, 0, cv.width, cv.height);
    let a = W, b = H, c = -1, d = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        if (data[k] < 235 || data[k + 1] < 235 || data[k + 2] < 235) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
      }
    }
    if (c < 0) continue;
    x0 = Math.min(x0, a / W); y0 = Math.min(y0, b / H); x1 = Math.max(x1, (c + 1) / W); y1 = Math.max(y1, (d + 1) / H);
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const folga = 0.02;
  const r = { x0: Math.max(0, x0 - folga), y0: Math.max(0, y0 - folga), x1: Math.min(1, x1 + folga), y1: Math.min(1, y1 + folga) };
  if (r.x1 - r.x0 > 0.96 && r.y1 - r.y0 > 0.96) return 'sem-margem';
  if (r.x1 - r.x0 < 0.3 || r.y1 - r.y0 < 0.3) return null;
  return r;
}
async function alternarRecortePDF() {
  if (!pdf) return;
  if (pdf.recorte) { mudarExibicaoPDF(() => { pdf.recorte = null; }); aviso('Margens de volta'); return; }
  carregando(true, 'Medindo as margens…');
  let r = null;
  try { r = await medirRecortePDF(); } catch (e) { console.warn(e); }
  carregando(false);
  if (r === 'sem-margem') { aviso('Este PDF quase não tem margem branca para recortar.'); return; }
  if (!r) { aviso('Não consegui medir as margens deste PDF.'); return; }
  mudarExibicaoPDF(() => { pdf.recorte = r; if (!pdf.ajuste) pdf.ajuste = 'largura'; });
  aviso('Margens brancas recortadas');
}

/* ================= ficha do arquivo, citação e referências ================= */
function parseAutores(txt) {
  return String(txt || '').split(/\s*;\s*/).map(a => a.trim()).filter(Boolean).map(a => {
    if (a.includes(',')) { const [s, ...n] = a.split(','); return { sobrenome: s.trim(), nome: n.join(',').trim() }; }
    const p = a.split(/\s+/);
    const part = new Set(['de', 'da', 'do', 'dos', 'das', 'van', 'von', 'der', 'del', 'la', 'le', 'di']);
    let k = p.length - 1;
    while (k > 0 && part.has(p[k - 1].toLowerCase()) && k > 1) k--;
    return { sobrenome: p.slice(k).join(' '), nome: p.slice(0, k).join(' ') };
  });
}
function autorCurto(r) {
  const f = r.ficha; if (!f || !f.autores) return '';
  const a = parseAutores(f.autores); if (!a.length) return '';
  const quem = a.length === 1 ? a[0].sobrenome : a.length === 2 ? a[0].sobrenome + ' e ' + a[1].sobrenome : a[0].sobrenome + ' et al.';
  return quem + (f.ano ? ', ' + f.ano : '');
}
/* normaliza autores vindos dos metadados ("Ana Silva and João Souza", "Silva, A.; Souza, J.") */
function autoresDeTexto(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  let partes;
  if (t.includes(';')) partes = t.split(';');
  else if (/\s(and|e|&)\s/i.test(t) || (t.split(',').length > 2)) partes = t.split(/,\s*(?:and|e|&)\s+|\s+(?:and|e|&)\s+|,\s*/i);
  else partes = [t];
  return partes.map(x => x.trim()).filter(x => x && x.length > 1).slice(0, 30).join('; ');
}
const TITULO_RUIM = /^(microsoft (word|powerpoint)|untitled|sem t[ií]tulo|document\d*|doc\d+|\S+\.(docx?|pdf|tex|indd|dvi|qxd))\b|^\s*$/i;
async function fichaAutomatica() {
  const r = reg; if (!r || r.ficha) return;
  const f = {};
  if (pdf) {
    const docAtual = pdf.doc;
    const md = await docAtual.getMetadata().catch(() => null);
    const info = (md && md.info) || {}, x = md && md.metadata;
    const xmp = k => { try { const v = x && x.get(k); return Array.isArray(v) ? v.join('; ') : v; } catch (e) { return null; } };
    const titulo = xmp('dc:title') || info.Title;
    if (titulo && !TITULO_RUIM.test(titulo) && titulo.length > 3) f.titulo = String(titulo).trim();
    const autores = xmp('dc:creator') || info.Author;
    const au = String(autores || '').trim();
    // nomes de programas e de usuários do computador não são autores
    if (au && !/^(user|usu[aá]rio|admin|author|autor|owner|unknown|desconhecido)$/i.test(au) && !/python|docx|microsoft|adobe|acrobat|latex|pdftex|tex\b|office|writer|calibre|ghostscript|quartz|pdf|scanner|epson|canon|hp\b/i.test(au) && !/^[a-z0-9._-]+$/.test(au)) f.autores = autoresDeTexto(au);
    const revista = xmp('prism:publicationName') || xmp('prism:publicationname');
    if (revista) f.revista = String(revista).trim();
    const vol = xmp('prism:volume'); if (vol) f.volume = String(vol).trim();
    let doi = xmp('prism:doi') || xmp('dc:identifier');
    const data = xmp('prism:coverDate') || xmp('prism:coverdate') || xmp('dc:date') || '';
    let m = /(19|20)\d{2}/.exec(String(data)); if (m) f.ano = m[0];
    // DOI escrito na primeira página
    if (!doi || !/^10\./.test(String(doi).replace(/^doi:\s*/i, ''))) {
      try { const t = await textoPaginaPDF(1); m = /\b(10\.\d{4,9}\/[^\s"<>,;]+)/i.exec(t); if (m) doi = m[1]; } catch (e) {}
    }
    if (doi) { doi = String(doi).replace(/^(doi:\s*|https?:\/\/(dx\.)?doi\.org\/)/i, '').replace(/[.)\]]+$/, ''); if (/^10\.\d{4,9}\//.test(doi)) f.doi = doi; }
    // data de criação do arquivo como último recurso (só se não for deste ano: aí costuma ser a data em que o PDF foi gerado)
    if (!f.ano) { const c = /D:(\d{4})/.exec(info.CreationDate || ''); if (c && +c[1] > 1980 && +c[1] < new Date().getFullYear()) f.ano = c[1]; }
    if (!pdf || pdf.doc !== docAtual) return;
  } else if (epub) {
    const meta = await epub.book.loaded.metadata.catch(() => null);
    if (meta) {
      if (meta.title && !TITULO_RUIM.test(meta.title)) f.titulo = meta.title.trim();
      if (meta.creator) f.autores = autoresDeTexto(meta.creator);
      if (meta.publisher) f.revista = meta.publisher.trim();
      const m = /(1[5-9]|20)\d{2}/.exec(meta.pubdate || ''); if (m) f.ano = m[0];
      const id = String(meta.identifier || ''); const d = /(10\.\d{4,9}\/\S+)/.exec(id); if (d) f.doi = d[1];
    }
  }
  if (reg !== r || r.ficha) return;
  f.origem = 'auto';
  r.ficha = f; tocar(r); gravar();
}
async function editarFicha(r) {
  r = r || reg; if (!r) return;
  const f = r.ficha || {};
  const v = await dialogo({
    titulo: 'Ficha de “' + semExt(r.nome) + '”', largo: true,
    texto: f.origem === 'auto' ? 'Preenchida com o que o arquivo informa. Confira e corrija se precisar: ela é usada na citação, na busca e para ordenar a biblioteca.' : 'Usada na citação (Citar), na referência, na busca e para ordenar a biblioteca. Todos os campos são opcionais.',
    campos: [
      { rotulo: 'Título', valor: f.titulo || '', max: 300, opcional: true },
      { rotulo: 'Autores (Sobrenome, Nome; separe vários com ponto e vírgula)', valor: f.autores || '', max: 800, opcional: true, dica: 'Silva, Ana; Souza, João' },
      { rotulo: 'Ano', valor: f.ano || '', max: 10, opcional: true, modo: 'numeric' },
      { rotulo: 'Revista (artigo) ou editora (livro)', valor: f.revista || '', max: 300, opcional: true },
      { rotulo: 'Volume e número', valor: f.volume || '', max: 60, opcional: true, dica: '12, n. 3' },
      { rotulo: 'Páginas', valor: f.paginas || '', max: 40, opcional: true, dica: '45-67' },
      { rotulo: 'DOI', valor: f.doi || '', max: 200, opcional: true, dica: '10.1000/xyz123' }
    ],
    ok: 'Salvar ficha'
  });
  if (!v) return;
  const [titulo, autores, ano, revista, volume, paginas, doi] = v;
  const nova = { titulo, autores: autoresDeTexto(autores), ano, revista, volume, paginas, doi: doi.replace(/^(doi:\s*|https?:\/\/(dx\.)?doi\.org\/)/i, ''), origem: 'manual' };
  for (const k of Object.keys(nova)) if (!nova[k]) delete nova[k];
  r.ficha = nova; tocar(r); gravar();
  aviso('Ficha salva');
  if (!$('#bib-wrap').hidden) desenharLivros();
}
function estiloCitacao() { return dados.prefs.citacao === 'apa' ? 'apa' : 'abnt'; }
function citacaoCurta(r, pagina) {
  const f = (r && r.ficha) || {}, estilo = estiloCitacao();
  const aut = parseAutores(f.autores);
  let quem;
  if (!aut.length) {
    const tit = (f.titulo || semExt(r.nome)).split(/\s+/).slice(0, 3).join(' ');
    quem = estilo === 'abnt' ? tit.toUpperCase() + (tit.split(/\s+/).length < (f.titulo || semExt(r.nome)).split(/\s+/).length ? '…' : '') : tit;
  } else {
    const ss = aut.map(a => estilo === 'abnt' ? a.sobrenome.toUpperCase() : a.sobrenome);
    quem = ss.length === 1 ? ss[0] : ss.length === 2 ? (estilo === 'abnt' ? ss[0] + '; ' + ss[1] : ss[0] + ' & ' + ss[1]) : ss[0] + ' et al.';
  }
  const ano = f.ano || (estilo === 'abnt' ? 's.d.' : 'n.d.');
  return '(' + quem + ', ' + ano + (pagina ? ', p. ' + pagina : '') + ')';
}
function iniciais(nome) { return nome.split(/[\s-]+/).filter(Boolean).map(p => p[0].toUpperCase() + '.').join(' '); }
function referenciaCompleta(r) {
  const f = r.ficha || {}, aut = parseAutores(f.autores), estilo = estiloCitacao();
  const titulo = f.titulo || semExt(r.nome);
  const doi = f.doi ? 'https://doi.org/' + f.doi : '';
  if (estilo === 'apa') {
    const autores = aut.map(a => a.sobrenome + (a.nome ? ', ' + iniciais(a.nome) : ''));
    const quem = autores.length > 1 ? autores.slice(0, -1).join(', ') + ', & ' + autores[autores.length - 1] : autores[0] || '';
    return [quem ? quem + ' ' : '', '(' + (f.ano || 'n.d.') + '). ', titulo + '. ', f.revista ? f.revista + (f.volume ? ', ' + f.volume : '') + (f.paginas ? ', ' + f.paginas : '') + '. ' : '', doi].join('').trim();
  }
  const autores = aut.map(a => a.sobrenome.toUpperCase() + (a.nome ? ', ' + a.nome : ''));
  const quem = autores.length > 3 ? autores[0] + ' et al' : autores.join('; ');
  return [quem ? quem + '. ' : '', titulo + '. ', f.revista ? f.revista + ', ' : '', f.volume ? 'v. ' + f.volume + ', ' : '', f.paginas ? 'p. ' + f.paginas + ', ' : '', (f.ano || '[s.d.]') + '.', doi ? ' DOI: ' + doi + '.' : ''].join('').replace(/,\s*\./, '.').trim();
}
function paginaDaSelecao(p) {
  if (!p) return null;
  if (p.tipo === 'pdf') return p.pagina;
  if (epub && epub.locaisProntos && p.cfi) { try { const c = new ePub.CFI(p.cfi); c.collapse(true); return paginaDeCfi(c.toString()); } catch (e) {} }
  return null;
}
function copiarTexto(t, msg) { navigator.clipboard.writeText(t).then(() => aviso(msg || 'Copiado'), () => aviso('Não consegui copiar.')); }
$('#bt-citar').onclick = () => {
  if (!pendente || !reg) return;
  const pag = paginaDaSelecao(pendente);
  copiarTexto('“' + pendente.texto + '” ' + citacaoCurta(reg, pag), !(reg.ficha && reg.ficha.autores) ? 'Copiado. Dica: preencha a ficha (⋯ › Ficha) para sair com autor e ano.' : 'Trecho copiado com a citação');
  esconderMenus();
};

/* ================= exportar anotações ================= */
function ordenadas() { return reg.marcas.slice().sort((a, b) => ordemMarca(a) - ordemMarca(b)); }
const NOME_COR = { amarelo: 'amarelo', verde: 'verde', rosa: 'rosa', azul: 'azul' };
function markdownDoLivro(r, marcas, comCabecalho = true) {
  const f = r.ficha || {};
  let t = '';
  if (comCabecalho) {
    t += '---\n';
    t += 'titulo: "' + (f.titulo || semExt(r.nome)).replace(/"/g, "'") + '"\n';
    if (f.autores) t += 'autores: "' + f.autores.replace(/"/g, "'") + '"\n';
    if (f.ano) t += 'ano: ' + f.ano + '\n';
    if (f.doi) t += 'doi: "' + f.doi + '"\n';
    if (r.etiquetas && r.etiquetas.length) t += 'etiquetas: [' + r.etiquetas.map(e => '"' + e.replace(/"/g, "'") + '"').join(', ') + ']\n';
    t += 'exportado: ' + hojeISO() + '\n---\n\n';
  }
  t += '# ' + (f.titulo || semExt(r.nome)) + '\n\n';
  if (f.autores || f.ano) t += '*' + referenciaCompleta(r) + '*\n\n';
  for (const m of marcas) {
    t += m.texto.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    const onde = m.pagina ? 'p. ' + m.pagina : (r === reg ? ondeMarca(m) : '');
    t += '— ' + [onde, NOME_COR[m.cor]].filter(Boolean).join(' · ') + '\n\n';
    if (m.nota) t += '**Nota:** ' + m.nota.replace(/\n/g, '  \n') + '\n\n';
    t += '---\n\n';
  }
  return t;
}
function bibtexDe(r) {
  const f = r.ficha || {}, aut = parseAutores(f.autores);
  const ascii = s => String(s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  const chave = (ascii(aut[0] ? aut[0].sobrenome : 'semautor').replace(/[^A-Za-z]/g, '').toLowerCase() || 'semautor') + (f.ano || '') + (ascii((f.titulo || semExt(r.nome)).split(/\s+/).find(w => w.length > 3) || '').replace(/[^A-Za-z]/g, '').toLowerCase());
  const campos = [];
  const add = (k, v) => { if (v) campos.push('  ' + k + ' = {' + String(v).replace(/[{}]/g, '') + '}'); };
  add('author', aut.map(a => a.sobrenome + (a.nome ? ', ' + a.nome : '')).join(' and '));
  add('title', f.titulo || semExt(r.nome));
  add(r.tipo === 'pdf' ? 'journal' : 'publisher', f.revista);
  add('year', f.ano); add('volume', f.volume); add('pages', f.paginas ? f.paginas.replace(/\s*[-–]\s*/, '--') : ''); add('doi', f.doi);
  return '@' + (r.tipo === 'pdf' && f.revista ? 'article' : r.tipo === 'pdf' ? 'misc' : 'book') + '{' + chave + ',\n' + campos.join(',\n') + '\n}\n';
}
async function salvarTexto(nome, texto, tipo, msg) {
  const bytes = new TextEncoder().encode(texto);
  try { const onde = await API.salvar(nome, bytes, tipo); if (onde) aviso(msg || 'Arquivo salvo'); }
  catch (e) { console.error(e); aviso('Não consegui salvar o arquivo.'); }
}
function menuExportar(ancora) {
  if (!reg) return;
  const tem = reg.marcas.length > 0;
  const itens = [
    { secao: 'Anotações deste arquivo' },
    { rotulo: 'Markdown (.md) — Obsidian, Notion…', desativado: !tem, acao: () => salvarTexto(semExt(reg.nome) + ' - anotações.md', markdownDoLivro(reg, ordenadas()), 'md', 'Anotações exportadas em Markdown') },
    { rotulo: 'Texto simples (.txt)', desativado: !tem, acao: exportarTXT }
  ];
  if (pdf) itens.push({ rotulo: 'Cópia do PDF com as marcações', desativado: !tem, acao: exportarPDF });
  itens.push('-', { secao: 'Referência' },
    { rotulo: 'BibTeX (.bib) — Zotero, Mendeley, LaTeX', acao: () => salvarTexto(semExt(reg.nome) + '.bib', bibtexDe(reg), 'bib', 'Referência exportada') },
    { rotulo: 'Copiar a referência (' + (estiloCitacao() === 'apa' ? 'APA' : 'ABNT') + ')', acao: () => copiarTexto(referenciaCompleta(reg), 'Referência copiada') });
  if (!tem) itens.splice(1, 0, { secao: 'Ainda não há marcações neste arquivo.' });
  abrirMenu(ancora, itens);
}

/* ================= menu "mais opções" da leitura ================= */
function menuMaisOpcoes() {
  if (!reg) return;
  const itens = [];
  if (ehMovel()) itens.push({ rotulo: marcadorAqui() ? 'Tirar o marcador desta página' : 'Marcar esta página', acao: alternarMarcador }, '-');
  if (pdf) {
    itens.push({ secao: 'Exibição do PDF' },
      { rotulo: 'Uma página por vez', ativo: !pdf.duas, acao: () => mudarExibicaoPDF(() => { pdf.duas = false; }) },
      { rotulo: 'Duas páginas lado a lado', ativo: pdf.duas, acao: () => mudarExibicaoPDF(() => { pdf.duas = true; }) },
      '-',
      { rotulo: 'Ajustar à largura', ativo: pdf.ajuste === 'largura', acao: () => mudarExibicaoPDF(() => { pdf.ajuste = pdf.ajuste === 'largura' ? null : 'largura'; }) },
      { rotulo: 'Página inteira na tela', ativo: pdf.ajuste === 'altura', acao: () => mudarExibicaoPDF(() => { pdf.ajuste = pdf.ajuste === 'altura' ? null : 'altura'; }) },
      { rotulo: 'Recortar margens brancas', ativo: !!pdf.recorte, acao: alternarRecortePDF },
      '-');
  } else if (epub) {
    itens.push({ rotulo: 'Margens, linhas e alinhamento…', acao: () => popLayout(true) },
      { rotulo: epub.rolagem ? 'Virar páginas (em vez de rolar)' : 'Rolar o texto (em vez de virar páginas)', acao: () => mudarLayout('rolagem', epub.rolagem ? '0' : '1') }, '-');
  }
  itens.push({ secao: 'Este arquivo' },
    { rotulo: 'Ficha (autor, ano, DOI)…', acao: () => editarFicha(reg) },
    { rotulo: 'Etiquetas…', acao: () => editarEtiquetas(reg) },
    { rotulo: 'Exportar anotações…', acao: () => menuExportar($('#bt-mais-opcoes')) },
    { rotulo: voz.ativa ? 'Parar a leitura em voz alta' : 'Ler em voz alta a partir daqui', desativado: !('speechSynthesis' in window), acao: () => (voz.ativa ? voz.parar() : voz.iniciar()) },
    '-', { secao: 'Citação' },
    { rotulo: 'Estilo ABNT — (SILVA, 2021, p. 4)', ativo: estiloCitacao() === 'abnt', acao: () => { dados.prefs.citacao = 'abnt'; gravar(); } },
    { rotulo: 'Estilo APA — (Silva, 2021, p. 4)', ativo: estiloCitacao() === 'apa', acao: () => { dados.prefs.citacao = 'apa'; gravar(); } });
  abrirMenu($('#bt-mais-opcoes'), itens);
}
$('#bt-mais-opcoes').onclick = menuMaisOpcoes;

/* ================= biblioteca: busca, filtros, ordem e etiquetas ================= */
let buscaBib = '';
const GRUPO_TIPO = { pdf: 'pdf', epub: 'epub', docx: 'word', doc: 'word', txt: 'texto', md: 'texto', html: 'texto' };
function prefsFiltro() { const f = dados.prefs.filtros; return f && typeof f === 'object' ? f : (dados.prefs.filtros = {}); }
function filtrosAtivos() { const f = prefsFiltro(); return !!(buscaBib || f.tipo || f.estado || f.etiqueta); }
function todasEtiquetas() {
  const c = new Map();
  for (const r of Object.values(dados.livros)) if (!r.apagado) for (const t of r.etiquetas || []) c.set(t, (c.get(t) || 0) + 1);
  return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
}
function filtrarLivros(lista) {
  const f = prefsFiltro();
  const q = normTermo(buscaBib);
  let out = lista.filter(r => {
    if (f.tipo && GRUPO_TIPO[r.tipo] !== f.tipo) return false;
    if (f.estado === 'lido' && !r.lido) return false;
    if (f.estado === 'lendo' && (r.lido || !(r.progresso > 0.005))) return false;
    if (f.estado === 'novo' && (r.lido || r.progresso > 0.005)) return false;
    if (f.etiqueta && !(r.etiquetas || []).includes(f.etiqueta)) return false;
    if (q) {
      const fi = r.ficha || {};
      const alvo = normTermo([r.nome, fi.titulo, fi.autores, fi.ano, fi.revista, fi.doi, (r.etiquetas || []).join(' ')].filter(Boolean).join(' '));
      if (!q.split(' ').every(p => alvo.includes(p))) return false;
    }
    return true;
  });
  const titulo = r => normTermo((r.ficha && r.ficha.titulo) || semExt(r.nome));
  const autor = r => { const a = parseAutores(r.ficha && r.ficha.autores)[0]; return a ? normTermo(a.sobrenome + ' ' + a.nome) : '￿'; };
  const ordem = f.ordem || 'recentes';
  const cmp = {
    recentes: (a, b) => (b.ultima || 0) - (a.ultima || 0),
    titulo: (a, b) => titulo(a).localeCompare(titulo(b), 'pt-BR'),
    autor: (a, b) => autor(a).localeCompare(autor(b), 'pt-BR') || titulo(a).localeCompare(titulo(b), 'pt-BR'),
    ano: (a, b) => (parseInt((b.ficha && b.ficha.ano) || 0, 10) - parseInt((a.ficha && a.ficha.ano) || 0, 10)) || titulo(a).localeCompare(titulo(b), 'pt-BR'),
    progresso: (a, b) => ((b.lido ? 2 : b.progresso || 0) - (a.lido ? 2 : a.progresso || 0))
  }[ordem] || ((a, b) => (b.ultima || 0) - (a.ultima || 0));
  return out.sort(cmp);
}
function atualizarFiltros() {
  const f = prefsFiltro();
  $('#f-tipo').value = f.tipo || ''; $('#f-estado').value = f.estado || ''; $('#f-ordem').value = f.ordem || 'recentes';
  const sel = $('#f-etiqueta'), tags = todasEtiquetas();
  if (f.etiqueta && !tags.some(t => t[0] === f.etiqueta)) f.etiqueta = '';
  sel.replaceChildren(new Option('Todas as etiquetas', ''), ...tags.map(([t, n]) => new Option(t + ' (' + n + ')', t)));
  sel.value = f.etiqueta || '';
  sel.hidden = !tags.length;
  for (const id of ['#f-tipo', '#f-estado', '#f-etiqueta']) $(id).classList.toggle('ativo', !!$(id).value);
}
for (const [id, k] of [['#f-tipo', 'tipo'], ['#f-estado', 'estado'], ['#f-etiqueta', 'etiqueta'], ['#f-ordem', 'ordem']]) {
  $(id).addEventListener('change', e => { prefsFiltro()[k] = e.target.value; gravar(); desenharLivros(); e.target.blur(); });
}
(() => {
  let t = null;
  $('#bib-busca').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { buscaBib = e.target.value; desenharLivros(); }, 160); });
  $('#bib-busca').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); e.target.value = ''; buscaBib = ''; desenharLivros(); } });
})();
async function editarEtiquetas(r) {
  r = r || reg; if (!r) return;
  const existentes = todasEtiquetas().map(t => t[0]);
  for (const t of r.etiquetas || []) if (!existentes.includes(t)) existentes.push(t);
  const v = await dialogo({
    titulo: 'Etiquetas de “' + semExt(r.nome) + '”',
    texto: existentes.length ? 'Marque as etiquetas deste livro ou crie novas. Um livro pode ter várias.' : 'Etiquetas organizam os livros por assunto (um livro pode ter várias, além da pasta). Separe várias com vírgula.',
    marcar: existentes.length ? { itens: existentes.map(t => ({ rotulo: t, valor: t, marcado: (r.etiquetas || []).includes(t) })) } : null,
    campos: [{ rotulo: 'Nova etiqueta (separe várias com vírgula)', valor: '', max: 400, opcional: true, dica: 'Tese, Metodologia' }],
    ok: 'Salvar'
  });
  if (!v) return;
  const campos = Array.isArray(v) ? v : v.campos, marcados = Array.isArray(v) ? [] : v.marcados;
  const novas = String(campos[0] || '').split(',').map(t => t.replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean);
  const lista = [...new Set([...marcados, ...novas])].slice(0, 30);
  if (lista.length) r.etiquetas = lista; else delete r.etiquetas;
  tocar(r); gravar();
  aviso(lista.length ? 'Etiquetas: ' + lista.join(', ') : 'Sem etiquetas');
  if (!$('#bib-wrap').hidden) desenharLivros();
}

/* ================= telas cheias (todas as anotações, estatísticas) ================= */
function abrirTela(titulo, acoes) {
  $('#tela-tit').textContent = titulo;
  $('#tela-acoes').replaceChildren(...(acoes || []));
  $('#tela').hidden = false;
  return $('#tela-corpo');
}
function fecharTela() { $('#tela').hidden = true; $('#tela-corpo').replaceChildren(); $('#tela-acoes').replaceChildren(); }
$('#tela-fechar').onclick = fecharTela;
$('#tela').addEventListener('mousedown', e => { if (e.target === $('#tela')) fecharTela(); });

function telaTodasNotas(soLivro) {
  const campo = document.createElement('input'); campo.type = 'search'; campo.className = 'tela-busca'; campo.placeholder = 'Procurar nas marcações e notas'; campo.setAttribute('aria-label', 'Procurar nas marcações');
  const cor = document.createElement('select'); cor.className = 'sel'; cor.setAttribute('aria-label', 'Cor');
  cor.append(new Option('Todas as cores', ''), new Option('Só com nota', 'nota'), ...Object.keys(CORES).map(c => new Option(c[0].toUpperCase() + c.slice(1), c)));
  const exp = document.createElement('button'); exp.className = 'bt'; exp.textContent = 'Exportar (.md)';
  const corpo = abrirTela(soLivro && dados.livros[soLivro] ? 'Marcações de “' + semExt(dados.livros[soLivro].nome) + '”' : 'Todas as anotações', [campo, cor, exp]);
  const livros = Object.values(dados.livros).filter(r => !r.apagado && (r.marcas || []).length && (!soLivro || r.id === soLivro)).sort((a, b) => (b.ultima || 0) - (a.ultima || 0));
  let filtrados = [];
  const desenhar = () => {
    const q = normTermo(campo.value), c = cor.value;
    filtrados = [];
    const frag = document.createDocumentFragment();
    let total = 0;
    for (const r of livros) {
      const ms = r.marcas.filter(m => (!c || (c === 'nota' ? !!m.nota : m.cor === c)) && (!q || q.split(' ').every(p => normTermo(m.texto + ' ' + (m.nota || '')).includes(p))))
        .sort((a, b) => (a.pagina || 0) - (b.pagina || 0) || (a.criado || 0) - (b.criado || 0));
      if (!ms.length) continue;
      filtrados.push([r, ms]); total += ms.length;
      const g = document.createElement('section'); g.className = 'tn-livro';
      const h = document.createElement('h3'); h.textContent = (r.ficha && r.ficha.titulo) || semExt(r.nome);
      const sub = document.createElement('div'); sub.className = 'tn-sub'; sub.textContent = [autorCurto(r), ms.length + (ms.length > 1 ? ' marcações' : ' marcação')].filter(Boolean).join(' · ');
      g.append(h, sub);
      for (const m of ms) {
        const it = document.createElement('button'); it.className = 'nota-item tn-item ' + m.cor;
        it.innerHTML = '<span class="onde"></span><span class="trecho"></span>' + (m.nota ? '<span class="txt"></span>' : '');
        it.querySelector('.onde').textContent = (m.pagina ? 'Pág. ' + m.pagina + ' · ' : '') + dataBR(m.criado || m.alterada || Date.now()).split(' ')[0] + (m.nota ? ' · com nota' : '');
        it.querySelector('.trecho').textContent = '“' + m.texto + '”';
        if (m.nota) it.querySelector('.txt').textContent = m.nota;
        it.onclick = () => { fecharTela(); if (atual && atual.id === r.id) irParaMarca(m.id); else { irDepoisDeAbrir = { marca: m.id }; abrirLivro(r.id); } };
        g.appendChild(it);
      }
      frag.appendChild(g);
    }
    if (!total) { const p = document.createElement('p'); p.className = 'vazio'; p.textContent = livros.length ? 'Nenhuma marcação com esse filtro.' : 'Você ainda não fez marcações. Selecione um trecho em qualquer livro para destacar ou escrever uma nota.'; frag.appendChild(p); }
    corpo.replaceChildren(frag);
    exp.disabled = !total;
  };
  let t = null;
  campo.oninput = () => { clearTimeout(t); t = setTimeout(desenhar, 150); };
  cor.onchange = desenhar;
  exp.onclick = () => {
    const md = filtrados.map(([r, ms]) => markdownDoLivro(r, ms, false)).join('\n');
    salvarTexto(soLivro ? semExt(dados.livros[soLivro].nome) + ' - anotações.md' : 'Mr. B Reader - todas as anotações ' + hojeISO() + '.md', md, 'md', 'Anotações exportadas');
  };
  desenhar();
  setTimeout(() => campo.focus(), 50);
}
$('#bt-todas-notas').onclick = () => telaTodasNotas();

/* ================= marcadores de página ================= */
function marcadorAqui() {
  if (!reg || !reg.marcadores) return null;
  if (pdf) { const p = paginaAtualPDF(); return reg.marcadores.find(m => m.pagina === p) || null; }
  if (epub) {
    const l = epub.rend.currentLocation(); if (!l || !l.start) return null;
    return reg.marcadores.find(m => m.cfi && (m.cfi === l.start.cfi || naTela(m.cfi, l))) || null;
  }
  return null;
}
function atualizarBotaoMarcador() {
  const b = $('#bt-marcador'), m = !!marcadorAqui();
  b.classList.toggle('ativo', m); b.setAttribute('aria-pressed', String(m));
  b.title = m ? 'Tirar o marcador desta página (Ctrl+D)' : 'Marcar esta página (Ctrl+D)';
}
function rotuloMarcador() {
  if (pdf) return '';
  try {
    const l = epub.rend.currentLocation(), rg = epub.rend.getRange(l.start.cfi);
    let t = '';
    if (rg) { const n = rg.startContainer; t = (n.nodeType === 3 ? n.data.slice(rg.startOffset) : n.textContent) || ''; if (t.trim().length < 20 && n.parentElement) t = n.parentElement.closest(BLOCOS).textContent || t; }
    t = t.replace(/\s+/g, ' ').trim().slice(0, 110);
    const cap = capituloEPUB(l);
    return (cap ? cap + ' — ' : '') + t;
  } catch (e) { return ''; }
}
function alternarMarcador() {
  if (!reg || (!pdf && !epub)) return;
  const ja = marcadorAqui();
  reg.marcadores = reg.marcadores || [];
  if (ja) {
    reg.marcadores = reg.marcadores.filter(m => m.id !== ja.id);
    reg.marcadoresApagados = reg.marcadoresApagados || {}; reg.marcadoresApagados[ja.id] = Date.now();
    aviso('Marcador removido');
  } else {
    const m = { id: uid(), criado: Date.now(), alterada: Date.now(), rotulo: rotuloMarcador() };
    if (pdf) m.pagina = paginaAtualPDF();
    else { const l = epub.rend.currentLocation(); if (!l || !l.start) return; m.cfi = l.start.cfi; }
    reg.marcadores.push(m);
    aviso('Página marcada');
  }
  if (!reg.marcadores.length) delete reg.marcadores;
  sujo(); gravar();
  atualizarBotaoMarcador(); atualizarListaMarcadores();
}
$('#bt-marcador').onclick = alternarMarcador;
function posMarcador(m) {
  if (m.pagina) return m.pagina;
  if (epub && epub.locaisProntos) { try { return epub.book.locations.percentageFromCfi(m.cfi) * 1e6; } catch (e) {} }
  return m.criado;
}
function atualizarListaMarcadores() {
  const box = $('#lista-marcadores');
  const ms = reg && reg.marcadores ? reg.marcadores.slice().sort((a, b) => posMarcador(a) - posMarcador(b)) : [];
  $('#qtd-marcadores').textContent = ms.length ? '(' + ms.length + ')' : '';
  $('#sem-marcadores').hidden = ms.length > 0;
  const frag = document.createDocumentFragment();
  for (const m of ms) {
    const it = document.createElement('div'); it.className = 'marcador-item'; it.tabIndex = 0;
    let onde = m.pagina ? 'Pág. ' + m.pagina : '';
    if (!onde && epub && epub.locaisProntos) { try { onde = 'Pág. ' + paginaDeCfi(m.cfi); } catch (e) {} }
    it.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg><span class="mi-txt"><span class="onde"></span><span class="rot"></span></span><button class="mi-x" title="Tirar marcador" aria-label="Tirar marcador"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    it.querySelector('.onde').textContent = [onde, dataBR(m.criado).split(' ')[0]].filter(Boolean).join(' · ');
    it.querySelector('.rot').textContent = m.rotulo || '';
    const ir = () => { if (m.pagina) irPaginaPDF(m.pagina, true); else if (epub) epub.rend.display(m.cfi); if (ehMovel()) painel(false); };
    it.onclick = e => {
      if (e.target.closest('.mi-x')) {
        reg.marcadores = reg.marcadores.filter(x => x.id !== m.id); if (!reg.marcadores.length) delete reg.marcadores;
        reg.marcadoresApagados = reg.marcadoresApagados || {}; reg.marcadoresApagados[m.id] = Date.now();
        sujo(); gravar(); atualizarListaMarcadores(); atualizarBotaoMarcador(); return;
      }
      ir();
    };
    it.onkeydown = e => { if (e.key === 'Enter') ir(); };
    frag.appendChild(it);
  }
  box.replaceChildren(frag);
}

/* ================= seleção: definir, traduzir, pesquisar, ouvir ================= */
$('#bt-sel-mais').onclick = () => {
  if (!pendente) return;
  const t = pendente.texto.trim(), curto = t.split(/\s+/).length <= 3 && t.length <= 60;
  const p = pendente;
  const itens = [];
  if (curto) itens.push({ rotulo: 'Definir “' + t + '”', acao: () => abrirExterno('https://www.google.com/search?hl=pt-BR&q=' + encodeURIComponent('define ' + t)) });
  itens.push(
    { rotulo: 'Traduzir para o português', acao: () => abrirExterno('https://translate.google.com/?sl=auto&tl=pt&op=translate&text=' + encodeURIComponent(t.slice(0, 4500))) },
    { rotulo: 'Traduzir para o inglês', acao: () => abrirExterno('https://translate.google.com/?sl=auto&tl=en&op=translate&text=' + encodeURIComponent(t.slice(0, 4500))) },
    { rotulo: 'Pesquisar na internet', acao: () => abrirExterno('https://www.google.com/search?q=' + encodeURIComponent(t.slice(0, 300))) },
    { rotulo: 'Procurar no arquivo', acao: () => abrirBusca(t.slice(0, 120)) }
  );
  if ('speechSynthesis' in window) itens.push({ rotulo: 'Ouvir este trecho', acao: () => voz.falarTrecho(p.texto) });
  itens.push('-', { secao: 'Abre no navegador. Só o trecho escolhido é enviado.' });
  abrirMenu($('#bt-sel-mais'), itens);
};

/* ================= leitura em voz alta ================= */
const voz = {
  ativa: false, pausada: false, frases: [], i: 0, rodada: 0, anot: null, pagina: 0,
  vozes() { return 'speechSynthesis' in window ? speechSynthesis.getVoices() : []; },
  escolhida() {
    const vs = this.vozes(), pref = dados.prefs.voz && dados.prefs.voz.nome;
    return vs.find(v => v.name === pref) || vs.find(v => /^pt-BR/i.test(v.lang)) || vs.find(v => /^pt/i.test(v.lang)) || vs.find(v => v.default) || vs[0] || null;
  },
  velocidade() { const v = dados.prefs.voz && +dados.prefs.voz.vel; return v >= 0.6 && v <= 2.2 ? v : 1; },
  montarControles() {
    const sel = $('#voz-sel'), vs = this.vozes(), e = this.escolhida();
    const ord = vs.slice().sort((a, b) => (/^pt/i.test(b.lang) - /^pt/i.test(a.lang)) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    sel.replaceChildren(...ord.map(v => { const o = new Option(v.name.replace(/^(Microsoft|Google)\s+/, '') + ' (' + v.lang + ')', v.name); return o; }));
    if (e) sel.value = e.name;
    sel.hidden = !vs.length;
    $('#voz-vel').value = this.velocidade(); $('#voz-vel-txt').textContent = this.velocidade().toFixed(1).replace('.', ',') + '×';
    this.botao();
  },
  botao() {
    const b = $('#voz-tocar');
    b.innerHTML = this.pausada ? '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13M16 5.5v13"/></svg>';
    b.title = this.pausada ? 'Continuar' : 'Pausar';
  },
  dividir(t) {
    const out = [];
    for (const f of String(t).replace(/\s+/g, ' ').match(/[^.!?…;:]+[.!?…;:]*["”’)\]]*\s*|.+$/g) || []) {
      let s = f.trim(); if (!s) continue;
      while (s.length > 240) { let k = s.lastIndexOf(',', 240); if (k < 80) k = s.lastIndexOf(' ', 240); if (k < 40) k = 240; out.push(s.slice(0, k + 1).trim()); s = s.slice(k + 1).trim(); }
      if (s) out.push(s);
    }
    return out;
  },
  /* frases do EPUB a partir de um ponto: guarda o texto e a posição (cfi) de cada uma */
  frasesEPUB(contents, desde) {
    const doc = contents.document; if (!doc || !doc.body) return [];
    const { txt, nos } = textoComNos(doc.body, true);
    let ini = 0;
    if (desde) { const k = nos.findIndex(x => x.no === desde.no); if (k >= 0) ini = nos[k].ini + Math.min(desde.off, nos[k].no.data.length); }
    const out = [];
    const re = /[^.!?…]+[.!?…]*["”’)\]]*\s*/g; re.lastIndex = ini;
    // volta para o começo da frase em que está o ponto
    let a = ini; while (a > 0 && !/[.!?…]\s/.test(txt.slice(a - 2, a))) a--;
    re.lastIndex = a;
    let m;
    while ((m = re.exec(txt))) {
      if (!m[0]) { re.lastIndex++; continue; }
      const bruto = m[0], s = bruto.trim(); if (!s) continue;
      const a0 = m.index + (bruto.length - bruto.trimStart().length), b0 = a0 + s.length;
      for (const parte of this.dividir(s)) {
        const k = txt.indexOf(parte, a0);
        const rg = k >= 0 ? faixaNoTexto(doc, nos, k, k + parte.length) : null;
        let cfi = null; try { if (rg) cfi = contents.cfiFromRange(rg); } catch (e) {}
        out.push({ texto: parte, cfi });
      }
      if (b0 >= txt.length) break;
    }
    return out;
  },
  async iniciar() {
    if (!('speechSynthesis' in window)) { aviso('Este aparelho não tem leitura em voz alta.'); return; }
    if (!this.vozes().length) { await new Promise(ok => { speechSynthesis.onvoiceschanged = ok; setTimeout(ok, 1500); }); }
    this.parar(true);
    this.ativa = true; this.pausada = false; this.rodada++;
    $('#voz').hidden = false; this.montarControles();
    document.body.classList.add('com-voz');
    await this.prepararDaqui();
    this.falar();
  },
  async prepararDaqui() {
    this.frases = []; this.i = 0;
    if (pdf) {
      this.pagina = paginaAtualPDF();
      const t = await textoPaginaPDF(this.pagina);
      this.frases = this.dividir(t).map(texto => ({ texto }));
    } else if (epub) {
      const l = epub.rend.currentLocation(); if (!l || !l.start) return;
      const c = epub.rend.getContents().find(x => x.sectionIndex === l.start.index) || epub.rend.getContents()[0];
      let desde = null;
      try { const rg = epub.rend.getRange(l.start.cfi); if (rg && rg.startContainer.nodeType === 3) desde = { no: rg.startContainer, off: rg.startOffset }; else if (rg) { const w = c.document.createTreeWalker(rg.startContainer, NodeFilter.SHOW_TEXT); const n = w.nextNode(); if (n) desde = { no: n, off: 0 }; } } catch (e) {}
      this.secao = l.start.index;
      this.frases = c ? this.frasesEPUB(c, desde) : [];
    }
  },
  async seguinte() {
    // acabou a página (PDF) ou o capítulo (EPUB): passa para o próximo
    if (pdf) {
      if (this.pagina >= pdf.doc.numPages) { this.parar(); aviso('Fim do arquivo'); return false; }
      this.pagina++; irPaginaPDF(this.pagina, true);
      const t = await textoPaginaPDF(this.pagina);
      this.frases = this.dividir(t).map(texto => ({ texto })); this.i = 0;
      return true;
    }
    if (epub) {
      const prox = epub.book.spine.get(this.secao + 1);
      if (!prox) { this.parar(); aviso('Fim do livro'); return false; }
      await epub.rend.display(prox.href);
      await esperaMs(150);
      const c = epub.rend.getContents().find(x => x.sectionIndex === prox.index) || epub.rend.getContents()[0];
      this.secao = prox.index; this.frases = c ? this.frasesEPUB(c, null) : []; this.i = 0;
      return true;
    }
    return false;
  },
  async falar() {
    if (!this.ativa || this.pausada) return;
    const rodada = this.rodada;
    while (this.i >= this.frases.length) {
      if (!(await this.seguinte()) || rodada !== this.rodada) return;
    }
    const f = this.frases[this.i];
    await this.mostrar(f);
    if (rodada !== this.rodada || this.pausada) return;
    const u = new SpeechSynthesisUtterance(f.texto);
    const v = this.escolhida(); if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = this.velocidade();
    u.onend = () => { if (rodada !== this.rodada || this.pausada) return; this.i++; est.atividade(); this.falar(); };
    u.onerror = e => { if (rodada !== this.rodada || e.error === 'interrupted' || e.error === 'canceled') return; this.i++; setTimeout(() => this.falar(), 50); };
    speechSynthesis.speak(u);
  },
  async mostrar(f) {
    if (!epub || !f.cfi) return;
    try {
      if (this.anot) { epub.rend.annotations.remove(this.anot, 'underline'); this.anot = null; }
      const l = epub.rend.currentLocation();
      if (l && l.end && !l.atEnd && cfiCmp(f.cfi, l.end.cfi) > 0) await epub.rend.display(f.cfi);
      epub.rend.annotations.underline(f.cfi, {}, null, 'mrb-voz', { fill: '#4696f0', 'fill-opacity': '0.16', stroke: '#4696f0', 'stroke-opacity': '0.7' });
      this.anot = f.cfi;
    } catch (e) {}
  },
  alternarPausa() {
    if (!this.ativa) return;
    this.pausada = !this.pausada; this.rodada++;
    if (this.pausada) speechSynthesis.cancel(); else this.falar();
    this.botao();
  },
  parar(semEsconder) {
    this.rodada++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.anot && epub) { try { epub.rend.annotations.remove(this.anot, 'underline'); } catch (e) {} }
    this.anot = null; this.ativa = false; this.pausada = false; this.frases = [];
    if (!semEsconder) { $('#voz').hidden = true; document.body.classList.remove('com-voz'); }
  },
  falarTrecho(t) {
    if (!('speechSynthesis' in window)) return;
    this.parar(); speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); const v = this.escolhida(); if (v) { u.voice = v; u.lang = v.lang; } u.rate = this.velocidade();
    speechSynthesis.speak(u);
  }
};
$('#voz-tocar').onclick = () => voz.alternarPausa();
$('#voz-parar').onclick = () => voz.parar();
$('#voz-vel').addEventListener('input', e => {
  dados.prefs.voz = Object.assign({}, dados.prefs.voz, { vel: +e.target.value }); gravar();
  $('#voz-vel-txt').textContent = (+e.target.value).toFixed(1).replace('.', ',') + '×';
});
$('#voz-vel').addEventListener('change', () => { if (voz.ativa && !voz.pausada) { voz.rodada++; speechSynthesis.cancel(); voz.falar(); } });
$('#voz-sel').addEventListener('change', e => {
  dados.prefs.voz = Object.assign({}, dados.prefs.voz, { nome: e.target.value }); gravar(); e.target.blur();
  if (voz.ativa && !voz.pausada) { voz.rodada++; speechSynthesis.cancel(); voz.falar(); }
});

/* ================= layout do texto (EPUB, Word e textos) ================= */
function popLayout(abrir) {
  const p = $('#pop-layout'), b = $('#bt-layout');
  if (abrir === undefined) abrir = p.hidden;
  if (abrir && !epub) return;
  p.hidden = !abrir; b.setAttribute('aria-expanded', String(abrir)); b.classList.toggle('ativo', abrir);
  if (!abrir) return;
  marcarLayout();
  if (!ehMovel()) {
    const r = b.getBoundingClientRect(), w = p.offsetWidth;
    p.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px'; p.style.top = (r.bottom + 6) + 'px';
  } else { p.style.left = ''; p.style.top = ''; }
}
function marcarLayout() {
  const l = layoutAtual(), vals = { margem: String(l.margem), linha: String(l.linha), alinhar: l.alinhar, rolagem: dados.prefs.rolagem ? '1' : '0' };
  document.querySelectorAll('#pop-layout .segm').forEach(g => g.querySelectorAll('button').forEach(b => { const on = b.dataset.v === vals[g.dataset.chave]; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); }));
}
function mudarLayout(chave, v) {
  if (chave === 'rolagem') {
    const ligar = v === '1';
    if (!!dados.prefs.rolagem === ligar) return;
    dados.prefs.rolagem = ligar ? 1 : 0; gravar(); marcarLayout();
    recarregarEPUB().then(() => aviso(ligar ? 'Agora é só rolar o texto' : 'De volta a virar páginas'));
    return;
  }
  const l = Object.assign({}, dados.prefs.layout || {});
  l[chave] = chave === 'alinhar' ? v : +v;
  dados.prefs.layout = l; gravar(); marcarLayout();
  aplicarLayoutEPUB();
}
document.querySelectorAll('#pop-layout .segm').forEach(g => g.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) mudarLayout(g.dataset.chave, b.dataset.v); }));
$('#bt-layout').onclick = () => popLayout();

/* ================= tempo de leitura e estatísticas ================= */
const est = {
  t: null, ultimoTick: 0, ultimaAtividade: 0, ultimaPagina: null, ultimaTroca: 0,
  iniciar() {
    this.parar();
    this.ultimoTick = Date.now(); this.ultimaAtividade = Date.now(); this.ultimaPagina = null; this.ultimaTroca = Date.now();
    this.t = setInterval(() => this.tique(), 15000);
  },
  parar() { if (this.t) { this.tique(); clearInterval(this.t); this.t = null; } },
  atividade() { this.ultimaAtividade = Date.now(); },
  dia() {
    const e = dados.prefs.estat && typeof dados.prefs.estat === 'object' ? dados.prefs.estat : (dados.prefs.estat = {});
    e.dias = e.dias && typeof e.dias === 'object' ? e.dias : {};
    const h = hojeISO();
    if (!e.dias[h]) {
      e.dias[h] = { seg: 0, pags: 0 };
      const ks = Object.keys(e.dias).sort(); while (ks.length > 400) delete e.dias[ks.shift()];   // guarda pouco mais de um ano
    }
    return e.dias[h];
  },
  tique() {
    const agora = Date.now(), dt = Math.min(agora - this.ultimoTick, 30000) / 1000;
    this.ultimoTick = agora;
    if (!reg || document.visibilityState !== 'visible') return;
    // conta só se houve atividade nos últimos 3 minutos (ou se a voz está lendo)
    if (agora - this.ultimaAtividade > 180000 && !voz.ativa) return;
    const ap = aparelhoId();
    reg.tempo = reg.tempo || {}; reg.tempo[ap] = Math.round((reg.tempo[ap] || 0) + dt);
    this.dia().seg += dt;
    gravar();
  },
  pagina(n) {
    const agora = Date.now();
    this.ultimaAtividade = agora;
    if (this.ultimaPagina != null && n > this.ultimaPagina && n - this.ultimaPagina <= 3) {
      this.dia().pags += n - this.ultimaPagina;
      const s = (agora - this.ultimaTroca) / 1000 / (n - this.ultimaPagina);
      if (s > 4 && s < 900) {   // velocidade de leitura (média que se adapta)
        const v = dados.prefs.vel && typeof dados.prefs.vel === 'object' ? dados.prefs.vel : (dados.prefs.vel = {});
        const k = pdf ? 'pdf' : 'epub';
        v[k] = v[k] ? v[k] * 0.85 + s * 0.15 : s;
      }
    }
    this.ultimaPagina = n; this.ultimaTroca = agora;
  }
};
['pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(t => document.addEventListener(t, () => est.atividade(), { passive: true, capture: true }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') est.tique(); else est.ultimoTick = Date.now(); });
function segPorPagina() { const v = dados.prefs.vel || {}; return pdf ? (v.pdf || 100) : (v.epub || 55); }
/* capítulos do PDF (pelo sumário): página onde cada um começa */
async function capitulosPDF() {
  const meu = pdf; if (!meu) return;
  meu.capPaginas = [];
  const out = await meu.doc.getOutline().catch(() => null);
  if (!out || pdf !== meu) return;
  const pags = new Set();
  const andar = async (itens, nivel) => {
    for (const it of itens) {
      try { let d = it.dest; if (typeof d === 'string') d = await meu.doc.getDestination(d); if (Array.isArray(d) && d[0]) pags.add((typeof d[0] === 'object' ? await meu.doc.getPageIndex(d[0]) : d[0]) + 1); } catch (e) {}
      if (nivel < 2 && it.items && it.items.length) await andar(it.items, nivel + 1);
    }
  };
  await andar(out, 1);
  if (pdf === meu) { meu.capPaginas = [...pags].sort((a, b) => a - b); tempoRestante(paginaAtualPDF()); }
}
function tempoRestante(pag, loc) {
  const caixa = $('#rod-resta');
  if (!reg || !pag) { caixa.hidden = true; return; }
  const sp = segPorPagina();
  let tot = 0, fimCap = 0;
  if (pdf) {
    tot = pdf.doc.numPages;
    fimCap = ((pdf.capPaginas || []).find(p => p > pag) || tot + 1) - 1;
  } else if (epub && epub.locaisProntos) {
    tot = epub.book.locations.length();
    if (!epub.locEspinha) {
      try { epub.locEspinha = epub.book.locations._locations.map(c => new ePub.CFI(c).spinePos); } catch (e) { epub.locEspinha = []; }
    }
    const l = loc || epub.rend.currentLocation();
    const idx = l && l.start ? l.start.index : 0;
    const prox = (epub.capitulos || []).find(c => c.indice > idx);
    if (prox && epub.locEspinha.length) { const k = epub.locEspinha.findIndex(s => s >= prox.indice); fimCap = k > 0 ? k : tot; } else fimCap = tot;
  } else { caixa.hidden = true; return; }
  const faltaCap = Math.max(0, fimCap - pag + (pdf ? 1 : 0)), faltaTot = Math.max(0, tot - pag + (pdf ? 1 : 0));
  const txtCap = faltaCap > 0 && fimCap < tot ? duracao(faltaCap * sp, true) + ' no capítulo' : '';
  const txt = [txtCap, duracao(faltaTot * sp, true) + (pdf ? ' no arquivo' : ' no livro')].filter(Boolean).join(' · ');
  if (pdf) { caixa.textContent = 'faltam ~' + txt; caixa.hidden = reg.lido || faltaTot === 0 || dados.prefs.semTempo; caixa.title = 'Estimativa pelo seu ritmo de leitura'; }
  else {
    caixa.hidden = true;
    const rp = $('#rod-pct');
    if (!dados.prefs.semTempo && faltaTot > 0 && rp.textContent && !rp.querySelector('.resta')) { const s = document.createElement('span'); s.className = 'resta'; s.textContent = 'faltam ~' + txt + ' · '; rp.prepend(s); }
  }
}
function telaEstatisticas() {
  est.tique();
  const corpo = abrirTela('Estatísticas de leitura');
  const dias = (dados.prefs.estat && dados.prefs.estat.dias) || {};
  const hoje = new Date();
  const ultimos = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(hoje); d.setDate(d.getDate() - i); const k = hojeISO(d), x = dias[k] || {}; ultimos.push({ k, d, seg: Math.max(0, +x.seg || 0), pags: Math.max(0, Math.round(+x.pags || 0)) }); }
  const sete = ultimos.slice(-7), soma = (l, c) => l.reduce((s, x) => s + (x[c] || 0), 0);
  let seq = 0; for (let i = ultimos.length - 1; i >= 0; i--) { if (ultimos[i].seg >= 60) seq++; else if (i === ultimos.length - 1) continue; else break; }
  const max = Math.max(60, ...ultimos.map(x => x.seg));
  const cartoes = [
    ['Hoje', duracao(ultimos[29].seg), ultimos[29].pags + ' páginas'],
    ['Últimos 7 dias', duracao(soma(sete, 'seg')), soma(sete, 'pags') + ' páginas'],
    ['Últimos 30 dias', duracao(soma(ultimos, 'seg')), 'média de ' + duracao(soma(ultimos, 'seg') / 30) + ' por dia'],
    ['Dias seguidos lendo', String(seq), seq === 1 ? 'dia' : 'dias']
  ];
  const v = dados.prefs.vel || {};
  let html = '<div class="est-cartoes">' + cartoes.map(c => `<div class="est-cartao"><span>${esc(c[0])}</span><b>${esc(c[1])}</b><small>${esc(c[2])}</small></div>`).join('') + '</div>';
  html += '<h3 class="est-tit">Tempo por dia (últimos 30 dias)</h3><div class="est-barras" role="img" aria-label="Minutos lidos por dia">' +
    ultimos.map(x => `<div class="est-dia${x.k === hojeISO() ? ' hoje' : ''}" title="${esc(x.d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }))}: ${esc(duracao(x.seg))}, ${Math.round(+x.pags || 0)} pág."><i style="height:${Math.round((+x.seg || 0) / max * 100)}%"></i><span>${x.d.getDate()}</span></div>`).join('') + '</div>';
  const livros = Object.values(dados.livros).filter(r => !r.apagado && r.tempo).map(r => [r, Object.values(r.tempo).reduce((s, n) => s + n, 0)]).filter(x => x[1] >= 60).sort((a, b) => b[1] - a[1]).slice(0, 12);
  html += '<h3 class="est-tit">Livros e artigos com mais tempo de leitura</h3>';
  html += livros.length ? '<div class="est-livros">' + livros.map(([r, s]) => `<div class="est-livro"><span class="t">${esc((r.ficha && r.ficha.titulo) || semExt(r.nome))}</span><span class="p"><i style="width:${Math.round((r.lido ? 1 : r.progresso || 0) * 100)}%"></i></span><b>${esc(duracao(s))}</b></div>`).join('') + '</div>' : '<p class="vazio">Ainda sem tempo registrado. O tempo conta enquanto você lê (pausa sozinho depois de 3 minutos parado).</p>';
  const ritmo = [];
  if (v.epub) ritmo.push('EPUB e Word: ~' + Math.round(3600 / v.epub) + ' páginas por hora');
  if (v.pdf) ritmo.push('PDF: ~' + Math.round(3600 / v.pdf) + ' páginas por hora');
  html += '<p class="est-nota">' + (ritmo.length ? 'Seu ritmo: ' + esc(ritmo.join(' · ')) + '. ' : '') + 'Os dias e o ritmo ficam neste aparelho; o tempo de cada livro soma todos os seus aparelhos conectados à nuvem.</p>';
  corpo.innerHTML = html;
}
$('#bt-estatisticas').onclick = telaEstatisticas;

/* ================= backup ================= */
async function fazerBackup() {
  const copia = { formato: 'mrb-backup', versao: 1, criado: new Date().toISOString(), app: (window.MRB_CONFIG && MRB_CONFIG.versao) || '',
    dados: { versao: 4, livros: dados.livros, pastas: dados.pastas, caminhos: API.web ? {} : dados.caminhos, prefs: dados.prefs } };
  await salvarTexto('Mr. B Reader - backup ' + hojeISO() + '.json', JSON.stringify(copia), 'json', 'Backup salvo');
}
async function restaurarBackup() {
  const r = await API.abrirBackup().catch(() => null);
  if (!r) return;
  if (r.erro) { aviso(r.erro, 4000); return; }
  let j;
  try { j = JSON.parse(r.texto); } catch (e) { aviso('Este arquivo não é um backup do Mr. B Reader.', 4000); return; }
  if (!j || j.formato !== 'mrb-backup' || !j.dados || typeof j.dados !== 'object') { aviso('Este arquivo não é um backup do Mr. B Reader.', 4000); return; }
  const b = validarDadosV4(j.dados);
  const nLivros = Object.keys(b.livros).length;
  const ok = await dialogo({ titulo: 'Restaurar o backup?', texto: `O backup tem ${nLivros} ${nLivros === 1 ? 'livro' : 'livros'} com marcações, notas e posições. Ele é juntado com a biblioteca atual: nada daqui é apagado, e quando o mesmo livro está nos dois vale o que foi mexido por último. Os arquivos dos livros não ficam no backup.`, ok: 'Restaurar' });
  if (!ok) return;
  let novos = 0;
  for (const [id, l] of Object.entries(b.livros)) {
    const loc = dados.livros[id];
    if (!loc) { dados.livros[id] = l; novos++; continue; }
    const m = mesclarLivro(limparLivro(loc, id), l);
    for (const k of ['lido', 'semCapa', 'etiquetas', 'ficha', 'marcadores', 'marcadoresApagados', 'tempo']) if (!(k in m)) delete loc[k];
    Object.assign(loc, m);
  }
  for (const [id, p] of Object.entries(b.pastas)) { const a = dados.pastas[id]; if (!a || (p.alt || 0) > (a.alt || 0)) dados.pastas[id] = p; }
  if (!API.web) for (const [id, c] of Object.entries(b.caminhos)) if (!dados.caminhos[id]) dados.caminhos[id] = c;
  // estatísticas de dias: junta (vale o maior de cada dia)
  const ed = b.prefs && b.prefs.estat && b.prefs.estat.dias;
  if (ed && typeof ed === 'object') { const d = est.dia() && dados.prefs.estat.dias; for (const [k, x] of Object.entries(ed)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && x) { const a = d[k] || { seg: 0, pags: 0 }; d[k] = { seg: Math.max(a.seg || 0, +x.seg || 0), pags: Math.max(a.pags || 0, +x.pags || 0) }; } }
  sujo(); await gravar(true);
  mostrarBiblioteca();
  aviso(`Backup restaurado: ${nLivros} ${nLivros === 1 ? 'livro' : 'livros'} (${novos} ${novos === 1 ? 'novo' : 'novos'}).`, 4500);
}

/* ================= atualização automática (programa de Windows) ================= */
const atualiza = {
  info: null,
  async verificar(manual) {
    if (!API.atualizacao) return;
    if (manual) aviso('Procurando atualização…');
    let r = null;
    try { r = await API.atualizacao.verificar(); } catch (e) {}
    if (!r || r.erro) { if (manual) aviso(r && r.erro ? 'Não consegui procurar: ' + r.erro : 'Não consegui procurar atualização agora.', 4500); return; }
    if (!r.nova) { if (manual) aviso('Você já está na versão mais recente (' + r.atual + ').'); return; }
    this.info = r;
    if (!manual && dados.prefs.ignorarVersao === r.versao) return;
    this.mostrar();
  },
  mostrar() {
    const r = this.info, box = $('#atualizacao');
    box.replaceChildren();
    const t = document.createElement('div'); t.className = 'at-txt';
    const b = document.createElement('b'); b.textContent = 'Versão ' + r.versao + ' disponível';
    const s = document.createElement('span'); s.textContent = r.compativel ? ' (' + (r.tamanho / 1048576).toFixed(1).replace('.', ',') + ' MB)' : ' — precisa do instalador completo';
    t.append(b, s);
    const ver = document.createElement('button'); ver.className = 'bt mini'; ver.textContent = 'O que mudou';
    ver.onclick = () => dialogo({ titulo: 'Novidades da ' + r.versao, texto: (r.novidades || []).map(x => '• ' + x).join('\n') || 'Melhorias e correções.', semOk: true, cancelar: 'Fechar' });
    const ok = document.createElement('button'); ok.className = 'bt mini prim';
    ok.textContent = r.compativel ? 'Atualizar agora' : 'Abrir a página de download';
    ok.onclick = () => (r.compativel ? this.instalar() : abrirExterno(r.pagina || 'https://mrbprojetos.github.io/'));
    const depois = document.createElement('button'); depois.className = 'bt mini'; depois.textContent = 'Depois';
    depois.onclick = () => { box.hidden = true; dados.prefs.ignorarVersao = r.versao; gravar(); };
    box.append(t, ver, ok, depois);
    box.hidden = false;
  },
  async instalar() {
    const box = $('#atualizacao');
    box.replaceChildren(Object.assign(document.createElement('div'), { className: 'at-txt', textContent: 'Baixando a atualização…' }));
    await gravar(true);
    let r = null;
    try { r = await API.atualizacao.instalar(); } catch (e) { r = { erro: String(e && e.message || e) }; }
    if (!r || r.erro) { box.hidden = true; aviso('A atualização não foi instalada: ' + ((r && r.erro) || 'erro desconhecido'), 6000); return; }
    box.firstChild.textContent = 'Instalando… o Mr. B Reader vai fechar e abrir de novo sozinho.';
  }
};

/* menu ⋯ da biblioteca: backup e atualização */
$('#bt-bib-mais').onclick = () => {
  const itens = [{ secao: 'Backup' },
    { rotulo: 'Fazer backup (marcações, notas, posições)…', acao: fazerBackup },
    { rotulo: 'Restaurar um backup…', acao: restaurarBackup }];
  if (API.atualizacao) {
    itens.push('-', { secao: 'Atualização' },
      { rotulo: 'Procurar atualização agora', acao: () => atualiza.verificar(true) },
      { rotulo: 'Procurar sozinho ao abrir o programa', ativo: dados.prefs.atualizarAuto !== 0, acao: () => { dados.prefs.atualizarAuto = dados.prefs.atualizarAuto === 0 ? 1 : 0; gravar(); } });
  }
  itens.push('-', { rotulo: dados.prefs.semTempo ? 'Mostrar o tempo que falta na leitura' : 'Esconder o tempo que falta na leitura', acao: () => { dados.prefs.semTempo = dados.prefs.semTempo ? 0 : 1; gravar(); } });
  abrirMenu($('#bt-bib-mais'), itens);
};
setTimeout(() => { if (API.atualizacao && dados.prefs.atualizarAuto !== 0) atualiza.verificar(false); }, 25000);
