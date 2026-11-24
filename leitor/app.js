'use strict';
/* Mr. B Reader — PDF, EPUB e Word com marcações, notas e memória de leitura */

const $ = s => document.querySelector(s);
const API = window.leitor;
const NOME_APP = 'Mr. B Reader';

/* aparência do programa antes do primeiro desenho (evita "piscar" claro→escuro) */
const mqEscuro = matchMedia('(prefers-color-scheme: dark)');
document.documentElement.dataset.ui = mqEscuro.matches ? 'escuro' : 'claro';

const CORES = {
  amarelo: { css: '#ffd60a', rgb: [1, 0.84, 0.04] },
  verde: { css: '#50c878', rgb: [0.31, 0.78, 0.47] },
  rosa: { css: '#f064a0', rgb: [0.94, 0.39, 0.63] },
  azul: { css: '#4696f0', rgb: [0.27, 0.59, 0.94] }
};
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const TAMANHOS = [70, 80, 90, 100, 110, 120, 135, 150, 170, 190, 220];
const RE_EXT = /\.(pdf|epub|docx|doc)$/i;

/* fontes de leitura (EPUB e Word). "fam" vazio = fonte original do livro */
const FONTES = [
  { id: 'original', nome: 'Fonte original' },
  { grupo: 'Incluídas no programa' },
  { id: 'literata', nome: 'Literata', fam: '"MrB Literata", Georgia, serif' },
  { id: 'merriweather', nome: 'Merriweather', fam: '"MrB Merriweather", Georgia, serif' },
  { id: 'lora', nome: 'Lora', fam: '"MrB Lora", Georgia, serif' },
  { id: 'source-serif', nome: 'Source Serif', fam: '"MrB Source Serif", Georgia, serif' },
  { id: 'garamond', nome: 'EB Garamond', fam: '"MrB EB Garamond", Garamond, serif' },
  { id: 'open-sans', nome: 'Open Sans', fam: '"MrB Open Sans", "Segoe UI", sans-serif' },
  { id: 'inter', nome: 'Inter', fam: '"MrB Inter", "Segoe UI", sans-serif' },
  { grupo: 'Acessibilidade' },
  { id: 'atkinson', nome: 'Atkinson Hyperlegible (alta legibilidade)', fam: '"MrB Atkinson", Verdana, sans-serif' },
  { id: 'opendyslexic', nome: 'OpenDyslexic (dislexia)', fam: '"MrB OpenDyslexic", Verdana, sans-serif' },
  { grupo: 'Do Windows' },
  { id: 'georgia', nome: 'Georgia', fam: 'Georgia, serif' },
  { id: 'cambria', nome: 'Cambria', fam: 'Cambria, Georgia, serif' },
  { id: 'palatino', nome: 'Palatino Linotype', fam: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { id: 'constantia', nome: 'Constantia', fam: 'Constantia, Georgia, serif' },
  { id: 'times', nome: 'Times New Roman', fam: '"Times New Roman", Times, serif' },
  { id: 'segoe', nome: 'Segoe UI', fam: '"Segoe UI", system-ui, sans-serif' },
  { id: 'calibri', nome: 'Calibri', fam: 'Calibri, "Segoe UI", sans-serif' },
  { id: 'verdana', nome: 'Verdana', fam: 'Verdana, sans-serif' },
  { id: 'arial', nome: 'Arial', fam: 'Arial, Helvetica, sans-serif' }
];
const FONTE_POR_ID = Object.fromEntries(FONTES.filter(f => f.id).map(f => [f.id, f]));

let dados = { versao: 4, livros: {}, caminhos: {}, pastas: {}, nuvem: {}, prefs: { tema: 'auto', fonte: 'original', interface: 'sistema', pasta: 'todos' } };
let atual = null;          // { path, name, size, tipo, motor, bytes }
let reg = null;            // livro aberto (dados.livros[id]); id = SHA-256 do conteúdo
let pdf = null;            // { doc, tamanhos[], escala, paginas[] }
let epub = null;           // { book, rend, locaisProntos }
let pendente = null;       // seleção aguardando cor/nota
let marcaAberta = null;
let abertura = 0;          // contador para descartar aberturas antigas (cliques rápidos)

/* ---------------- utilidades ---------------- */
function aviso(msg, ms = 2600) {
  const a = $('#aviso'); a.textContent = msg; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.hidden = true), ms);
}
function carregando(on, txt = 'Abrindo…') { $('#carregando').hidden = !on; $('#carregando-txt').textContent = txt; }
let tGravar = null;
let dadosProntos = false;   // nunca grava antes de ler os dados salvos (senão uma biblioteca vazia apagaria a verdadeira)
function gravar(imediato) {
  clearTimeout(tGravar);
  if (!dadosProntos) return Promise.resolve();
  const f = () => API.dadosGravar(dados).catch(e => console.warn('falha ao gravar', e));
  if (imediato) return f();
  tGravar = setTimeout(f, 600);
}
/* ---------- toque: a página do leitor é rígida ----------
   O navegador não arrasta nem amplia a tela de leitura (era isso que fazia a página "sambar" no celular).
   Quem vira a página é o leitor (deslizar ou tocar nas laterais); a pinça muda o tamanho da letra ou o zoom do PDF.
   Selecionar texto com toque longo continua funcionando. */
function travarToque(doc, win) {
  doc.addEventListener('touchmove', e => {
    const sel = win.getSelection && win.getSelection();
    if (e.touches.length === 1 && sel && !sel.isCollapsed) return;   // ajustando a seleção de um trecho
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  for (const g of ['gesturestart', 'gesturechange']) doc.addEventListener(g, e => e.preventDefault(), { passive: false });   // pinça do Safari
}
const pinca = {
  ativa: false, d0: 0, d: 0,
  dist(ts) { return Math.hypot(ts[0].screenX - ts[1].screenX, ts[0].screenY - ts[1].screenY); },
  inicio(ts) { this.ativa = true; this.d0 = this.d = this.dist(ts); },
  mover(ts) { if (this.ativa) this.d = this.dist(ts); },
  fim() {
    if (!this.ativa) return;
    this.ativa = false;
    const r = this.d / (this.d0 || 1);
    // proporcional ao gesto: cada 20% de abertura/fechamento dos dedos = um passo (no máximo 4)
    const n = Math.max(-4, Math.min(4, Math.round(Math.log(r) / Math.log(1.2))));
    if (!n) return;
    if (pdf) zoomPDF(n); else if (epub) fonteEPUB(n);   // todos os passos de uma vez (o PDF é redesenhado uma vez só)
  }
};
const mqMovel = matchMedia('(max-width: 700px)');
function ehMovel() { return mqMovel.matches; }
let ultimoPonteiro = 'mouse';
document.addEventListener('pointerdown', e => { ultimoPonteiro = e.pointerType || 'mouse'; }, true);
/* site: livros removidos da biblioteca (aqui ou em outro aparelho) não precisam ocupar espaço no navegador */
function limparGuardados() {
  let mudou = false;
  for (const [id, c] of Object.entries(dados.caminhos)) {
    if (dados.livros[id] && dados.livros[id].apagado) { API.esquecer(c); delete dados.caminhos[id]; mudou = true; }
  }
  if (mudou) gravar();
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function dataBR(ms) { const d = new Date(ms); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function tamanhoTxt(v) { $('#tamanho').textContent = Math.round(v) + '%'; }
function tipoDe(nome) { const m = RE_EXT.exec(nome || ''); return m ? m[1].toLowerCase() : null; }
function semExt(n) { return String(n).replace(RE_EXT, ''); }
function hashTxt(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function ocioso(t = 600) { return new Promise(ok => (window.requestIdleCallback ? requestIdleCallback(() => ok(), { timeout: t }) : setTimeout(ok, 30))); }
function u8ParaBuffer(u8) { return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); }

/* ---------------- bibliotecas carregadas sob demanda (abre bem mais rápido) ---------------- */
const LIBS = {
  pdf: ['lib/pdf.min.js'],
  epub: ['lib/jszip.min.js', 'lib/epub.min.js'],
  pdflib: ['lib/pdf-lib.min.js'],
  docx: ['lib/mammoth.browser.min.js'],
  doc: ['lib/word-doc.min.js']
};
const scripts = new Map();
function script(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => ok();
      s.onerror = () => { scripts.delete(src); erro(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}
let workerPDF = null;
async function usar(nome) {
  for (const s of LIBS[nome]) await script(s);
  if (nome === 'pdf' && !workerPDF) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    workerPDF = new pdfjsLib.PDFWorker({ name: 'mrb-pdf' });   // um worker só, reaproveitado por todos os PDFs
  }
}
function abrirDocPDF(data) {
  return pdfjsLib.getDocument({ data, worker: workerPDF, isEvalSupported: false, enableXfa: false, fontExtraProperties: false }).promise;
}

/* ---------------- aparência do programa ---------------- */
function uiResolvida() {
  const v = dados.prefs.interface;
  return v === 'escuro' || (v === 'sistema' && mqEscuro.matches) ? 'escuro' : 'claro';
}
async function aplicarInterface(v, salvar) {
  dados.prefs.interface = v;
  try { await API.temaInterface(v); } catch (e) {}
  document.documentElement.dataset.ui = uiResolvida();
  atualizarTemaPagina();
  if (salvar) gravar();
}
mqEscuro.addEventListener('change', () => { document.documentElement.dataset.ui = uiResolvida(); atualizarTemaPagina(); });
function menuInterface() {
  const v = dados.prefs.interface;
  abrirMenu($('#bt-interface'), [
    { rotulo: 'Claro', ativo: v === 'claro', acao: () => aplicarInterface('claro', true) },
    { rotulo: 'Escuro', ativo: v === 'escuro', acao: () => aplicarInterface('escuro', true) },
    { rotulo: 'Igual ao Windows', ativo: v === 'sistema', acao: () => aplicarInterface('sistema', true) }
  ]);
}

/* cor da página de leitura ("auto" = clara ou escura junto com o programa) */
function temaEfetivo() { const t = dados.prefs.tema; return t === 'auto' ? uiResolvida() : t; }
function atualizarTemaPagina() {
  const t = temaEfetivo();
  if (document.documentElement.dataset.tema === t && !epub) return;
  document.documentElement.dataset.tema = t;
  if (epub) epub.rend.getContents().forEach(c => temaNoDoc(c.document));
}
function aplicarTema(t) {
  if (!['auto', 'claro', 'sepia', 'escuro'].includes(t)) t = 'auto';
  dados.prefs.tema = t; $('#sel-tema').value = t;
  atualizarTemaPagina();
  gravar();
}
/* cor da página dentro do livro. Na escura, muitos livros fixam o texto em preto:
   força texto claro e fundos transparentes (links continuam azuis) */
const CSS_PAGINA = {
  claro: 'html, html body { background-color: #ffffff !important; }',
  sepia: 'html, html body { background-color: #f8f0e0 !important; }' +
    'html body { color: #3b2f22; }',
  escuro: 'html, html body { background-color: #2a2d33 !important; color: #e4e4e2 !important; }' +
    'html body *:not(img):not(svg):not(svg *):not(image):not(video) { color: inherit !important; background-color: transparent !important; border-color: rgba(228,228,226,.3) !important; text-shadow: none !important; }' +
    'html body a[href], html body a[href] * { color: #8ab8ec !important; }'
};
function temaNoDoc(d) {
  if (!d || !d.head) return;
  let s = d.getElementById('mrb-tema');
  if (!s) { s = d.createElement('style'); s.id = 'mrb-tema'; d.head.appendChild(s); }
  s.textContent = CSS_PAGINA[temaEfetivo()] || '';
}

/* ---------------- menu flutuante ---------------- */
function abrirMenu(ancora, itens) {
  const m = $('#menu-flut'); m.replaceChildren();
  for (const it of itens) {
    if (it === '-') { const s = document.createElement('div'); s.className = 'menu-sep'; m.appendChild(s); continue; }
    if (it.secao) { const s = document.createElement('div'); s.className = 'menu-secao'; s.textContent = it.secao; m.appendChild(s); continue; }
    const b = document.createElement('button');
    b.className = 'menu-item' + (it.perigo ? ' perigo' : ''); b.setAttribute('role', 'menuitem'); b.disabled = !!it.desativado;
    b.innerHTML = '<span class="ok"></span><span></span>';
    b.firstChild.textContent = it.ativo ? '✓' : '';
    b.lastChild.textContent = it.rotulo;
    b.onclick = () => { fecharMenu(); it.acao(); };
    m.appendChild(b);
  }
  m.hidden = false;
  const r = ancora.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  let x = Math.min(innerWidth - w - 8, Math.max(8, r.right - w));
  let y = r.bottom + 6; if (y + h > innerHeight - 8) y = r.top - h - 6;
  m.style.left = x + 'px'; m.style.top = Math.max(8, y) + 'px';
  const pri = m.querySelector('.menu-item:not(:disabled)'); if (pri) pri.focus();
}
function fecharMenu() { $('#menu-flut').hidden = true; }

/* ================= biblioteca ================= */
let capasURL = {};             // id do livro → endereço da capa
const cartoes = new Map();     // id do livro → cartão na tela
const ICO_MAIS = '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/></svg>';
const ICO_LIDO = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICO_NUVEM = '<svg viewBox="0 0 24 24"><path d="M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.2 9.3 4.6 4.6 0 0 0 7 18.5z"/><path d="M12 10.5v5.5m-2.3-2.2L12 16l2.3-2.2"/></svg>';
const VAZIO_TXT = 'Nenhum arquivo aberto ainda. Clique em <b>Abrir arquivo</b> ou arraste um arquivo para esta janela.';

function pastasOrdenadas() { return Object.values(dados.pastas).filter(p => !p.apagada).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')); }
function pastaAtual() { const f = dados.prefs.pasta; return f && dados.pastas[f] && !dados.pastas[f].apagada ? f : 'todos'; }
function livrosVisiveis() {
  const f = pastaAtual();
  return Object.values(dados.livros).filter(r => !r.apagado && (f === 'todos' || r.pasta === f)).sort((a, b) => (b.ultima || 0) - (a.ultima || 0));
}
async function mostrarBiblioteca() {
  fecharLeitura();
  $('#leitura').hidden = true; $('#bib-wrap').hidden = false; $('#controles-leitura').hidden = true; $('#progresso-dica').hidden = true; popCapas(false);
  document.body.classList.remove('imersivo'); opcoesTexto(false); if (ehMovel()) $('#painel').hidden = true;
  $('#titulo-doc').textContent = '';
  document.title = NOME_APP;
  desenharPastas();
  await desenharLivros();
}
function desenharPastas() {
  const box = $('#pastas'), sel = pastaAtual();
  const vivos = Object.values(dados.livros).filter(r => !r.apagado);
  const frag = document.createDocumentFragment();
  const chip = (id, nome, n) => {
    const b = document.createElement('button');
    b.className = 'pasta' + (id === sel ? ' ativa' : ''); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', id === sel);
    b.innerHTML = (id === 'todos' ? '' : '<svg viewBox="0 0 24 24"><path d="M3 6.5h7l2 2h9V19H3z"/></svg>') + '<span></span><small></small>';
    b.children[b.children.length - 2].textContent = nome; b.lastChild.textContent = n;
    b.onclick = () => { if (id === sel && id !== 'todos') menuPasta(dados.pastas[id], b); else { dados.prefs.pasta = id; gravar(); desenharPastas(); desenharLivros(); } };
    b.oncontextmenu = e => { e.preventDefault(); if (id !== 'todos') menuPasta(dados.pastas[id], b); };
    if (id === sel && id !== 'todos') b.title = 'Clique de novo para renomear ou apagar esta pasta';
    frag.appendChild(b);
  };
  chip('todos', 'Todos os livros', vivos.length);
  for (const p of pastasOrdenadas()) chip(p.id, p.nome, vivos.filter(r => r.pasta === p.id).length);
  const nova = document.createElement('button');
  nova.className = 'pasta nova'; nova.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg><span>Nova pasta</span>';
  nova.onclick = async () => { const p = await novaPasta(); if (p) { dados.prefs.pasta = p.id; gravar(); desenharPastas(); desenharLivros(); } };
  frag.appendChild(nova);
  box.replaceChildren(frag);
}
async function desenharLivros() {
  const recs = livrosVisiveis();
  const vazio = $('#vazio');
  vazio.hidden = recs.length > 0;
  if (pastaAtual() === 'todos') vazio.innerHTML = VAZIO_TXT;
  else vazio.textContent = 'Esta pasta está vazia. Abra um arquivo com ela selecionada, ou use o botão ⋯ de um livro para trazê-lo para cá.';
  const faltam = recs.map(r => r.id).filter(id => !capasURL[id]);
  if (faltam.length) { try { Object.assign(capasURL, await API.capas(faltam)); } catch (e) {} }
  const frag = document.createDocumentFragment();
  cartoes.clear();
  for (const r of recs) { const c = cartao(r); cartoes.set(r.id, c); frag.appendChild(c); }
  $('#lista-recentes').replaceChildren(frag);
  agendarCapas(recs.filter(r => !capasURL[r.id] && precisaCapa(r)).map(r => r.id));
}
function capaGerada(r) {
  const h = hashTxt(r.nome) % 360;
  return `<div class="capa-gerada" style="--h:${h}"><span class="cg-tit">${esc(semExt(r.nome))}</span><span class="cg-ext">${esc(r.tipo.toUpperCase())}</span></div>`;
}
function htmlCapa(id, r) {
  const u = capasURL[id];
  return u ? `<img src="${esc(u)}" alt="" loading="lazy" decoding="async"><span class="tipo">${esc(r.tipo.toUpperCase())}</span>` : capaGerada(r);
}
function cartao(r) {
  const id = r.id;
  const pct = Math.round((r.progresso || 0) * 100);
  const n = (r.marcas || []).length;
  const local = !!dados.caminhos[id];
  const soNuvem = !local && r.nuvem && r.nuvem.arquivo;
  const el = document.createElement('div');
  el.className = 'livro' + (soNuvem ? ' so-nuvem' : '') + (r.lido ? ' lido' : ''); el.tabIndex = 0; el.setAttribute('role', 'button');
  el.title = r.nome + (r.ultima ? '\nLido em ' + dataBR(r.ultima) : '') + '\n' + (local ? (API.web ? 'Guardado neste aparelho' : dados.caminhos[id]) : soNuvem ? 'No Google Drive (toque para baixar e abrir)' : 'O arquivo não está ' + (API.web ? 'neste aparelho' : 'neste computador'));
  el.innerHTML = `<div class="capa">${htmlCapa(id, r)}
      <div class="acoes"><button data-a="lido" class="${r.lido ? 'lido-on' : ''}" title="${r.lido ? 'Marcar como não lido' : 'Marcar como lido'}" aria-label="${r.lido ? 'Marcar como não lido' : 'Marcar como lido'}" aria-pressed="${!!r.lido}">${ICO_LIDO}</button><button data-a="menu" title="Opções" aria-label="Opções do livro">${ICO_MAIS}</button></div>
      ${soNuvem ? `<span class="selo-nuvem" title="Está no Google Drive">${ICO_NUVEM}</span>` : ''}
      ${r.lido ? `<span class="selo-lido" title="Marcado como lido em ${esc(dataBR(r.lido))}">${ICO_LIDO}Lido</span>` : ''}
      <div class="prog-transf" hidden><i></i></div></div>
    <div class="info"><div class="nome"></div><div class="barra-prog"><i style="width:${pct}%"></i></div>
      <div class="meta"><span>${r.lido ? 'Lido em ' + esc(dataBR(r.lido).split(' ')[0]) : pct + '% lido' + (r.tipo === 'pdf' && r.pos && r.pos.pagina ? ' · pág. ' + r.pos.pagina : '')}</span><span>${n ? n + (n > 1 ? ' marcas' : ' marca') : ''}</span></div></div>`;
  el.querySelector('.nome').textContent = semExt(r.nome);
  const img = el.querySelector('img');
  if (img) img.onerror = () => { delete capasURL[id]; el.querySelector('.capa').insertAdjacentHTML('afterbegin', capaGerada(r)); img.nextElementSibling && img.nextElementSibling.remove(); img.remove(); };
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (b) { e.stopPropagation(); if (b.dataset.a === 'lido') alternarLido(r); else menuLivro(r, b); return; }
    abrirLivro(id);
  });
  el.addEventListener('contextmenu', e => { e.preventDefault(); menuLivro(r, el.querySelector('button[data-a]')); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) abrirLivro(id); });
  if (transf.has(id)) setTimeout(() => progressoCartao(id));
  return el;
}
function trocarCapaNoCartao(id) {
  const el = cartoes.get(id), r = dados.livros[id];
  if (!el || !r || !capasURL[id]) return;
  const c = el.querySelector('.capa');
  c.querySelectorAll('img,.capa-gerada,.tipo').forEach(x => x.remove());
  c.insertAdjacentHTML('afterbegin', htmlCapa(id, r));
}
function menuLivro(r, ancora) {
  const local = dados.caminhos[r.id];
  const itens = [{ rotulo: 'Abrir', acao: () => abrirLivro(r.id) }, { rotulo: r.lido ? 'Marcar como não lido' : 'Marcar como lido', acao: () => alternarLido(r) }];
  if (local && !API.web) itens.push({ rotulo: 'Mostrar na pasta do Windows', acao: async () => { if (!(await API.mostrarNaPasta(local))) aviso('O arquivo não está mais nesse lugar.'); } });
  else if (r.nuvem && r.nuvem.arquivo) itens.push({ rotulo: 'Baixar do Google Drive', acao: () => baixarLivro(r.id, false) });
  itens.push('-', { secao: 'Pasta' });
  itens.push({ rotulo: 'Sem pasta', ativo: !r.pasta, acao: () => moverLivro(r, null) });
  for (const p of pastasOrdenadas()) itens.push({ rotulo: p.nome, ativo: r.pasta === p.id, acao: () => moverLivro(r, p.id) });
  itens.push({ rotulo: 'Nova pasta…', acao: async () => { const p = await novaPasta(); if (p) moverLivro(r, p.id); } });
  itens.push('-', { rotulo: 'Remover da biblioteca…', perigo: true, acao: () => removerLivro(r) });
  abrirMenu(ancora, itens);
}
/* "lido": marca manual na biblioteca. Não mexe na posição de leitura, então desmarcar volta como estava. */
function alternarLido(r) {
  r.lido = r.lido ? 0 : Date.now();
  if (!r.lido) delete r.lido;
  tocar(r); gravar();
  const velho = cartoes.get(r.id);
  if (velho) { const novo = cartao(r); velho.replaceWith(novo); cartoes.set(r.id, novo); }
  aviso(r.lido ? '“' + semExt(r.nome) + '” marcado como lido' : '“' + semExt(r.nome) + '” marcado como não lido');
}
function moverLivro(r, pastaId) {
  if ((r.pasta || null) === pastaId) return;
  r.pasta = pastaId; tocar(r); gravar();
  desenharPastas(); desenharLivros();
  aviso(pastaId ? 'Movido para “' + dados.pastas[pastaId].nome + '”' : 'Livro sem pasta');
}
async function removerLivro(r) {
  const naNuvem = r.nuvem && r.nuvem.arquivo;
  const ok = await dialogo({
    titulo: 'Remover “' + semExt(r.nome) + '”?',
    texto: 'Ele sai da biblioteca' + (nuvem.conectado ? ' em todos os seus aparelhos' : '') +
      (API.web ? '. A cópia guardada neste navegador é apagada (o arquivo original não é mexido)' : '. O arquivo original no seu computador não é apagado') +
      (naNuvem ? ', e a cópia no Google Drive vai para a lixeira do Drive (dá para recuperar por 30 dias)' : '') + '. Se você abrir o arquivo de novo, as marcações voltam.',
    ok: 'Remover', perigo: true
  });
  if (!ok) return;
  r.apagado = Date.now(); tocar(r);
  if (API.web && dados.caminhos[r.id]) { API.esquecer(dados.caminhos[r.id]); delete dados.caminhos[r.id]; }   // libera o espaço no navegador
  gravar();
  const el = cartoes.get(r.id); if (el) el.remove(); cartoes.delete(r.id);
  desenharPastas();
  $('#vazio').hidden = cartoes.size > 0;
}
async function novaPasta() {
  const v = await dialogo({ titulo: 'Nova pasta', campos: [{ rotulo: 'Nome da pasta', valor: '', max: 80 }], ok: 'Criar' });
  if (!v) return null;
  const id = uid().replace(/[^a-z0-9]/g, '').padEnd(8, '0').slice(0, 20);
  dados.pastas[id] = { id, nome: v[0], alt: Date.now(), apagada: 0, nuvem: {} };
  sujo(); gravar();
  return dados.pastas[id];
}
function menuPasta(p, ancora) {
  if (!p) return;
  abrirMenu(ancora, [
    { rotulo: 'Renomear pasta…', acao: async () => {
      const v = await dialogo({ titulo: 'Renomear pasta', campos: [{ rotulo: 'Nome da pasta', valor: p.nome, max: 80 }], ok: 'Salvar' });
      if (!v || v[0] === p.nome) return;
      p.nome = v[0]; p.alt = Math.max(Date.now(), p.alt + 1); sujo(); gravar(); desenharPastas();
    } },
    { rotulo: 'Apagar pasta…', perigo: true, acao: async () => {
      const ok = await dialogo({ titulo: 'Apagar a pasta “' + p.nome + '”?', texto: 'Os livros dela não são apagados: eles continuam na biblioteca, sem pasta.', ok: 'Apagar pasta', perigo: true });
      if (!ok) return;
      for (const r of Object.values(dados.livros)) if (r.pasta === p.id) { r.pasta = null; tocar(r); }
      p.apagada = Date.now(); p.alt = Math.max(Date.now(), p.alt + 1);
      dados.prefs.pasta = 'todos'; sujo(); gravar(); desenharPastas(); desenharLivros();
    } }
  ]);
}

/* ---------------- caixa de diálogo (texto, confirmação, formulários) ---------------- */
let dialogoAberto = null;
function dialogo({ titulo, texto, campos = [], ok = 'OK', cancelar = 'Cancelar', perigo = false, semOk = false }) {
  if (dialogoAberto) dialogoAberto(null);
  fecharMenu();
  const fundo = $('#dialogo'), form = $('#dialogo-form');
  $('#dlg-tit').textContent = titulo || '';
  $('#dlg-txt').textContent = texto || ''; $('#dlg-txt').hidden = !texto;
  const box = $('#dlg-campos'); box.replaceChildren();
  const inputs = campos.map(c => {
    const l = document.createElement('label'); l.className = 'dlg-campo';
    const s = document.createElement('span'); s.textContent = c.rotulo;
    const i = document.createElement('input'); i.type = c.senha ? 'password' : 'text'; i.value = c.valor || ''; i.maxLength = c.max || 300; i.placeholder = c.dica || ''; i.spellcheck = false;
    l.append(s, i); box.appendChild(l); return i;
  });
  $('#dlg-ok').textContent = ok; $('#dlg-ok').hidden = semOk; $('#dlg-ok').classList.toggle('perigo-cheio', perigo);
  $('#dlg-cancelar').textContent = cancelar;
  fundo.hidden = false;
  setTimeout(() => (inputs[0] || (semOk ? $('#dlg-cancelar') : $('#dlg-ok'))).focus(), 30);
  return new Promise(resolve => {
    const fim = v => { fundo.hidden = true; dialogoAberto = null; form.onsubmit = null; $('#dlg-cancelar').onclick = null; fundo.onmousedown = null; form.onkeydown = null; resolve(v); };
    dialogoAberto = fim;
    form.onsubmit = e => {
      e.preventDefault();
      const vals = inputs.map(i => i.value.replace(/[\x00-\x1f]/g, '').trim());
      const vazio = inputs.find((i, k) => !vals[k]);
      if (vazio) { vazio.focus(); vazio.classList.add('erro'); setTimeout(() => vazio.classList.remove('erro'), 900); return; }
      fim(inputs.length ? vals : true);
    };
    $('#dlg-cancelar').onclick = () => fim(null);
    fundo.onmousedown = e => { if (e.target === fundo) fim(null); };
    form.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); fim(null); } };
  });
}
function fecharDialogo(v) { if (dialogoAberto) dialogoAberto(v === undefined ? null : v); }

/* ---------------- capas ---------------- */
const LARG_CAPA = 360;
function precisaCapa(r) { return r && (r.tipo === 'pdf' || r.tipo === 'epub') && dados.caminhos[r.id] && r.semCapa !== r.tamanho && !(r.nuvem && r.nuvem.capa); }
async function canvasJPEG(cv) {
  const b = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.86));
  return b ? new Uint8Array(await b.arrayBuffer()) : null;
}
async function capaDePDF(doc) {
  const pg = await doc.getPage(1);
  const v1 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: LARG_CAPA / v1.width });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvasJPEG(cv);
}
async function capaDeEPUB(book) {
  await book.loaded.cover.catch(() => null);
  const url = await book.coverUrl().catch(() => null);
  if (!url) return null;
  const img = new Image(); img.src = url; await img.decode();
  const k = Math.min(1, LARG_CAPA / img.naturalWidth);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return canvasJPEG(cv);
}
async function salvarCapa(id, bytes) {
  try { capasURL[id] = await API.capaGravar(id, bytes); trocarCapaNoCartao(id); if (nuvem.conectado) transferir(); } catch (e) { console.warn('capa', e); }
}
function semCapa(id, tamanho) { const r = dados.livros[id]; if (r) { r.semCapa = tamanho; gravar(); } }
async function garantirCapa(id, tipo, tamanho) {
  if (tipo !== 'pdf' && tipo !== 'epub') return;
  if (capasURL[id]) return;
  const ja = await API.capas([id]).catch(() => ({}));
  if (ja[id]) { capasURL[id] = ja[id]; return; }
  await ocioso(1500);
  if (!atual || atual.id !== id) return;
  let bytes = null;
  try { bytes = tipo === 'pdf' ? await capaDePDF(pdf.doc) : await capaDeEPUB(epub.book); } catch (e) {}
  if (bytes) salvarCapa(id, bytes); else semCapa(id, tamanho);
}
/* capas de livros que já estavam na biblioteca: geradas em segundo plano, um por vez */
let filaCapas = [], fazendoCapas = false;
function agendarCapas(lista) { filaCapas = lista.slice(0, 80); if (!fazendoCapas && filaCapas.length) processarCapas(); }
async function processarCapas() {
  fazendoCapas = true;
  try {
    while (filaCapas.length && !atual) {
      await ocioso();
      const id = filaCapas.shift(); const r = dados.livros[id]; const caminho = dados.caminhos[id];
      if (!r || !caminho || capasURL[id] || atual) continue;
      const f = await API.abrirCaminho(caminho).catch(() => null);
      if (!f || f.erro || atual || f.hash !== id) continue;
      let bytes = null;
      try {
        if (r.tipo === 'pdf') {
          await usar('pdf');
          const doc = await abrirDocPDF(f.data);
          try { bytes = await capaDePDF(doc); } finally { doc.destroy(); }
        } else if (r.tipo === 'epub') {
          await usar('epub');
          const book = ePub(u8ParaBuffer(f.data));
          try { await book.ready; bytes = await capaDeEPUB(book); } finally { book.destroy(); }
        }
      } catch (e) { console.warn('capa em segundo plano', r.nome, e); }
      if (bytes) await salvarCapa(id, bytes); else semCapa(id, f.size);
    }
  } finally { fazendoCapas = false; }
}

/* ---------------- imagem de fundo da biblioteca ---------------- */
let temFundo = false;
function aplicarFundo(url) {
  const f = $('#bib-fundo'), w = $('#bib-wrap');
  if (!url) { temFundo = false; f.hidden = true; f.style.backgroundImage = ''; w.classList.remove('com-fundo'); return; }
  const img = new Image(); img.src = url;
  img.decode().then(() => {
    temFundo = true; f.style.backgroundImage = `url("${url}")`; f.hidden = false; w.classList.add('com-fundo');
  }).catch(() => aplicarFundo(null));
}
async function escolherFundo() {
  const r = await API.fundoEscolher().catch(() => null);
  if (!r) return;
  if (r.erro) { aviso(r.erro, 4000); return; }
  carregando(true, 'Preparando a imagem…');
  try {
    const original = await createImageBitmap(new Blob([r.data]));
    // reduz para o tamanho da tela (nítida em qualquer resolução, sem desperdiçar memória)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const alvoW = Math.max(screen.width, 1280) * dpr, alvoH = Math.max(screen.height, 720) * dpr;
    const k = Math.min(1, Math.max(alvoW / original.width, alvoH / original.height));
    const w = Math.max(1, Math.round(original.width * k)), h = Math.max(1, Math.round(original.height * k));
    const bmp = k < 1 ? await createImageBitmap(original, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : original;
    const cv = new OffscreenCanvas(w, h);
    cv.getContext('2d').drawImage(bmp, 0, 0);
    if (bmp !== original) bmp.close(); original.close();
    const blob = await cv.convertToBlob({ type: 'image/webp', quality: 0.9 });
    const url = await API.fundoGravar(new Uint8Array(await blob.arrayBuffer()));
    aplicarFundo(url); aviso('Imagem de fundo aplicada');
  } catch (e) { console.error(e); aviso('Não consegui usar essa imagem.', 4000); }
  finally { carregando(false); }
}
function menuFundo() {
  abrirMenu($('#bt-fundo'), [
    { rotulo: 'Escolher imagem de fundo…', acao: escolherFundo },
    { rotulo: 'Remover imagem de fundo', desativado: !temFundo, acao: async () => { await API.fundoRemover(); aplicarFundo(null); aviso('Fundo removido'); } }
  ]);
}

/* ================= abrir ================= */
async function abrirDialogo() {
  const f = await API.abrirDialogo();
  if (!f) return;
  if (f.erro) { aviso('Não foi possível abrir: ' + f.erro, 4200); return; }
  abrirArquivo(f);
}
async function abrirCaminho(p) {
  carregando(true);
  const f = await API.abrirCaminho(p).catch(() => null);
  if (!f || f.erro) {
    carregando(false);
    aviso(f && /grande/.test(f.erro) ? 'Arquivo grande demais para abrir.' : 'Não encontrei o arquivo. Ele pode ter sido movido, renomeado ou apagado.', 4200);
    return;
  }
  abrirArquivo(f);
}
/* abre um livro da biblioteca: do disco, ou baixa do Google Drive se ele não está neste PC */
async function abrirLivro(id) {
  const r = dados.livros[id]; if (!r) return;
  const caminho = dados.caminhos[id];
  if (caminho) {
    carregando(true);
    const f = await API.abrirCaminho(caminho).catch(() => null);
    if (f && !f.erro) { abrirArquivo(f); return; }
    carregando(false);
    delete dados.caminhos[id]; gravar();
  }
  if (r.nuvem && r.nuvem.arquivo) { baixarLivro(id, true); return; }
  aviso(caminho ? 'Não encontrei o arquivo. Ele pode ter sido movido, renomeado ou apagado.' : 'Este livro ainda está sendo enviado para a nuvem pelo outro aparelho. Tente daqui a pouco.', 4500);
  desenharLivros();
}
function novoLivro(id, f, tipo, base) {
  const pasta = base ? base.pasta : (pastaAtual() !== 'todos' ? pastaAtual() : null);
  return {
    id, nome: f.name, tipo, tamanho: f.size, pasta: pasta || null, apagado: 0,
    pos: base ? { ...base.pos } : {}, progresso: base ? base.progresso || 0 : 0, ultima: Date.now(),
    marcas: base ? base.marcas.map(m => ({ ...m })) : [], marcasApagadas: {}, alt: { meta: Date.now() }, nuvem: {}
  };
}
async function abrirArquivo(f) {
  const tipo = tipoDe(f.name);
  if (!tipo) { carregando(false); aviso('Formato não suportado.'); return; }
  fecharLeitura();
  const minha = ++abertura;
  const motor = tipo === 'pdf' ? 'pdf' : 'epub';
  const id = f.hash;
  let r = dados.livros[id];
  if (!r) {
    // mesmo caminho com conteúdo diferente (arquivo editado) ou registro antigo: herda pasta, marcações e posição
    const antigoId = Object.keys(dados.caminhos).find(k => k !== id && dados.caminhos[k] === f.path && dados.livros[k]);
    const antigo = antigoId ? dados.livros[antigoId] : null;
    r = dados.livros[id] = novoLivro(id, f, tipo, antigo);
    if (antigo) { antigo.apagado = Date.now(); delete dados.caminhos[antigoId]; if (!antigo.legado) tocar(antigo); }
    tocar(r);
  } else {
    if (r.apagado) { r.apagado = 0; tocar(r); }
    if (r.nome !== f.name || r.tipo !== tipo) { r.nome = f.name; r.tipo = tipo; tocar(r); }
    r.tamanho = f.size;
  }
  if (!r.pos) r.pos = {};
  if (!Array.isArray(r.marcas)) r.marcas = [];
  dados.caminhos[id] = f.path;
  r.ultima = Date.now(); sujo();
  reg = r;
  atual = { id, path: f.path, name: f.name, size: f.size, tipo, motor, bytes: f.data };
  gravar();

  $('#bib-wrap').hidden = true; $('#leitura').hidden = false; $('#controles-leitura').hidden = false;
  $('#titulo-doc').textContent = semExt(f.name);
  document.title = f.name + ' — ' + NOME_APP;
  $('#sel-fonte').hidden = motor !== 'epub';
  $('#rodape-pdf').hidden = motor !== 'pdf';
  $('#pos-pag').title = motor === 'pdf' ? 'Página atual. Digite um número e aperte Enter para ir até ela.'
    : 'Página atual. Em EPUB e Word cada página tem o tamanho de uma página de livro impresso (cerca de 1.300 letras), então o número não muda com a fonte nem com o tamanho da janela. Digite um número e aperte Enter para ir até ela.';
  posTela = { pct: '', pag: '' }; $('#in-pct').value = ''; $('#in-pagina').value = '';
  $('#tot-paginas').textContent = ''; $('#rod-cap').textContent = ''; $('#rod-pct').textContent = '';
  $('#bt-menos').title = motor === 'pdf' ? 'Diminuir zoom (Ctrl −)' : 'Diminuir letra (Ctrl −)';
  $('#bt-mais').title = motor === 'pdf' ? 'Aumentar zoom (Ctrl +)' : 'Aumentar letra (Ctrl +)';
  carregando(true, tipo === 'docx' || tipo === 'doc' ? 'Preparando o documento do Word…' : 'Abrindo…');
  try {
    if (motor === 'pdf') await abrirPDF(minha);
    else {
      const buf = tipo === 'epub' ? u8ParaBuffer(atual.bytes) : await wordParaEPUB(tipo, atual.bytes, semExt(f.name));
      if (minha !== abertura) return;
      await abrirEPUB(buf, minha);
    }
  } catch (err) {
    if (minha !== abertura) return;
    console.error(err);
    aviso(tipo === 'doc' || tipo === 'docx' ? 'Não foi possível ler este documento do Word.' : 'Não foi possível abrir este arquivo. Ele pode estar danificado ou protegido.', 4500);
    mostrarBiblioteca();
    return;
  } finally { if (minha === abertura) carregando(false); }
  if (minha !== abertura) return;
  atualizarListaNotas();
  garantirCapa(id, tipo, f.size);
  if (nuvem.conectado) transferir();
}
function fecharLeitura() {
  esconderMenus(); fecharPop();
  if (pdf) { pdf.obs && pdf.obs.disconnect(); try { pdf.doc.destroy(); } catch (e) {} pdf = null; }
  if (epub) { epub.ro && epub.ro.disconnect(); try { epub.book.destroy(); } catch (e) {} epub = null; }
  $('#pdf-paginas').replaceChildren(); $('#epub-view').replaceChildren();
  $('#pdf-scroll').hidden = true; $('#epub-area').hidden = true;
  $('#lista-sumario').replaceChildren();
  atual = null; reg = null;
}

/* ================= PDF ================= */
async function abrirPDF(minha) {
  await usar('pdf');
  const doc = await abrirDocPDF(atual.bytes.slice());
  if (minha !== abertura) { doc.destroy(); return; }
  pdf = { doc, tamanhos: [], paginas: [], escala: 1, renderizadas: new Set() };
  $('#pdf-scroll').hidden = false;
  $('#tot-paginas').textContent = '/ ' + doc.numPages;
  // mede só a 1ª página para mostrar logo; as outras são medidas em segundo plano
  const p1 = await doc.getPage(1);
  const v = p1.getViewport({ scale: 1 });
  pdf.tamanhos = Array.from({ length: doc.numPages }, () => [v.width, v.height]);
  if (reg.pos.zoom) pdf.escala = reg.pos.zoom;
  else {
    const larg = $('#pdf-scroll').clientWidth - (ehMovel() ? 20 : 60);
    pdf.escala = Math.min(1.6, Math.max(0.5, larg / v.width));
  }
  montarPDF(reg.pos.pagina || 1);
  sumarioPDF();
  medirPaginasPDF(doc);
}
async function medirPaginasPDF(doc) {
  const n = doc.numPages, LOTE = 40;
  for (let ini = 2; ini <= n; ini += LOTE) {
    await ocioso(300);
    if (!pdf || pdf.doc !== doc) return;
    const fim = Math.min(n, ini + LOTE - 1);
    const pags = await Promise.all(Array.from({ length: fim - ini + 1 }, (_, j) => doc.getPage(ini + j))).catch(() => null);
    if (!pags || !pdf || pdf.doc !== doc) return;
    const mudadas = [];
    pags.forEach((pg, j) => {
      const vp = pg.getViewport({ scale: 1 }), k = ini + j - 1, t = pdf.tamanhos[k];
      if (Math.abs(t[0] - vp.width) > 0.5 || Math.abs(t[1] - vp.height) > 0.5) { pdf.tamanhos[k] = [vp.width, vp.height]; mudadas.push(k); }
    });
    if (!mudadas.length) continue;
    const sc = $('#pdf-scroll'), ref = paginaAtualPDF(), dRef = pdf.paginas[ref - 1], delta = sc.scrollTop - dRef.offsetTop;
    for (const k of mudadas) {
      const d = pdf.paginas[k], [w, h] = pdf.tamanhos[k];
      d.style.width = Math.floor(w * pdf.escala) + 'px'; d.style.height = Math.floor(h * pdf.escala) + 'px';
      if (pdf.renderizadas.has(k + 1)) { descarregar(k + 1); renderPagina(k + 1); }
    }
    sc.scrollTop = dRef.offsetTop + delta;
    centrarPaginaPDF(ref);
  }
}
/* PDF com páginas de larguras diferentes: a coluna fica tão larga quanto a maior;
   a rolagem para os lados acompanha a página atual para ela não aparecer cortada */
function centrarPaginaPDF(n) {
  const sc = $('#pdf-scroll'), d = pdf && pdf.paginas[n - 1];
  if (!d || sc.scrollWidth <= sc.clientWidth + 1) return;
  const r = d.getBoundingClientRect(), rs = sc.getBoundingClientRect();
  if (r.width > sc.clientWidth) return;   // página mais larga que a tela: o usuário rola
  sc.scrollLeft = sc.scrollLeft + (r.left + r.width / 2) - (rs.left + sc.clientWidth / 2);
}
function montarPDF(irPara) {
  const cont = $('#pdf-paginas');
  if (pdf.obs) pdf.obs.disconnect();
  pdf.renderizadas.clear(); pdf.paginas = [];
  const s = pdf.escala;
  pdf.obs = new IntersectionObserver(ents => {
    for (const e of ents) {
      const i = +e.target.dataset.p;
      if (e.isIntersecting) renderPagina(i); else descarregar(i);
    }
  }, { root: $('#pdf-scroll'), rootMargin: '1200px 0px' });
  const frag = document.createDocumentFragment();
  pdf.tamanhos.forEach(([w, h], k) => {
    const d = document.createElement('div');
    d.className = 'pagina'; d.dataset.p = k + 1;
    d.style.width = Math.floor(w * s) + 'px'; d.style.height = Math.floor(h * s) + 'px';
    const num = document.createElement('span'); num.className = 'num'; num.textContent = k + 1; d.appendChild(num);
    frag.appendChild(d); pdf.paginas.push(d);
  });
  cont.replaceChildren(frag);
  pdf.paginas.forEach(d => pdf.obs.observe(d));
  tamanhoTxt(s * 100);
  requestAnimationFrame(() => irPaginaPDF(irPara, true));
}
async function renderPagina(i) {
  if (!pdf || pdf.renderizadas.has(i)) return;
  pdf.renderizadas.add(i);
  const meu = pdf, d = pdf.paginas[i - 1], escala = pdf.escala;
  const page = await pdf.doc.getPage(i);
  if (pdf !== meu || pdf.escala !== escala || !pdf.renderizadas.has(i)) return;
  const vp = page.getViewport({ scale: escala });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
  const tl = document.createElement('div'); tl.className = 'textLayer';
  tl.style.setProperty('--scale-factor', escala);
  const hl = document.createElement('div'); hl.className = 'camada-hl';
  d.querySelectorAll('canvas,.textLayer,.camada-hl').forEach(x => x.remove());
  d.prepend(cv); d.appendChild(tl); d.appendChild(hl);
  try {
    await page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    if (pdf !== meu || !pdf.renderizadas.has(i)) return;
    const tarefa = pdfjsLib.renderTextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp });
    await tarefa.promise;
  } catch (e) { /* página saiu da tela durante o desenho */ }
  desenharMarcasPDF(i);
}
function descarregar(i) {
  if (!pdf || !pdf.renderizadas.has(i)) return;
  const d = pdf.paginas[i - 1];
  const c = d.querySelector('canvas'); if (c) { c.width = 0; c.height = 0; }
  d.querySelectorAll('canvas,.textLayer,.camada-hl').forEach(x => x.remove());
  pdf.renderizadas.delete(i);
}
function desenharMarcasPDF(i) {
  if (!pdf || !reg) return;
  const d = pdf.paginas[i - 1]; const camada = d && d.querySelector('.camada-hl'); if (!camada) return;
  camada.replaceChildren();
  for (const m of reg.marcas.filter(m => m.pagina === i)) {
    m.rects.forEach(([x, y, w, h]) => {
      const el = document.createElement('div');
      el.className = 'hl ' + m.cor;
      Object.assign(el.style, { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' });
      el.title = m.nota ? m.nota : 'Clique para escrever uma nota';
      el.addEventListener('click', ev => { ev.stopPropagation(); abrirPop(m, ev.clientX, ev.clientY); });
      camada.appendChild(el);
    });
    if (m.nota && m.rects.length) {
      const [x, y] = m.rects[0];
      const pin = document.createElement('div'); pin.className = 'marca-nota';
      Object.assign(pin.style, { left: x * 100 + '%', top: y * 100 + '%' });
      pin.title = m.nota;
      pin.addEventListener('click', ev => { ev.stopPropagation(); abrirPop(m, ev.clientX, ev.clientY); });
      camada.appendChild(pin);
    }
  }
}
function paginaAtualPDF() {
  const sc = $('#pdf-scroll'); const lim = sc.scrollTop + sc.clientHeight * 0.35;
  // busca binária: rápido mesmo em PDFs com milhares de páginas
  let lo = 0, hi = pdf.paginas.length - 1, n = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (pdf.paginas[mid].offsetTop <= lim) { n = mid; lo = mid + 1; } else hi = mid - 1; }
  return n + 1;
}
function irPaginaPDF(n, instantaneo) {
  if (!pdf) return;
  n = Math.max(1, Math.min(pdf.doc.numPages, n | 0));
  const d = pdf.paginas[n - 1];
  $('#pdf-scroll').scrollTo({ top: d.offsetTop - 12, behavior: instantaneo ? 'auto' : 'smooth' });
  centrarPaginaPDF(n);
  atualizarPosPDF(n);
}
function atualizarPosPDF(n) {
  if (!pdf || !reg) return;
  const tot = pdf.doc.numPages;
  const prog = tot > 1 ? (n - 1) / (tot - 1) : 1;
  mostrarPos(Math.round(prog * 100), n);
  if (reg.pos.pagina === n) return;
  reg.pos.pagina = n; reg.progresso = prog; reg.ultima = Date.now(); sujo();
  $('#progresso-barra').style.width = (reg.progresso * 100) + '%';
  gravar();
}
let rafScroll = 0;
$('#pdf-scroll').addEventListener('scroll', () => {
  if (!pdf || rafScroll) return;
  rafScroll = requestAnimationFrame(() => { rafScroll = 0; if (pdf) atualizarPosPDF(paginaAtualPDF()); esconderMenus(); });
}, { passive: true });
function zoomPDF(dir) {
  const atualP = paginaAtualPDF();
  let i = ZOOMS.findIndex(z => z >= pdf.escala - 0.001);
  if (i < 0) i = ZOOMS.length - 1;
  if (dir > 0) i = (ZOOMS[i] > pdf.escala + 0.001 ? i : i + 1) + (dir - 1); else i = i + dir;   // dir = quantos passos (pinça dá vários de uma vez)
  i = Math.max(0, Math.min(ZOOMS.length - 1, i));
  if (ZOOMS[i] === pdf.escala) return;
  pdf.escala = ZOOMS[i]; reg.pos.zoom = pdf.escala; reg.ultima = Date.now(); sujo(); gravar();
  montarPDF(atualP);
}
async function sumarioPDF() {
  const out = await pdf.doc.getOutline().catch(() => null);
  const box = $('#lista-sumario'); box.replaceChildren();
  if (!out || !out.length) { box.innerHTML = '<p class="vazio">Este PDF não tem sumário.</p>'; return; }
  const frag = document.createDocumentFragment();
  const add = (itens, nivel) => {
    for (const it of itens) {
      const b = document.createElement('button'); b.className = 'sum-item n' + Math.min(nivel, 3); b.textContent = it.title;
      b.addEventListener('click', async () => {
        try {
          let dest = it.dest; if (typeof dest === 'string') dest = await pdf.doc.getDestination(dest);
          if (!dest) return;
          const idx = await pdf.doc.getPageIndex(dest[0]); irPaginaPDF(idx + 1);
        } catch (e) {}
      });
      frag.appendChild(b);
      if (it.items && it.items.length && nivel < 3) add(it.items, nivel + 1);
    }
  };
  add(out, 1);
  box.appendChild(frag);
}

/* seleção no PDF */
document.addEventListener('mouseup', e => {
  if (!pdf || (e.target.closest && e.target.closest('.menu-sel,.pop,#barra,#painel,.menu-flut'))) return;
  setTimeout(selecaoPDF, 10);
});
let tSelToque = null;
document.addEventListener('selectionchange', () => {
  if (!pdf || ultimoPonteiro !== 'touch') return;
  clearTimeout(tSelToque); tSelToque = setTimeout(selecaoPDF, 450);
});
function selecaoPDF() {
  {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const rg = sel.getRangeAt(0);
    const ini = rg.startContainer.nodeType === 1 ? rg.startContainer : rg.startContainer.parentElement;
    const pag = ini && ini.closest('.pagina'); if (!pag) return;
    const pr = pag.getBoundingClientRect();
    const vistos = new Set(); const rects = [];
    for (const r of rg.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < pr.top || r.top > pr.bottom) continue;
      const k = [Math.round(r.left), Math.round(r.top), Math.round(r.width)].join(',');
      if (vistos.has(k)) continue; vistos.add(k);
      rects.push([(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height]);
    }
    const texto = sel.toString().replace(/\s+/g, ' ').trim();
    if (!rects.length || !texto) return;
    pendente = { tipo: 'pdf', pagina: +pag.dataset.p, rects: juntarRects(rects), texto };
    const ult = rg.getBoundingClientRect();
    mostrarMenuSel(ult.left + ult.width / 2, ult.top, ult.bottom);
  }
}
function juntarRects(rs) {
  rs.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const r of rs) {
    const u = out[out.length - 1];
    if (u && Math.abs(u[1] - r[1]) < r[3] * 0.5 && r[0] <= u[0] + u[2] + 0.01) {
      const x2 = Math.max(u[0] + u[2], r[0] + r[2]); u[0] = Math.min(u[0], r[0]); u[2] = x2 - u[0];
      const y2 = Math.max(u[1] + u[3], r[1] + r[3]); u[1] = Math.min(u[1], r[1]); u[3] = y2 - u[1];
    } else out.push(r.slice());
  }
  return out;
}

/* ================= EPUB (e Word convertido) ================= */
async function abrirEPUB(buffer, minha) {
  await usar('epub');
  if (minha !== abertura) return;
  $('#epub-area').hidden = false;
  const book = ePub(buffer);
  const rend = book.renderTo('epub-view', { width: '100%', height: '100%', flow: 'paginated', spread: 'auto', minSpreadWidth: 1100, allowScriptedContent: false });
  epub = { book, rend, locaisProntos: false };
  // reajusta as colunas quando o painel abre/fecha ou a janela muda de tamanho
  let tRes = null;
  epub.ro = new ResizeObserver(() => { clearTimeout(tRes); tRes = setTimeout(() => { if (epub && epub.rend === rend) { try { rend.resize(); } catch (e) {} redesenharMarcasLogo(); } }, 120); });
  epub.ro.observe($('#epub-view'));
  // as cores da página ficam em temaNoDoc (os temas do epub.js "vazavam" de uma cor para a outra)
  rend.themes.default({ 'html': { 'overscroll-behavior': 'none' }, 'img, svg, image': { 'max-width': '100% !important', 'max-height': '92vh !important' }, 'p': { 'line-height': '1.6 !important' } });
  rend.hooks.content.register(contents => {
    fonteNoDoc(contents.document); temaNoDoc(contents.document);
    // deslizar para o lado é do leitor (virar a página), não do navegador ("voltar" do Chrome no celular)
    for (const el of [contents.document.documentElement, contents.document.body]) if (el) { el.style.touchAction = 'none'; el.style.overscrollBehavior = 'none'; }
    travarToque(contents.document, contents.window);
  });
  rend.themes.fontSize((reg.pos.fonte || 100) + '%'); tamanhoTxt(reg.pos.fonte || 100);
  $('#sel-fonte').value = dados.prefs.fonte;

  rend.on('relocated', loc => { posicaoEPUB(loc); redesenharMarcas(); });
  rend.on('resized', () => redesenharMarcasLogo());
  rend.on('keyup', teclas);
  rend.on('selected', (cfi, contents) => {
    const s = contents.window.getSelection();
    const texto = s ? s.toString().replace(/\s+/g, ' ').trim() : '';
    if (!texto) return;
    pendente = { tipo: 'epub', cfi, texto, contents };
    const fr = contents.document.defaultView.frameElement.getBoundingClientRect();
    const r = s.getRangeAt(0).getBoundingClientRect();
    mostrarMenuSel(fr.left + r.left + r.width / 2, fr.top + r.top, fr.top + r.bottom);
  });
  rend.on('click', () => esconderMenus());
  let toque = null;
  rend.on('touchstart', e => {
    ultimoPonteiro = 'touch';
    if (e.touches.length === 2) { toque = null; pinca.inicio(e.touches); return; }
    const t = e.changedTouches && e.changedTouches[0];
    toque = t && e.touches.length === 1 && !pinca.ativa ? { x: t.screenX, y: t.screenY, quando: Date.now() } : null;
  });
  rend.on('touchmove', e => { if (e.touches.length === 2) pinca.mover(e.touches); });
  rend.on('touchend', e => {
    if (pinca.ativa) { if (e.touches.length < 2) pinca.fim(); toque = null; return; }
    const t = e.changedTouches && e.changedTouches[0], ini = toque; toque = null;
    if (!t || !ini || !epub || epub.rend !== rend) return;
    const sel = e.view && e.view.getSelection && e.view.getSelection();
    if (sel && !sel.isCollapsed) return;                       // está selecionando texto
    const dx = t.screenX - ini.x, dy = t.screenY - ini.y, dt = Date.now() - ini.quando;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 900) { esconderMenus(); dx < 0 ? rend.next() : rend.prev(); return; }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || dt > 450) return;
    if (e.target && e.target.closest && e.target.closest('a[href]')) return;   // link do livro (nota de rodapé etc.)
    if (!$('#menu-sel').hidden || !$('#pop-nota').hidden) return;
    const area = $('#epub-area').getBoundingClientRect();
    const fr = e.view && e.view.frameElement ? e.view.frameElement.getBoundingClientRect() : { left: 0 };
    const rel = (fr.left + t.clientX - area.left) / area.width;
    if (rel < 0.28) rend.prev(); else if (rel > 0.72) rend.next(); else alternarImersivo();
  });

  if (ultimoPonteiro === 'touch' && !dados.prefs.dicaToque) { dados.prefs.dicaToque = 1; gravar(); setTimeout(() => aviso('Deslize ou toque nas laterais para virar a página.', 4000), 1200); }
  await rend.display(reg.pos.cfi || undefined);
  if (!epub || epub.book !== book) return;
  for (const m of reg.marcas) aplicarMarcaEPUB(m);

  book.loaded.navigation.then(nav => { if (epub && epub.book === book) sumarioEPUB(nav.toc); });
  const chaveLocais = atual.id;
  book.ready.then(async () => {
    let ok = false;
    const salvo = await API.locaisLer(chaveLocais).catch(() => null);
    if (salvo) { try { book.locations.load(salvo); ok = book.locations.length() > 0; } catch (e) {} }
    if (!ok) {
      await book.locations.generate(1300);
      if (!epub || epub.book !== book) return;
      API.locaisGravar(chaveLocais, book.locations.save()).catch(() => {});
    }
    if (!epub || epub.book !== book) return;
    epub.locaisProntos = true;
    const l = rend.currentLocation(); if (l && l.start) posicaoEPUB(l);
    atualizarListaNotas();
  }).catch(e => console.warn('posições', e));
}
/* fontes: as embutidas ficam em fontes/fontes.css e só baixam quando escolhidas */
function cssFonte() {
  const f = FONTE_POR_ID[dados.prefs.fonte];
  if (!f || !f.fam) return '';
  return `html body, html body *:not(pre):not(code):not(kbd):not(samp):not(tt) { font-family: ${f.fam} !important; }`;
}
function fonteNoDoc(d) {
  if (!d || !d.head) return;
  if (!d.getElementById('mrb-fontes')) {
    const l = d.createElement('link'); l.id = 'mrb-fontes'; l.rel = 'stylesheet';
    l.href = new URL('fontes/fontes.css', location.href).href;
    d.head.appendChild(l);
  }
  let s = d.getElementById('mrb-fonte');
  if (!s) { s = d.createElement('style'); s.id = 'mrb-fonte'; d.head.appendChild(s); }
  s.textContent = cssFonte();
}
function aplicarFonteEPUB() {
  $('#sel-fonte').value = dados.prefs.fonte;
  if (!epub) return;
  const cfi = reg && reg.pos.cfi;
  const docs = epub.rend.getContents().map(c => c.document);
  docs.forEach(fonteNoDoc);
  redesenharMarcasLogo();
  // depois que a fonte carrega o texto reflui; volta para o mesmo trecho
  Promise.all(docs.map(d => d.fonts ? d.fonts.ready : null)).then(() => {
    if (epub && cfi) epub.rend.display(cfi);
  });
}
function montarSeletorFontes() {
  const sel = $('#sel-fonte'); sel.replaceChildren();
  let grupo = sel;
  for (const f of FONTES) {
    if (f.grupo) { grupo = document.createElement('optgroup'); grupo.label = f.grupo; sel.appendChild(grupo); continue; }
    const o = document.createElement('option'); o.value = f.id; o.textContent = f.nome;
    if (f.fam) o.style.fontFamily = f.fam;
    grupo.appendChild(o);
  }
}
/* porcentagem lida (EPUB e Word): conta até o fim da página que está na tela, então a última página dá 100% */
function porcentagemEPUB(loc) {
  if (!epub || !epub.locaisProntos || !loc || !loc.start) return null;
  if (loc.atEnd) return 1;
  try {
    const p = epub.book.locations.percentageFromCfi((loc.end && loc.end.cfi) || loc.start.cfi);
    return typeof p === 'number' && isFinite(p) ? Math.min(1, Math.max(0, p)) : null;
  } catch (e) { return null; }
}
/* página em EPUB/Word: cada "página" é uma posição do epub.js (~1.300 letras), estável em qualquer fonte e janela */
function paginaDeCfi(cfi) {
  const L = epub.book.locations, tot = L.length();
  const k = L.locationFromCfi(cfi);
  if (k < 0) return 1;
  // locationFromCfi diz onde o ponto "entraria" na lista: se não cai exatamente no início de uma página, ele está na anterior
  let exato = false;
  try { exato = L._locations[k] !== undefined && (L.epubcfi || new ePub.CFI()).compare(L._locations[k], cfi) === 0; } catch (e) {}
  return Math.max(1, Math.min(tot, exato ? k + 1 : k));
}
function cfiCmp(a, b) { try { return (epub.book.locations.epubcfi || new ePub.CFI()).compare(a, b); } catch (e) { return 0; } }
function naTela(cfi, loc) { return cfiCmp(cfi, loc.start.cfi) >= 0 && (loc.atEnd || cfiCmp(cfi, loc.end.cfi) <= 0); }
function paginaEPUB(loc, pct) {
  const tot = epub.book.locations.length();
  if (loc.atEnd || pct >= 1) return tot;
  // a última página pedida (digitando ou pela barra) aparece sempre que o começo dela estiver na tela;
  // nas outras telas a conta é a normal, então o número nunca anda para trás
  if (epub.alvo && naTela(epub.alvo.cfi, loc)) return epub.alvo.pag;
  return paginaDeCfi(loc.start.cfi);
}
async function irCfiEPUB(cfi, pag) {
  const e0 = epub;
  e0.alvo = { cfi, pag };
  await e0.rend.display(cfi);
  if (epub !== e0) return;
  let l = e0.rend.currentLocation();
  // o epub.js às vezes para uma tela antes do ponto pedido: nesse caso avança uma
  if (l && l.start && l.end && !l.atEnd && cfiCmp(cfi, l.end.cfi) > 0) { await e0.rend.next(); if (epub !== e0) return; l = e0.rend.currentLocation(); }
  if (l && l.start) posicaoEPUB(l);
}
function capituloPorIndice(i) {
  if (!epub || !epub.capitulos) return '';
  let nome = '';
  for (const c of epub.capitulos) { if (c.indice <= i) nome = c.rotulo; else break; }
  return nome;
}
function capituloEPUB(loc) { return loc && loc.start ? capituloPorIndice(loc.start.index) : ''; }

/* campos da barra de cima: porcentagem e página (os dois aceitam digitar e Enter) */
let posTela = { pct: '', pag: '' };
function mostrarPos(pct, pag) {
  posTela = { pct, pag };
  if (document.activeElement !== $('#in-pct')) $('#in-pct').value = pct;
  if (document.activeElement !== $('#in-pagina')) $('#in-pagina').value = pag;
}
function numeroDigitado(v) { return parseFloat(String(v).replace(',', '.').replace('%', '').trim()); }
function irPorcentagem(p) {
  if (!isFinite(p)) return;
  const f = Math.min(100, Math.max(0, p)) / 100;
  if (pdf) irPaginaPDF(Math.round(f * (pdf.doc.numPages - 1)) + 1, true);
  else if (epub && epub.locaisProntos) {
    const cfi = epub.book.locations.cfiFromPercentage(f);
    if (cfi) return irCfiEPUB(cfi, f >= 1 ? epub.book.locations.length() : paginaDeCfi(cfi));
  }
}
function irPagina(n) {
  if (!isFinite(n)) return;
  n = Math.round(n);
  if (pdf) irPaginaPDF(n, Math.abs(n - (reg.pos.pagina || 1)) > 3);
  else if (epub && epub.locaisProntos) {
    const tot = epub.book.locations.length();
    n = Math.max(1, Math.min(tot, n));
    const cfi = epub.book.locations.cfiFromLocation(n - 1);
    if (cfi) return irCfiEPUB(cfi, n);
  }
}
function posicaoEPUB(loc) {
  if (!epub || !reg || !loc || !loc.start) return;
  if (reg.pos.cfi !== loc.start.cfi) { reg.pos.cfi = loc.start.cfi; reg.ultima = Date.now(); sujo(); }
  const pct = porcentagemEPUB(loc);
  if (pct !== null) {
    reg.progresso = pct;
    const txt = pct >= 1 ? 100 : Math.min(99, Math.round(pct * 100));
    const tot = epub.book.locations.length();
    const pag = paginaEPUB(loc, pct);
    mostrarPos(txt, pag);
    $('#tot-paginas').textContent = '/ ' + tot;
    $('#rod-pct').textContent = pct >= 1 ? `Fim · pág. ${tot} de ${tot} · 100%` : `pág. ${pag} de ${tot} · ${txt}%`;
  } else {
    mostrarPos('', '');
    $('#tot-paginas').textContent = '/ …';
    $('#rod-pct').textContent = 'calculando páginas…';
  }
  $('#rod-cap').textContent = capituloEPUB(loc);
  $('#progresso-barra').style.width = ((reg.progresso || 0) * 100) + '%';
  gravar();
}
function fonteEPUB(dir) {
  const v = reg.pos.fonte || 100;
  let i = TAMANHOS.indexOf(v); if (i < 0) i = TAMANHOS.indexOf(100);
  i = Math.max(0, Math.min(TAMANHOS.length - 1, i + dir));
  reg.pos.fonte = TAMANHOS[i]; reg.ultima = Date.now(); sujo(); gravar();
  epub.rend.themes.fontSize(TAMANHOS[i] + '%'); tamanhoTxt(TAMANHOS[i]);
  redesenharMarcasLogo();
}
/* destaques do EPUB: o epub.js desenha cada um por cima do texto, numa camada à parte.
   Quando o texto muda de lugar (tamanho ou tipo de letra, janela, tela cheia), a camada precisa ser redesenhada. */
function redesenharMarcas() {
  if (!epub || !epub.rend.manager || !epub.rend.manager.views) return;
  const vs = epub.rend.manager.views;
  for (const v of (vs.all ? vs.all() : vs._views || [])) { try { if (v.pane) v.pane.render(); } catch (e) {} }
}
let tMarcas = [];
function redesenharMarcasLogo() {
  tMarcas.forEach(clearTimeout);
  tMarcas = [50, 250, 700, 1500].map(ms => setTimeout(redesenharMarcas, ms));   // o texto se reorganiza aos poucos (fontes carregando)
}
function capitulosDoSumario(toc) {
  const porIndice = new Map();
  const andar = itens => (itens || []).forEach(it => {
    try {
      const sec = epub.book.spine.get(String(it.href || '').split('#')[0]);
      const rotulo = (it.label || '').replace(/\s+/g, ' ').trim();
      if (sec && rotulo && !porIndice.has(sec.index)) porIndice.set(sec.index, rotulo);
    } catch (e) {}
    andar(it.subitems);
  });
  andar(toc);
  return [...porIndice.entries()].sort((a, b) => a[0] - b[0]).map(([indice, rotulo]) => ({ indice, rotulo }));
}
function sumarioEPUB(toc) {
  if (epub) {
    epub.capitulos = capitulosDoSumario(toc);
    const l = epub.rend.currentLocation(); if (l && l.start) $('#rod-cap').textContent = capituloEPUB(l);
  }
  const box = $('#lista-sumario'); box.replaceChildren();
  if (!toc || !toc.length) { box.innerHTML = '<p class="vazio">Este livro não tem sumário.</p>'; return; }
  const frag = document.createDocumentFragment();
  const add = (itens, nivel) => itens.forEach(it => {
    const b = document.createElement('button'); b.className = 'sum-item n' + Math.min(nivel, 3);
    b.textContent = (it.label || '').trim();
    b.addEventListener('click', () => epub && epub.rend.display(it.href));
    frag.appendChild(b);
    if (it.subitems && it.subitems.length) add(it.subitems, nivel + 1);
  });
  add(toc, 1);
  box.appendChild(frag);
}
function aplicarMarcaEPUB(m) {
  if (!epub) return;
  try {
    epub.rend.annotations.highlight(m.cfi, { id: m.id }, e => {
      const r = e && e.target && e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : null;
      abrirPop(m, r ? r.left + 20 : innerWidth / 2, r ? r.top : innerHeight / 3);
    }, 'hl-' + m.cor, { fill: CORES[m.cor].css, 'fill-opacity': '0.38', 'mix-blend-mode': 'multiply', stroke: 'none', outline: 'none' });
  } catch (e) { console.warn('marca inválida', e); }
}
function removerMarcaEPUB(m) { try { epub.rend.annotations.remove(m.cfi, 'highlight'); } catch (e) {} }

/* ================= Word (.docx e .doc) → EPUB em memória =================
   Converter para EPUB reaproveita tudo: paginação, fontes, temas, marcações, notas e sumário. */
async function wordParaEPUB(tipo, bytes, titulo) {
  let html;
  if (tipo === 'docx') {
    await usar('docx');
    const r = await mammoth.convertToHtml({ arrayBuffer: u8ParaBuffer(bytes) }, {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p.subtitulo:fresh", "p[style-name='Título'] => h1:fresh"]
    });
    html = r.value;
  } else {
    await usar('doc');
    const r = await LeitorDOC.extrair(bytes);
    html = textoParaHTML(r.corpo, (r.notas || '') + '\n' + (r.finais || ''));
  }
  return montarEPUB(titulo, html);
}
const RE_TITULO_DOC = /^(cap[ií]tulo|parte|livro|se[cç][aã]o|pr[oó]logo|ep[ií]logo|introdu[cç][aã]o|conclus[aã]o|pref[aá]cio|ap[eê]ndice|chapter|part|prologue|epilogue)\b/i;
function textoParaHTML(corpo, notas) {
  const out = [];
  for (const linha of String(corpo || '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = linha.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (t.length <= 90 && RE_TITULO_DOC.test(t) && !/[.;,]$/.test(t)) out.push('<h2>' + esc(t) + '</h2>');
    else out.push('<p>' + esc(t) + '</p>');
  }
  const ns = String(notas || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (ns.length) { out.push('<h2>Notas</h2>'); ns.forEach(n => out.push('<p>' + esc(n) + '</p>')); }
  return out.join('\n');
}
const escX = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PROIBIDOS = 'script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select,svg,math,video,audio,source,frame,frameset,template,noscript';
const ATRIB_OK = new Set(['href', 'src', 'alt', 'id', 'class', 'colspan', 'rowspan', 'title']);
function limparHTML(raiz) {
  raiz.querySelectorAll(PROIBIDOS).forEach(e => e.remove());
  for (const el of raiz.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (!ATRIB_OK.has(n)) { el.removeAttribute(a.name); continue; }
      if (n === 'href' && !/^(https?:|mailto:|#)/i.test(a.value.trim())) el.removeAttribute(a.name);
      if (n === 'src' && el.tagName !== 'IMG') el.removeAttribute(a.name);
    }
  }
}
async function montarEPUB(titulo, html) {
  await usar('epub');
  const doc = new DOMParser().parseFromString('<!doctype html><html><body>' + html + '</body></html>', 'text/html');
  const corpo = doc.body;
  limparHTML(corpo);
  // imagens viram arquivos separados dentro do EPUB
  const midias = [];
  for (const img of [...corpo.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || '';
    const m = /^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.exec(src);
    if (!m) { img.remove(); continue; }
    const ext = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', bmp: 'bmp' }[m[1].toLowerCase()];
    const nome = 'img' + (midias.length + 1) + '.' + ext;
    midias.push({ nome, tipo: 'image/' + m[1].toLowerCase(), dados: fetch(src).then(r => r.arrayBuffer()) });
    img.setAttribute('src', nome);
    if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
  }
  // texto solto no topo vira parágrafo
  for (const n of [...corpo.childNodes]) {
    if (n.nodeType === 3) { if (n.textContent.trim()) { const p = doc.createElement('p'); p.textContent = n.textContent; n.replaceWith(p); } else n.remove(); }
    else if (n.nodeType !== 1) n.remove();
  }
  const nivel = corpo.querySelector(':scope > h1') ? 'H1' : corpo.querySelector(':scope > h2') ? 'H2' : null;
  const sub = nivel === 'H1' ? 'H2' : nivel === 'H2' ? 'H3' : null;
  // divide em capítulos (pelos títulos) e quebra capítulos enormes para abrir rápido
  const caps = []; let cap = null, tam = 0;
  const novo = t => { cap = { nos: [], titulo: t }; caps.push(cap); tam = 0; };
  for (const n of [...corpo.children]) {
    if (nivel && n.tagName === nivel) {
      const t = n.textContent.replace(/\s+/g, ' ').trim() || 'Seção';
      if (cap && !cap.nos.length) cap.titulo = t; else novo(t);
    } else if (!cap || tam > 45000) novo(null);
    cap.nos.push(n);
    tam += n.textContent.length + n.querySelectorAll('img').length * 3000 + (n.tagName === 'IMG' ? 3000 : 0);
  }
  if (!caps.length) { novo(titulo); cap.nos.push(doc.createElement('p')); }
  // sumário + mapa de âncoras (notas de rodapé apontam para outro capítulo)
  const toc = [], ondeId = new Map();
  let ultimo = null, nId = 0;
  caps.forEach((c, i) => {
    c.arquivo = 'cap' + String(i + 1).padStart(3, '0') + '.xhtml';
    if (c.titulo) { ultimo = { titulo: c.titulo, href: c.arquivo, filhos: [] }; toc.push(ultimo); }
    for (const n of c.nos) {
      if (sub && n.tagName === sub) {
        if (!n.id) n.id = 'mrb' + (++nId);
        const item = { titulo: n.textContent.replace(/\s+/g, ' ').trim(), href: c.arquivo + '#' + n.id, filhos: [] };
        if (item.titulo) (ultimo ? ultimo.filhos : toc).push(item);
      }
      if (n.id) ondeId.set(n.id, c.arquivo);
      n.querySelectorAll('[id]').forEach(x => ondeId.set(x.id, c.arquivo));
    }
  });
  if (!toc.length) caps.forEach((c, i) => toc.push({ titulo: caps.length > 1 ? 'Parte ' + (i + 1) : titulo, href: c.arquivo, filhos: [] }));
  const ser = new XMLSerializer();
  const pagina = (t, conteudo, extraNS) => '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n' +
    `<html xmlns="http://www.w3.org/1999/xhtml"${extraNS || ''} lang="pt-BR" xml:lang="pt-BR"><head><meta charset="utf-8"/><title>${escX(t)}</title>` +
    '<link rel="stylesheet" type="text/css" href="estilo.css"/></head><body>' + conteudo + '</body></html>';

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/estilo.css', 'body{line-height:1.6;margin:0 3%;font-family:Georgia,Cambria,serif}h1,h2,h3,h4{line-height:1.25;page-break-after:avoid}' +
    'p{margin:0 0 .8em}img{max-width:100%;height:auto}table{border-collapse:collapse;margin:1em 0;max-width:100%}td,th{border:1px solid #999;padding:4px 7px;vertical-align:top}' +
    '.subtitulo{font-style:italic;opacity:.8}ol,ul{padding-left:1.6em}');
  caps.forEach(c => {
    const conteudo = c.nos.map(n => {
      n.querySelectorAll('a[href^="#"]').forEach(a => { const alvo = ondeId.get(a.getAttribute('href').slice(1)); if (alvo && alvo !== c.arquivo) a.setAttribute('href', alvo + a.getAttribute('href')); });
      return ser.serializeToString(n);
    }).join('\n');
    zip.file('OEBPS/' + c.arquivo, pagina(c.titulo || titulo, conteudo));
  });
  const li = itens => '<ol>' + itens.map(i => `<li><a href="${escX(i.href)}">${escX(i.titulo)}</a>${i.filhos.length ? li(i.filhos) : ''}</li>`).join('') + '</ol>';
  zip.file('OEBPS/nav.xhtml', pagina('Sumário', `<nav epub:type="toc" id="toc"><h1>Sumário</h1>${li(toc)}</nav>`, ' xmlns:epub="http://www.idpf.org/2007/ops"'));
  for (const m of midias) zip.file('OEBPS/' + m.nome, await m.dados);
  const id = hashTxt(titulo + '|' + html.length).toString(16);
  const opf = '<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="pt-BR">' +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:mrb:${id}</dc:identifier><dc:title>${escX(titulo)}</dc:title><dc:language>pt-BR</dc:language><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata>` +
    '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="estilo.css" media-type="text/css"/>' +
    caps.map((c, i) => `<item id="c${i + 1}" href="${c.arquivo}" media-type="application/xhtml+xml"/>`).join('') +
    midias.map((m, i) => `<item id="m${i + 1}" href="${m.nome}" media-type="${m.tipo}"/>`).join('') +
    '</manifest><spine>' + caps.map((c, i) => `<itemref idref="c${i + 1}"/>`).join('') + '</spine></package>';
  zip.file('OEBPS/content.opf', opf);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
}

/* ================= marcações ================= */
function mostrarMenuSel(x, y, yBase) {
  const m = $('#menu-sel'); m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
  if (ultimoPonteiro === 'touch' && yBase !== undefined) m.style.top = Math.max(8, Math.min(innerHeight - h - 12, yBase + 20)) + 'px';
  else m.style.top = (y - h - 10 < 60 ? y + 28 : y - h - 10) + 'px';
}
function esconderMenus() { $('#menu-sel').hidden = true; }
function criarMarca(cor, comNota) {
  if (!pendente || !reg) return;
  const m = { id: uid(), cor, texto: pendente.texto.slice(0, 2000), nota: '', criado: Date.now(), alterada: Date.now() };
  if (pendente.tipo === 'pdf') { m.pagina = pendente.pagina; m.rects = pendente.rects; }
  else { m.cfi = pendente.cfi; }
  reg.marcas.push(m); sujo(); gravar();
  if (pendente.tipo === 'pdf') { window.getSelection().removeAllRanges(); desenharMarcasPDF(m.pagina); }
  else { aplicarMarcaEPUB(m); try { pendente.contents.window.getSelection().removeAllRanges(); } catch (e) {} }
  const pos = $('#menu-sel').getBoundingClientRect();
  pendente = null; esconderMenus(); atualizarListaNotas();
  if (comNota) abrirPop(m, pos.left + 40, pos.top + 20);
  else aviso('Trecho destacado');
}
function abrirPop(m, x, y) {
  marcaAberta = m; esconderMenus();
  const p = $('#pop-nota'); p.hidden = false;
  $('#pop-trecho').textContent = '“' + m.texto + '”';
  $('#pop-texto').value = m.nota || '';
  const w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
  p.style.top = Math.max(60, Math.min(innerHeight - h - 8, y + 14)) + 'px';
  $('#pop-texto').focus();
}
function fecharPop() { $('#pop-nota').hidden = true; marcaAberta = null; }
function salvarNota() {
  if (!marcaAberta || !reg) return;
  // a sincronização pode ter trocado o objeto da marcação: grava no que está na lista
  const m = reg.marcas.find(x => x.id === marcaAberta.id) || marcaAberta;
  m.nota = $('#pop-texto').value.trim().slice(0, 20000); m.alterada = Date.now(); marcaAberta = m; sujo(); gravar();
  if (marcaAberta.pagina) desenharMarcasPDF(marcaAberta.pagina);
  fecharPop(); atualizarListaNotas(); aviso('Nota salva');
}
function excluirMarca() {
  const m = marcaAberta; if (!m || !reg) return;
  reg.marcas = reg.marcas.filter(x => x.id !== m.id);
  reg.marcasApagadas = reg.marcasApagadas || {}; reg.marcasApagadas[m.id] = Date.now(); sujo(); gravar();
  if (m.pagina) desenharMarcasPDF(m.pagina); else removerMarcaEPUB(m);
  fecharPop(); atualizarListaNotas(); aviso('Marcação excluída');
}
function ondeMarca(m) {
  if (m.pagina) return 'Pág. ' + m.pagina;
  if (epub && epub.locaisProntos) { try { return 'Posição ' + (epub.book.locations.locationFromCfi(m.cfi) + 1); } catch (e) {} }
  return '';
}
function ordemMarca(m) {
  if (m.pagina) return m.pagina * 10 + (m.rects[0] ? m.rects[0][1] : 0);
  if (epub && epub.locaisProntos) { try { return epub.book.locations.percentageFromCfi(m.cfi); } catch (e) {} }
  return m.criado;
}
function atualizarListaNotas() {
  const box = $('#lista-notas');
  const ms = reg ? reg.marcas.slice().sort((a, b) => ordemMarca(a) - ordemMarca(b)) : [];
  $('#qtd-notas').textContent = ms.length ? '(' + ms.length + ')' : '';
  $('#sem-notas').hidden = ms.length > 0;
  const frag = document.createDocumentFragment();
  for (const m of ms) {
    const it = document.createElement('div'); it.className = 'nota-item ' + m.cor; it.tabIndex = 0;
    it.innerHTML = `<span class="onde"></span><span class="trecho"></span>${m.nota ? '<span class="txt"></span>' : ''}`;
    it.querySelector('.onde').textContent = ondeMarca(m) + (m.nota ? ' · com nota' : '');
    it.querySelector('.trecho').textContent = '“' + m.texto + '”';
    if (m.nota) it.querySelector('.txt').textContent = m.nota;
    const ir = () => { if (m.pagina) irPaginaPDF(m.pagina); else if (epub) epub.rend.display(m.cfi); };
    it.addEventListener('click', ir);
    it.addEventListener('dblclick', () => { const r = it.getBoundingClientRect(); abrirPop(m, r.left - 180, r.top); });
    it.addEventListener('keydown', e => { if (e.key === 'Enter') ir(); });
    frag.appendChild(it);
  }
  box.replaceChildren(frag);
}

/* ================= exportar ================= */
function latin(s) {
  return String(s).replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');
}
function quebrar(txt, fonte, tam, larg) {
  const out = [];
  for (const par of latin(txt).split('\n')) {
    let linha = '';
    for (const w of par.split(' ')) {
      const t = linha ? linha + ' ' + w : w;
      if (fonte.widthOfTextAtSize(t, tam) > larg && linha) { out.push(linha); linha = w; } else linha = t;
    }
    out.push(linha);
  }
  return out;
}
async function exportarPDF() {
  if (!pdf || !reg) return;
  if (!reg.marcas.length) { aviso('Ainda não há marcações neste PDF.'); return; }
  carregando(true, 'Gerando PDF com marcações…');
  try {
    await usar('pdflib');
    const { PDFDocument, rgb, StandardFonts, BlendMode } = PDFLib;
    const doc = await PDFDocument.load(atual.bytes.slice(), { ignoreEncryption: true });
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    const negr = await doc.embedFont(StandardFonts.HelveticaBold);
    const pags = doc.getPages();
    const ms = reg.marcas.slice().sort((a, b) => ordemMarca(a) - ordemMarca(b));
    let num = 0;
    const numeros = new Map();
    for (const m of ms) {
      const pg = pags[m.pagina - 1]; if (!pg) continue;
      const cb = pg.getCropBox();
      const c = CORES[m.cor].rgb;
      for (const [x, y, w, h] of m.rects) {
        pg.drawRectangle({ x: cb.x + x * cb.width, y: cb.y + cb.height - (y + h) * cb.height, width: w * cb.width, height: h * cb.height, color: rgb(...c), opacity: 0.38, blendMode: BlendMode.Multiply });
      }
      if (m.nota) {
        num++; numeros.set(m.id, num);
        const [x, y] = m.rects[0];
        const cx = cb.x + x * cb.width - 6, cy = cb.y + cb.height - y * cb.height + 4;
        pg.drawCircle({ x: cx, y: cy, size: 7, color: rgb(0.17, 0.35, 0.55) });
        const t = String(num); pg.drawText(t, { x: cx - negr.widthOfTextAtSize(t, 8) / 2, y: cy - 3, size: 8, font: negr, color: rgb(1, 1, 1) });
      }
    }
    // páginas finais com as anotações
    const W = 595, H = 842, M = 56; let pg = null, y = 0;
    const nova = () => { pg = doc.addPage([W, H]); y = H - M; };
    nova();
    pg.drawText('Anotações', { x: M, y, size: 20, font: negr }); y -= 18;
    pg.drawText(latin(reg.nome), { x: M, y, size: 10, font: fonte, color: rgb(0.4, 0.4, 0.4) }); y -= 26;
    for (const m of ms) {
      const n = numeros.get(m.id);
      const blocos = [];
      blocos.push([negr, 10, `${n ? '(' + n + ') ' : ''}Página ${m.pagina}`, [0.17, 0.35, 0.55]]);
      for (const l of quebrar('"' + m.texto + '"', fonte, 10, W - 2 * M)) blocos.push([fonte, 10, l, [0.3, 0.3, 0.3]]);
      if (m.nota) for (const l of quebrar('Nota: ' + m.nota, negr, 10.5, W - 2 * M)) blocos.push([negr, 10.5, l, [0.1, 0.1, 0.1]]);
      const alt = blocos.length * 14 + 12;
      if (y - alt < M && alt < H - 2 * M) nova();
      for (const [f, s, t, c] of blocos) { if (y < M) nova(); pg.drawText(t, { x: M, y, size: s, font: f, color: rgb(...c) }); y -= 14; }
      y -= 12;
    }
    const bytes = await doc.save();
    const nome = semExt(reg.nome) + ' - anotado.pdf';
    carregando(false);
    const onde = await API.salvar(nome, bytes, 'pdf');
    if (onde) aviso('PDF salvo com as marcações.');
  } catch (e) { console.error(e); carregando(false); aviso('Não consegui gerar o PDF anotado.'); }
}
async function exportarTXT() {
  if (!reg || !reg.marcas.length) { aviso('Ainda não há marcações.'); return; }
  const ms = reg.marcas.slice().sort((a, b) => ordemMarca(a) - ordemMarca(b));
  let t = 'Anotações — ' + reg.nome + '\r\nExportado em ' + dataBR(Date.now()) + '\r\n\r\n';
  for (const m of ms) {
    t += (ondeMarca(m) || 'Trecho') + '\r\n“' + m.texto + '”\r\n' + (m.nota ? 'Nota: ' + m.nota + '\r\n' : '') + '\r\n';
  }
  const bytes = new TextEncoder().encode('﻿' + t);
  const onde = await API.salvar(semExt(reg.nome) + ' - anotações.txt', bytes, 'txt');
  if (onde) aviso('Anotações exportadas.');
}

/* ================= controles ================= */
function teclas(e) {
  if (e.key === 'Escape') { esconderMenus(); fecharPop(); fecharMenu(); if (!$('#pop-capas').hidden) popCapas(false); return; }
  if (!atual) return;
  const alvo = e.target && e.target.tagName;
  if (alvo === 'INPUT' || alvo === 'TEXTAREA' || alvo === 'SELECT') return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { proxima(); e.preventDefault && e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { anterior(); e.preventDefault && e.preventDefault(); }
}
function proxima() { if (pdf) irPaginaPDF(paginaAtualPDF() + 1); else if (epub) epub.rend.next(); }
function anterior() { if (pdf) irPaginaPDF(paginaAtualPDF() - 1); else if (epub) epub.rend.prev(); }
function mais() { if (pdf) zoomPDF(1); else if (epub) fonteEPUB(1); }
function menos() { if (pdf) zoomPDF(-1); else if (epub) fonteEPUB(-1); }

$('#bt-abrir').onclick = abrirDialogo; $('#bt-abrir2').onclick = abrirDialogo;
$('#bt-biblioteca').onclick = mostrarBiblioteca;
$('#bt-interface').onclick = menuInterface;
$('#bt-nuvem').onclick = menuNuvem;
$('#bt-fundo').onclick = menuFundo;
$('#bt-prox').onclick = proxima; $('#bt-ant').onclick = anterior;
$('#epub-dir').onclick = proxima; $('#epub-esq').onclick = anterior;
$('#bt-mais').onclick = mais; $('#bt-menos').onclick = menos;
$('#sel-tema').onchange = e => aplicarTema(e.target.value);
$('#sel-fonte').onchange = e => { dados.prefs.fonte = FONTE_POR_ID[e.target.value] ? e.target.value : 'original'; gravar(); aplicarFonteEPUB(); };
function painel(abrir) {
  const p = $('#painel');
  if (abrir === undefined) abrir = p.hidden;
  p.hidden = !abrir; $('#bt-painel').classList.toggle('ativo', abrir);
  if (abrir) opcoesTexto(false);
  if (!ehMovel()) { dados.prefs.painel = abrir; gravar(); }
}
$('#bt-painel').onclick = () => painel();
travarToque({ addEventListener: (t, f, o) => $('#epub-area').addEventListener(t, f, o) }, window);
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
for (const area of ['#epub-area', '#pdf-scroll']) {
  const el = $(area);
  el.addEventListener('touchstart', e => { if (e.touches.length === 2) pinca.inicio(e.touches); }, { passive: true });
  el.addEventListener('touchmove', e => { if (e.touches.length === 2) { pinca.mover(e.touches); if (e.cancelable) e.preventDefault(); } }, { passive: false });
  el.addEventListener('touchend', e => { if (e.touches.length < 2) pinca.fim(); }, { passive: true });
}
/* PDF no toque: um toque na página mostra/esconde a barra de cima */
$('#pdf-scroll').addEventListener('click', e => {
  if (!pdf || ultimoPonteiro !== 'touch' || e.target.closest('.hl,.marca-nota,a')) return;
  const sel = window.getSelection(); if (sel && !sel.isCollapsed) return;
  if (!$('#menu-sel').hidden || !$('#pop-nota').hidden) return;
  alternarImersivo();
});
$('#bt-fechar-painel').onclick = () => painel(false);
$('#painel').addEventListener('click', e => { if (ehMovel() && e.target.closest('.sum-item,.nota-item')) setTimeout(() => painel(false), 60); });
/* celular: "Aa" mostra tamanho do texto, cor da página e fonte numa segunda linha */
function opcoesTexto(abrir) {
  const b = $('#barra');
  if (abrir === undefined) abrir = !b.classList.contains('aa-aberto');
  b.classList.toggle('aa-aberto', abrir); $('#bt-aa').setAttribute('aria-expanded', String(abrir));
}
$('#bt-aa').onclick = () => opcoesTexto();
/* modo leitura: toque no meio da página esconde a barra de cima (só em telas de toque) */
function alternarImersivo(ligar) {
  const b = document.body;
  if (ligar === undefined) ligar = !b.classList.contains('imersivo');
  b.classList.toggle('imersivo', ligar);
  if (ligar) { esconderMenus(); fecharMenu(); opcoesTexto(false); }
  if (ligar && !dados.prefs.dicaImersivo) { dados.prefs.dicaImersivo = 1; gravar(); aviso('Toque no meio da página para mostrar a barra de novo.', 3500); }
}
document.querySelectorAll('.aba').forEach(a => a.onclick = () => {
  document.querySelectorAll('.aba').forEach(x => x.classList.toggle('ativa', x === a));
  $('#aba-notas').hidden = a.dataset.aba !== 'notas'; $('#aba-sumario').hidden = a.dataset.aba !== 'sumario';
});
document.querySelectorAll('#menu-sel .cor').forEach(b => b.onclick = () => criarMarca(b.dataset.cor, false));
$('#bt-nota').onclick = () => criarMarca('amarelo', true);
$('#bt-copiar').onclick = () => { if (pendente) navigator.clipboard.writeText(pendente.texto).then(() => aviso('Trecho copiado'), () => {}); esconderMenus(); };
$('#pop-salvar').onclick = salvarNota; $('#pop-cancelar').onclick = fecharPop; $('#pop-excluir').onclick = excluirMarca;
$('#pop-texto').addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) salvarNota(); if (e.key === 'Escape') fecharPop(); });
$('#bt-exportar-pdf').onclick = exportarPDF; $('#bt-exportar-txt').onclick = exportarTXT;
for (const [sel, chave, ir] of [['#in-pct', 'pct', irPorcentagem], ['#in-pagina', 'pag', irPagina]]) {
  const inp = $(sel);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') { inp.value = posTela[chave]; inp.blur(); return; }
    if (e.key !== 'Enter') return;
    const v = numeroDigitado(inp.value);
    inp.blur();
    if (isFinite(v)) ir(v);
  });
  inp.addEventListener('focus', () => inp.select());
  inp.addEventListener('blur', () => { inp.value = posTela[chave]; });
}

/* barra de andamento embaixo: passar o mouse mostra o destino, clicar ou arrastar leva até lá */
(() => {
  const barra = $('#progresso'), dica = $('#progresso-dica'), cheia = $('#progresso-barra');
  let arrastando = false;
  const fracao = e => { const r = barra.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const voltar = () => { cheia.style.width = ((reg && reg.progresso) || 0) * 100 + '%'; };
  function destino(f) {
    const pct = Math.round(f * 100);
    if (pdf) { const tot = pdf.doc.numPages; return `pág. ${Math.round(f * (tot - 1)) + 1} de ${tot} · ${pct}%`; }
    if (!epub) return '';
    if (!epub.locaisProntos) return 'Calculando as páginas do livro…';
    const loc = epub.book.locations, tot = loc.length();
    const cfi = loc.cfiFromPercentage(f);
    const pag = f >= 1 ? tot : paginaDeCfi(cfi);
    let cap = '';
    try { cap = capituloPorIndice(new ePub.CFI(cfi).spinePos); } catch (e) {}
    return (cap ? cap + ' · ' : '') + `pág. ${pag} de ${tot} · ${pct}%`;
  }
  function mostrarDica(e, f) {
    const t = destino(f);
    if (!t) { dica.hidden = true; return; }
    dica.textContent = t; dica.hidden = false;
    const r = barra.getBoundingClientRect(), w = dica.offsetWidth;
    dica.style.left = Math.min(r.width - w / 2 - 6, Math.max(w / 2 + 6, e.clientX - r.left)) + 'px';
  }
  barra.addEventListener('pointermove', e => {
    if (!atual) return;
    const f = fracao(e);
    mostrarDica(e, f);
    if (arrastando) cheia.style.width = f * 100 + '%';
  });
  barra.addEventListener('pointerleave', () => { if (!arrastando) dica.hidden = true; });
  barra.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !atual) return;
    e.preventDefault();
    arrastando = true; try { barra.setPointerCapture(e.pointerId); } catch (err) {} barra.classList.add('arrastando');
    const f = fracao(e); cheia.style.width = f * 100 + '%'; mostrarDica(e, f);
    esconderMenus();
  });
  barra.addEventListener('pointerup', async e => {
    if (!arrastando) return;
    arrastando = false; barra.classList.remove('arrastando');
    const f = fracao(e);
    if (!barra.matches(':hover')) dica.hidden = true;
    if (epub && !epub.locaisProntos) { voltar(); return; }
    try { await irPorcentagem(f * 100); } catch (err) {}
    voltar();
  });
  barra.addEventListener('pointercancel', () => { arrastando = false; barra.classList.remove('arrastando'); dica.hidden = true; voltar(); });
})();

/* tamanho das capas na biblioteca (vale só para este computador) */
const TAM_CAPAS = [
  { l: 104, nome: 'Bem pequenas' }, { l: 128, nome: 'Pequenas' }, { l: 158, nome: 'Médias (padrão)' },
  { l: 192, nome: 'Grandes' }, { l: 230, nome: 'Bem grandes' }, { l: 270, nome: 'Enormes' }
];
function aplicarTamCapas(i, salvar) {
  i = Math.max(0, Math.min(TAM_CAPAS.length - 1, Number.isInteger(i) ? i : 2));
  dados.prefs.capas = i;
  $('#lista-recentes').style.setProperty('--capa-l', TAM_CAPAS[i].l + 'px');
  $('#capas-range').value = i;
  $('#capas-nome').textContent = TAM_CAPAS[i].nome;
  $('#capas-menos').disabled = i === 0; $('#capas-mais').disabled = i === TAM_CAPAS.length - 1;
  if (salvar) gravar();
}
function mudarTamCapas(dir) { aplicarTamCapas(dados.prefs.capas + dir, true); }
function popCapas(abrir) {
  const pop = $('#pop-capas');
  if (abrir === undefined) abrir = pop.hidden;
  pop.hidden = !abrir; $('#bt-capas').setAttribute('aria-expanded', String(abrir));
  if (abrir) { fecharMenu(); $('#capas-range').focus(); }
}
$('#bt-capas').onclick = () => popCapas();
$('#capas-menos').onclick = () => mudarTamCapas(-1);
$('#capas-mais').onclick = () => mudarTamCapas(1);
$('#capas-range').addEventListener('input', e => aplicarTamCapas(parseInt(e.target.value, 10), true));
$('#pop-capas').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); popCapas(false); $('#bt-capas').focus(); } });
let rodaCapas = 0;
$('#bib-wrap').addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  rodaCapas += e.deltaY;
  if (Math.abs(rodaCapas) >= 80) { mudarTamCapas(rodaCapas < 0 ? 1 : -1); rodaCapas = 0; }
}, { passive: false });
document.addEventListener('keydown', e => {
  if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); abrirDialogo(); return; }
  if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); mostrarBiblioteca(); return; }
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); if (!$('#bib-wrap').hidden) mudarTamCapas(1); else if (atual) mais(); return; }
  if (e.ctrlKey && e.key === '-') { e.preventDefault(); if (!$('#bib-wrap').hidden) mudarTamCapas(-1); else if (atual) menos(); return; }
  teclas(e);
});
$('#pdf-scroll').addEventListener('wheel', e => { if (e.ctrlKey && pdf) { e.preventDefault(); e.deltaY < 0 ? zoomPDF(1) : zoomPDF(-1); } }, { passive: false });
document.addEventListener('mousedown', e => {
  const t = e.target.closest ? e.target : document.body;
  if (!t.closest('#menu-sel')) esconderMenus();
  if (!t.closest('#menu-flut') && !t.closest('#bt-interface,#bt-fundo')) fecharMenu();
  if (!t.closest('#pop-capas,#bt-capas') && !$('#pop-capas').hidden) popCapas(false);
  if (!t.closest('#pop-nota') && !t.closest('.hl,.marca-nota,.nota-item')) { if (!$('#pop-nota').hidden) fecharPop(); }
});
window.addEventListener('resize', () => { esconderMenus(); fecharMenu(); });
window.addEventListener('beforeunload', () => gravar(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') gravar(true); });

/* arrastar e soltar */
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); $('#soltar').classList.add('sobre'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); $('#soltar').classList.remove('sobre'); }));
document.addEventListener('drop', e => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
  if (!tipoDe(f.name)) { aviso('Só consigo abrir arquivos .pdf, .epub, .docx e .doc.'); return; }
  const p = API.caminhoDoArquivo(f); if (p) abrirCaminho(p);
});

/* ================= início ================= */
/* formato 4: livros identificados pelo conteúdo; caminhos valem só neste computador */
function validarDadosV4(d) {
  const livros = {}, caminhos = {}, pastas = {};
  for (const [id, r] of Object.entries(d.livros || {})) {
    const l = limparLivro(r, id); if (!l) continue;
    if (r.legado) l.legado = true;
    livros[id] = l;
  }
  for (const [id, c] of Object.entries(d.caminhos || {})) if (livros[id] && typeof c === 'string' && c.length < 4096) caminhos[id] = c;
  for (const [id, p] of Object.entries(d.pastas || {})) { const x = limparPasta(p, id); if (x) pastas[id] = x; }
  return { versao: 4, livros, caminhos, pastas, nuvem: d.nuvem && typeof d.nuvem === 'object' ? d.nuvem : {}, prefs: d.prefs && typeof d.prefs === 'object' ? d.prefs : {} };
}
/* formatos 1–3 (livros identificados pelo caminho) → formato 4. Roda uma vez. */
async function migrarParaV4(d) {
  const arquivos = d.arquivos && typeof d.arquivos === 'object' ? d.arquivos : {};
  const entradas = Object.entries(arquivos).filter(([p, r]) => typeof p === 'string' && r && typeof r.nome === 'string' && tipoDe(r.nome));
  const recentes = new Set(Array.isArray(d.recentes) ? d.recentes : []);
  if (entradas.length) carregando(true, 'Preparando a biblioteca para a nuvem (só desta vez)…');
  const ids = entradas.length ? await API.migrarIds(entradas.map(([caminho, r]) => ({ caminho, tamanho: r.tamanho }))) : {};
  const livros = {}, caminhos = {};
  for (const [caminho, r] of entradas) {
    const m = ids[caminho]; if (!m || livros[m.id]) continue;
    if (typeof r.locais === 'string') { try { await API.locaisGravar(m.id, r.locais); } catch (e) {} }
    const quando = r.ultima || 1;
    const l = limparLivro({
      nome: r.nome, tamanho: r.tamanho, pasta: null, apagado: recentes.has(caminho) ? 0 : 1,
      pos: r.pos, progresso: r.progresso, ultima: r.ultima || 0, semCapa: r.semCapa,
      marcas: (r.marcas || []).map(x => ({ ...x, alterada: x.criado || 1 })), alt: { meta: quando }
    }, m.id);
    if (!l) continue;
    if (!m.existe) l.legado = true;
    livros[m.id] = l; caminhos[m.id] = caminho;
  }
  carregando(false);
  return { versao: 4, livros, caminhos, pastas: {}, nuvem: {}, prefs: d.prefs && typeof d.prefs === 'object' ? d.prefs : {} };
}
function migrarPrefs(eraV1, versaoAntiga) {
  const p = dados.prefs;
  const velhas = { serif: 'georgia', sans: 'segoe' };
  if (velhas[p.fonte]) p.fonte = velhas[p.fonte];
  if (!FONTE_POR_ID[p.fonte]) p.fonte = 'original';
  // quem usava o tema escuro antes continua com o programa escuro
  if (!['claro', 'escuro', 'sistema'].includes(p.interface)) p.interface = eraV1 && p.tema === 'escuro' ? 'escuro' : 'sistema';
  // 2.0.1: a página passa a acompanhar o tema do programa (quem tinha escolhido sépia/escura mantém)
  if (versaoAntiga < 3 && (!p.tema || p.tema === 'claro')) p.tema = 'auto';
  if (!['auto', 'claro', 'sepia', 'escuro'].includes(p.tema)) p.tema = 'auto';
}
(async () => {
  montarSeletorFontes();
  const d = await API.dadosLer().catch(() => null);
  if (d && typeof d === 'object') {
    const versaoAntiga = typeof d.versao === 'number' ? d.versao : 1;
    dados = d.versao === 4 ? validarDadosV4(d) : await migrarParaV4(d);
    dadosProntos = true;
    migrarPrefs(versaoAntiga < 2, versaoAntiga);
    if (versaoAntiga !== 4) gravar(true);
  }
  dadosProntos = true;
  dados.prefs = Object.assign({ tema: 'auto', fonte: 'original', interface: 'sistema', pasta: 'todos' }, dados.prefs);
  aplicarInterface(dados.prefs.interface);
  aplicarTema(dados.prefs.tema);
  $('#sel-fonte').value = dados.prefs.fonte;
  if (dados.prefs.painel && !ehMovel()) { $('#painel').hidden = false; $('#bt-painel').classList.add('ativo'); }
  if (API.web) limparGuardados();
  aplicarTamCapas(dados.prefs.capas);
  API.aoAbrirCaminho(p => abrirCaminho(p));
  API.fundoUrl().then(aplicarFundo).catch(() => {});
  const ini = await API.arquivoInicial();
  if (ini) abrirCaminho(ini); else mostrarBiblioteca();
  iniciarNuvem();
  // aquece as bibliotecas de leitura enquanto o programa está parado
  setTimeout(async () => { await ocioso(2000); try { await usar('pdf'); await ocioso(2000); await usar('epub'); } catch (e) {} }, 1200);
})();
