'use strict';
/* Mr. B Reader — biblioteca na nuvem (Google Drive), do lado da página.
   A página nunca acessa a internet: pede tudo ao processo principal (window.leitor.nuvem).

   Como os dados se juntam entre vários computadores (mesmo usados ao mesmo tempo):
   - cada livro é identificado pelo conteúdo (SHA-256), então é o mesmo em qualquer PC;
   - "ficha" do livro (nome, pasta, removido) → vale a alteração mais recente (alt.meta);
   - posição de leitura → vale a leitura mais recente (ultima);
   - marcações → juntadas uma a uma; apagar deixa uma "lápide" para não voltar pelo outro PC;
   - pastas → vale a alteração mais recente de cada pasta.
   O índice é gravado em JSON canônico (chaves ordenadas): conteúdo igual = texto igual,
   assim nenhum PC reenvia à toa. */

const NV = window.leitor.nuvem;
const WEB = !!window.leitor.web;            // versão de navegador (computador ou celular)
const AQUI = WEB ? 'neste aparelho' : 'neste PC';
const nuvem = { configurado: false, embutida: false, conectado: false, email: '', estado: 'desligada', erro: '' };
let alteradoDesde = false;
let tSync = null, sincronizando = null, pedirOutra = false;
const falhasEnvio = new Map();     // id → quando falhou (tenta de novo depois)
const transf = new Map();          // id → { tipo, pct }

const RE_ID = /^[a-f0-9]{64}$/;
const RE_PASTA = /^[a-z0-9]{6,24}$/;
const RE_DRIVE = /^[A-Za-z0-9_-]{10,200}$/;

/* marca que algo sincronizável mudou */
function sujo() {
  alteradoDesde = true;
  if (nuvem.conectado) { clearTimeout(tSync); tSync = setTimeout(() => sincronizar('mudança'), 6000); }
}
function tocar(r) { r.alt = r.alt || {}; r.alt.meta = Math.max(Date.now(), (r.alt.meta || 0) + 1); sujo(); }

/* ---------------- formato e limpeza ---------------- */
function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const txt = (s, max) => typeof s === 'string' ? s.slice(0, max) : '';
const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
function limparNuvem(n) {
  const o = {};
  if (n && typeof n === 'object') {
    if (RE_DRIVE.test(n.arquivo || '')) o.arquivo = n.arquivo;
    if (RE_DRIVE.test(n.capa || '')) o.capa = n.capa;
    if (RE_DRIVE.test(n.pasta || '')) o.pasta = n.pasta;
    if (RE_DRIVE.test(n.id || '')) o.id = n.id;
    if (typeof n.nome === 'string') o.nome = n.nome.slice(0, 120);
    if (n.lixeira === true) o.lixeira = true;
  }
  return o;
}
function limparMarca(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || m.id.length > 40 || !CORES[m.cor]) return null;
  const o = { id: m.id, cor: m.cor, texto: txt(m.texto, 2000), nota: txt(m.nota, 20000), criado: num(m.criado), alterada: num(m.alterada) || num(m.criado) };
  if (m.pagina != null) {
    o.pagina = Math.max(1, Math.floor(num(m.pagina)));
    o.rects = Array.isArray(m.rects) ? m.rects.slice(0, 300).filter(r => Array.isArray(r) && r.length === 4).map(r => r.map(num)) : [];
    if (!o.rects.length) return null;
  } else if (typeof m.cfi === 'string' && m.cfi.length < 4000) o.cfi = m.cfi;
  else return null;
  return o;
}
function limparLivro(r, id) {
  if (!r || typeof r !== 'object' || !RE_ID.test(id) || typeof r.nome !== 'string' || !tipoDe(r.nome)) return null;
  const pos = {};
  if (r.pos && typeof r.pos === 'object') {
    if (r.pos.pagina) pos.pagina = Math.max(1, Math.floor(num(r.pos.pagina)));
    if (r.pos.zoom) pos.zoom = Math.min(4, Math.max(0.25, num(r.pos.zoom)));
    if (r.pos.fonte) pos.fonte = Math.min(300, Math.max(50, num(r.pos.fonte)));
    if (typeof r.pos.cfi === 'string' && r.pos.cfi.length < 4000) pos.cfi = r.pos.cfi;
  }
  const marcasApagadas = {};
  if (r.marcasApagadas && typeof r.marcasApagadas === 'object') for (const [k, v] of Object.entries(r.marcasApagadas).slice(0, 50000)) if (k.length <= 40) marcasApagadas[k] = num(v);
  const o = {
    id, nome: r.nome.slice(0, 250), tipo: tipoDe(r.nome), tamanho: num(r.tamanho),
    pasta: RE_PASTA.test(r.pasta || '') ? r.pasta : null, apagado: num(r.apagado),
    pos, progresso: Math.min(1, Math.max(0, num(r.progresso))), ultima: num(r.ultima),
    marcas: (Array.isArray(r.marcas) ? r.marcas.slice(0, 20000) : []).map(limparMarca).filter(Boolean),
    marcasApagadas, alt: { meta: num(r.alt && r.alt.meta) }, nuvem: limparNuvem(r.nuvem)
  };
  if (r.semCapa) o.semCapa = num(r.semCapa);
  return o;
}
function limparPasta(p, id) {
  if (!p || typeof p !== 'object' || !RE_PASTA.test(id) || typeof p.nome !== 'string') return null;
  const nome = p.nome.replace(/[\x00-\x1f]/g, '').trim().slice(0, 80);
  if (!nome) return null;
  return { id, nome, alt: num(p.alt), apagada: num(p.apagada), nuvem: limparNuvem(p.nuvem) };
}
function lerIndice(texto) {
  const j = JSON.parse(texto);
  if (!j || j.formato !== 'mrb-biblioteca') throw new Error('índice desconhecido');
  const livros = {}, pastas = {};
  for (const [id, r] of Object.entries(j.livros || {}).slice(0, 20000)) { const l = limparLivro(r, id); if (l) livros[id] = l; }
  for (const [id, p] of Object.entries(j.pastas || {}).slice(0, 2000)) { const x = limparPasta(p, id); if (x) pastas[id] = x; }
  return { livros, pastas };
}
function paraIndice() {
  const livros = {};
  for (const r of Object.values(dados.livros)) {
    if (r.legado) continue;
    const l = limparLivro(r, r.id); if (!l) continue;
    l.marcas.sort((a, b) => (a.id < b.id ? -1 : 1));
    livros[r.id] = l;
  }
  return { formato: 'mrb-biblioteca', versao: 1, livros, pastas: dados.pastas };
}

/* ---------------- mesclagem ---------------- */
function mesclarNuvem(pref, outro) {
  const o = { ...(outro || {}) };
  for (const [k, v] of Object.entries(pref || {})) if (v) o[k] = v;
  return o;
}
function mesclarLivro(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ma = num(a.alt && a.alt.meta), mb = num(b.alt && b.alt.meta);
  const M = mb > ma ? b : a, O = M === a ? b : a;
  const P = num(b.ultima) > num(a.ultima) ? b : a;
  const apagadas = { ...(a.marcasApagadas || {}) };
  for (const [k, v] of Object.entries(b.marcasApagadas || {})) apagadas[k] = Math.max(apagadas[k] || 0, v);
  const porId = new Map();
  for (const m of [...(a.marcas || []), ...(b.marcas || [])]) {
    if (apagadas[m.id]) continue;
    const x = porId.get(m.id);
    if (!x || num(m.alterada) > num(x.alterada)) porId.set(m.id, m);
  }
  const r = {
    id: a.id, nome: M.nome, tipo: M.tipo, tamanho: M.tamanho, pasta: M.pasta || null, apagado: M.apagado || 0,
    pos: P.pos, progresso: P.progresso, ultima: P.ultima,
    marcas: [...porId.values()].sort((x, y) => (x.id < y.id ? -1 : 1)),
    marcasApagadas: apagadas, alt: { meta: Math.max(ma, mb) }, nuvem: mesclarNuvem(M.nuvem, O.nuvem)
  };
  const sc = M.semCapa || O.semCapa; if (sc) r.semCapa = sc;
  return r;
}
function aplicarMesclagem(remoto) {
  let mudou = false;
  const ids = new Set([...Object.keys(dados.livros), ...Object.keys(remoto.livros)]);
  for (const id of ids) {
    const loc = dados.livros[id];
    if (loc && loc.legado) continue;
    const m = mesclarLivro(loc ? limparLivro(loc, id) : null, remoto.livros[id]);
    if (!m) continue;
    if (!loc) { dados.livros[id] = m; mudou = true; continue; }
    if (canonico(limparLivro(loc, id)) === canonico(m)) continue;
    const marcasAntes = loc.marcas;
    // mantém o mesmo objeto (o livro aberto continua apontando para ele)
    const idsAntes = canonico(marcasAntes.map(x => x.id + x.alterada).sort());
    // reaproveita os objetos de marcação locais que não mudaram
    const locPorId = new Map(marcasAntes.map(x => [x.id, x]));
    m.marcas = m.marcas.map(x => { const l = locPorId.get(x.id); return l && num(l.alterada) === num(x.alterada) ? l : x; });
    Object.assign(loc, m);
    mudou = true;
    if (atual && atual.id === id && canonico(loc.marcas.map(x => x.id + x.alterada).sort()) !== idsAntes) atualizarMarcasAbertas(marcasAntes);
  }
  for (const id of new Set([...Object.keys(dados.pastas), ...Object.keys(remoto.pastas)])) {
    const a = dados.pastas[id], b = remoto.pastas[id];
    if (!a) { dados.pastas[id] = b; mudou = true; continue; }
    if (!b) continue;
    const M = num(b.alt) > num(a.alt) ? b : a, O = M === a ? b : a;
    const novo = { ...M, nuvem: mesclarNuvem(M.nuvem, O.nuvem) };
    if (canonico(novo) !== canonico(a)) { Object.assign(a, novo); mudou = true; }
  }
  return mudou;
}
function atualizarMarcasAbertas(antes) {
  if (pdf) pdf.renderizadas.forEach(i => desenharMarcasPDF(i));
  if (epub) {
    const agora = new Map(reg.marcas.map(m => [m.id, m]));
    for (const m of antes) if (!agora.has(m.id)) removerMarcaEPUB(m);
    const tinha = new Set(antes.map(m => m.id));
    for (const m of reg.marcas) if (!tinha.has(m.id)) aplicarMarcaEPUB(m);
  }
  atualizarListaNotas();
}

/* ---------------- chamadas ao processo principal ---------------- */
function ok(res) {
  if (res && res.erro !== undefined) { const e = new Error(res.erro); e.desconectou = res.desconectou; e.reconectar = res.reconectar; throw e; }
  return res ? res.ok : undefined;
}
function estadoNuvem(estado, erro) {
  nuvem.estado = estado; nuvem.erro = erro || '';
  const b = $('#bt-nuvem');
  b.dataset.estado = estado;
  const t = { desligada: 'Nuvem: desconectada. Clique para entrar com o Google', ok: 'Nuvem: sincronizado' + (nuvem.email ? ' (' + nuvem.email + ')' : ''), sincronizando: 'Nuvem: sincronizando…', enviando: 'Nuvem: enviando livros…', erro: 'Nuvem: ' + (erro || 'erro'), pausada: 'Nuvem: pausada. Toque para continuar sincronizando' };
  b.title = t[estado] || 'Nuvem';
}
function tratarErro(e) {
  console.warn('nuvem', e);
  // navegador: a chave do Google vale 1 hora; quando vence, a nuvem pausa até um toque para reconectar
  if (e && e.reconectar) { estadoNuvem('pausada'); return; }
  if (e && e.desconectou) { nuvem.conectado = false; estadoNuvem('desligada'); aviso(e.message, 6000); return; }
  estadoNuvem('erro', e && e.message);
}

/* ---------------- sincronizar ---------------- */
async function sincronizar(motivo) {
  if (!nuvem.conectado) return;
  if (sincronizando) { pedirOutra = true; return sincronizando; }
  clearTimeout(tSync);
  sincronizando = (async () => {
    estadoNuvem('sincronizando');
    alteradoDesde = false;
    try {
      const r = ok(await NV.indiceBaixar());
      let remoto = { livros: {}, pastas: {} };
      if (r) { try { remoto = lerIndice(r.texto); } catch (e) { console.warn('índice da nuvem ilegível; será regravado', e); } }
      const mudou = aplicarMesclagem(remoto);
      await acoesNoDrive();
      const texto = canonico(paraIndice());
      let versao = r ? r.versao : null;
      if (!r || texto !== r.texto) versao = ok(await NV.indiceSubir(texto));
      dados.nuvem.versao = versao; dados.nuvem.ultima = Date.now();
      gravar();
      if (mudou && !$('#bib-wrap').hidden) { desenharPastas(); desenharLivros(); }
      estadoNuvem('ok');
      transferir();
    } catch (e) { tratarErro(e); }
  })();
  try { await sincronizando; }
  finally {
    sincronizando = null;
    if (pedirOutra) { pedirOutra = false; setTimeout(() => sincronizar('repetir'), 1500); }
  }
}
const destinoDrive = r => (r.pasta && dados.pastas[r.pasta] && !dados.pastas[r.pasta].apagada && dados.pastas[r.pasta].nuvem && dados.pastas[r.pasta].nuvem.id) || null;
async function acoesNoDrive() {
  // pastas novas ou renomeadas
  for (const p of Object.values(dados.pastas)) {
    p.nuvem = p.nuvem || {};
    if (p.apagada) continue;
    if (!p.nuvem.id) { p.nuvem.id = ok(await NV.pastaCriar(p.nome)); p.nuvem.nome = p.nome; p.alt = Math.max(Date.now(), p.alt + 1); }
    else if (p.nuvem.nome !== p.nome) { ok(await NV.pastaRenomear(p.nuvem.id, p.nome)); p.nuvem.nome = p.nome; p.alt = Math.max(Date.now(), p.alt + 1); }
  }
  // livros: lixeira e mudança de pasta
  for (const r of Object.values(dados.livros)) {
    if (r.legado || !r.nuvem || !r.nuvem.arquivo) continue;
    if (r.apagado) {
      if (!r.nuvem.lixeira) { ok(await NV.lixeira(r.nuvem.arquivo)); r.nuvem.lixeira = true; tocar(r); }
      continue;
    }
    if (r.nuvem.lixeira) { r.nuvem = r.nuvem.capa ? { capa: r.nuvem.capa } : {}; tocar(r); continue; }   // voltou à biblioteca: envia de novo
    const destino = destinoDrive(r);
    if (r.pasta && !destino) continue;   // a pasta ainda não existe no Drive
    if ((r.nuvem.pasta || null) !== destino) {
      ok(await NV.livroMover(r.nuvem.arquivo, destino));
      if (destino) r.nuvem.pasta = destino; else delete r.nuvem.pasta;
      tocar(r);
    }
  }
  // pastas apagadas (os livros já saíram delas)
  for (const p of Object.values(dados.pastas)) {
    if (p.apagada && p.nuvem && p.nuvem.id && !p.nuvem.lixeira) { ok(await NV.lixeira(p.nuvem.id)); p.nuvem.lixeira = true; p.alt = Math.max(Date.now(), p.alt + 1); }
  }
}

/* ---------------- envios e baixas em segundo plano ---------------- */
let transferindo = false;
async function transferir() {
  if (transferindo || !nuvem.conectado) return;
  transferindo = true;
  let mudou = false;
  try {
    // 1. livros deste PC que ainda não estão no Drive
    for (;;) {
      const r = Object.values(dados.livros).find(x => !x.legado && !x.apagado && dados.caminhos[x.id] && !(x.nuvem && x.nuvem.arquivo) &&
        !(x.pasta && !destinoDrive(x)) && !(falhasEnvio.get(x.id) > Date.now() - 10 * 60000));
      if (!r) break;
      estadoNuvem('enviando');
      const res = await NV.livroSubir({ caminho: dados.caminhos[r.id], id: r.id, nome: r.nome, tipo: r.tipo, pastaId: destinoDrive(r) });
      transf.delete(r.id); progressoCartao(r.id);
      if (res.erro !== undefined) {
        if (res.desconectou || res.reconectar) throw Object.assign(new Error(res.erro), { desconectou: res.desconectou, reconectar: res.reconectar });
        falhasEnvio.set(r.id, Date.now());
        console.warn('envio', r.nome, res.erro);
        if (/cheio/.test(res.erro)) { aviso(res.erro + ' Os livros novos não estão sendo enviados.', 7000); break; }
        continue;
      }
      r.nuvem = { ...(r.nuvem || {}), arquivo: res.ok };
      const d = destinoDrive(r); if (d) r.nuvem.pasta = d; else delete r.nuvem.pasta;
      tocar(r); gravar(); mudou = true;
    }
    // 2. capas: envia as deste PC e baixa as que faltam
    for (const r of Object.values(dados.livros)) {
      if (r.legado || r.apagado) continue;
      if (capasURL[r.id] && !(r.nuvem && r.nuvem.capa) && r.nuvem && r.nuvem.arquivo) {
        const res = await NV.capaSubir(r.id);
        if (res.ok) { r.nuvem.capa = res.ok; tocar(r); mudou = true; }
      } else if (r.nuvem && r.nuvem.capa && !capasURL[r.id]) {
        const res = await NV.capaBaixar(r.id, r.nuvem.capa);
        if (res.ok) { capasURL[r.id] = res.ok; trocarCapaNoCartao(r.id); }
      }
    }
  } catch (e) { tratarErro(e); }
  finally { transferindo = false; if (nuvem.estado === 'enviando') estadoNuvem('ok'); }
  if (mudou) sincronizar('após envios');
}
function progressoCartao(id) {
  const el = cartoes.get(id); if (!el) return;
  const t = transf.get(id), barra = el.querySelector('.prog-transf');
  if (!barra) return;
  barra.hidden = !t;
  if (t) { barra.firstElementChild.style.width = t.pct + '%'; barra.title = (t.tipo === 'envio' ? 'Enviando para o Google Drive: ' : 'Baixando: ') + t.pct + '%'; }
}
NV.aoProgresso(m => {
  if (!RE_ID.test(m.id)) return;
  const pct = m.total ? Math.round(m.feito / m.total * 100) : 0;
  if (pct >= 100) transf.delete(m.id); else transf.set(m.id, { tipo: m.tipo, pct });
  progressoCartao(m.id);
  if (m.tipo === 'baixa' && baixandoAgora === m.id) carregando(true, 'Baixando do Google Drive… ' + pct + '%');
});

let baixandoAgora = null;
async function baixarLivro(id, abrir) {
  const r = dados.livros[id];
  if (!r || !r.nuvem || !r.nuvem.arquivo) return null;
  if (!nuvem.conectado) { aviso('Entre na sua conta do Google (botão da nuvem) para baixar este livro.', 5000); return null; }
  baixandoAgora = id;
  if (abrir) carregando(true, 'Baixando do Google Drive…');
  const pasta = r.pasta && dados.pastas[r.pasta] ? dados.pastas[r.pasta].nome : '';
  const res = await NV.livroBaixar({ arquivoId: r.nuvem.arquivo, id, nome: r.nome, pasta });
  baixandoAgora = null; transf.delete(id); progressoCartao(id);
  if (res.erro !== undefined) {
    carregando(false);
    aviso(res.reconectar ? 'Toque na nuvem para reconectar ao Google e baixar este livro.' : 'Não consegui baixar: ' + res.erro, 5000);
    if (res.desconectou || res.reconectar) tratarErro(Object.assign(new Error(res.erro), { desconectou: res.desconectou, reconectar: res.reconectar }));
    return null;
  }
  dados.caminhos[id] = res.ok; gravar();
  if (abrir) abrirCaminho(res.ok);
  else { carregando(false); const el = cartoes.get(id); if (el) { const novo = cartao(r); el.replaceWith(novo); cartoes.set(id, novo); } }
  return res.ok;
}
async function baixarTodos() {
  const faltam = Object.values(dados.livros).filter(r => !r.apagado && !r.legado && !dados.caminhos[r.id] && r.nuvem && r.nuvem.arquivo);
  aviso(`Baixando ${faltam.length} livro(s) em segundo plano…`);
  let n = 0;
  for (const r of faltam) if (await baixarLivro(r.id, false)) n++;
  aviso(`${n} livro(s) baixado(s) ${WEB ? 'para este aparelho' : 'para Documentos\\Mr. B Reader'}.`, 4000);
}

/* ---------------- conta ---------------- */
async function atualizarEstadoNuvem() {
  const e = await NV.estado().catch(() => null);
  if (!e) return;
  Object.assign(nuvem, { configurado: e.configurado, embutida: e.embutida, conectado: e.conectado, email: e.email });
  estadoNuvem(e.conectado ? 'ok' : 'desligada');
}
async function configurarNuvem() {
  const v = await dialogo({
    titulo: 'Conectar ao Google',
    texto: 'Cole aqui o "ID do cliente" e a "Chave secreta do cliente" criados no Google Cloud (passo a passo no LEIA-ME, seção "Nuvem"). Isso é feito uma vez por computador.',
    campos: [{ rotulo: 'ID do cliente', valor: '', dica: '1234…-abc….apps.googleusercontent.com' }, { rotulo: 'Chave secreta do cliente', valor: '', dica: 'GOCSPX-…', senha: true }],
    ok: 'Salvar e entrar'
  });
  if (!v) return;
  const res = await NV.configurar(v[0], v[1]);
  if (res.erro !== undefined) { aviso(res.erro, 5000); return; }
  nuvem.configurado = true;
  entrarNuvem();
}
async function entrarNuvem() {
  if (WEB) {
    // no navegador o login é na própria aba: grava tudo antes de ir para a página do Google
    if (!nuvem.configurado) { aviso('A nuvem não está disponível nesta versão.'); return; }
    await gravar(true);
    const r = await NV.entrar();
    if (r && r.erro !== undefined) aviso('Não foi possível entrar: ' + r.erro, 5000);
    return;
  }
  if (!nuvem.configurado) return configurarNuvem();
  const espera = dialogo({ titulo: 'Entrar com o Google', texto: 'Abrimos o seu navegador. Entre na conta do Google e autorize o Mr. B Reader. Depois é só voltar para cá.', semOk: true, cancelar: 'Cancelar' });
  espera.then(v => { if (v === null) NV.cancelar(); });
  const res = await NV.entrar();
  fecharDialogo('ok');
  if (res.erro !== undefined) {
    if (!/cancelado/.test(res.erro)) aviso(res.erro === 'tempo' ? 'O login demorou demais. Tente de novo.' : 'Não foi possível entrar: ' + res.erro, 5000);
    return;
  }
  await concluirLogin(res.ok.email || '');
}
async function concluirLogin(email, silencioso) {
  // outra conta do Google: os endereços no Drive da conta anterior não valem nesta
  if (dados.nuvem.email && email && dados.nuvem.email !== email) {
    for (const r of Object.values(dados.livros)) r.nuvem = {};
    for (const p of Object.values(dados.pastas)) p.nuvem = {};
    dados.nuvem = {};
  }
  dados.nuvem.email = email;
  Object.assign(nuvem, { conectado: true, email });
  gravar(true);
  if (!silencioso) aviso('Conectado como ' + (email || 'sua conta do Google') + '. Sincronizando…', 4000);
  await sincronizar('login');
}
async function sairNuvem() {
  const c = await dialogo({ titulo: 'Sair da conta do Google?', texto: 'O Mr. B Reader para de sincronizar ' + (WEB ? 'neste aparelho' : 'neste computador') + '. Nada é apagado: seus livros e notas continuam aqui e no Google Drive.', ok: 'Sair da conta' });
  if (!c) return;
  await NV.sair();
  Object.assign(nuvem, { conectado: false, email: '' });
  estadoNuvem('desligada');
  aviso('Você saiu da conta do Google.');
}
function menuNuvem() {
  const quando = dados.nuvem && dados.nuvem.ultima ? new Date(dados.nuvem.ultima).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const faltam = Object.values(dados.livros).filter(r => !r.apagado && !r.legado && !dados.caminhos[r.id] && r.nuvem && r.nuvem.arquivo).length;
  const enviar = Object.values(dados.livros).filter(r => !r.apagado && !r.legado && dados.caminhos[r.id] && !(r.nuvem && r.nuvem.arquivo)).length;
  let itens;
  if (!nuvem.conectado) {
    itens = [
      { secao: 'Salve livros, marcações e notas no seu Google Drive e continue em qualquer ' + (WEB ? 'aparelho' : 'computador') + '.' },
      { rotulo: nuvem.configurado ? 'Entrar com o Google…' : 'Conectar ao Google…', acao: entrarNuvem }
    ];
    if (nuvem.configurado && !nuvem.embutida) itens.push('-', { rotulo: 'Trocar as chaves do Google Cloud…', acao: configurarNuvem });
  } else {
    const st = nuvem.estado === 'pausada' ? 'Pausada: no navegador a conexão com o Google vale 1 hora' : nuvem.estado === 'erro' ? 'Problema: ' + nuvem.erro : nuvem.estado === 'sincronizando' ? 'Sincronizando…' : enviar ? `Enviando livros (${enviar} na fila)…` : quando ? 'Tudo sincronizado às ' + quando : 'Conectado';
    itens = [
      { secao: nuvem.email || 'Conta do Google' },
      { secao: st },
      nuvem.estado === 'pausada' ? { rotulo: 'Continuar sincronizando', acao: entrarNuvem } : { rotulo: 'Sincronizar agora', acao: () => sincronizar('manual') },
      { rotulo: faltam ? `Baixar os ${faltam} livro(s) que não estão ${AQUI}` : 'Todos os livros já estão ' + AQUI, desativado: !faltam, acao: baixarTodos },
      '-',
      { rotulo: 'Sair da conta', acao: sairNuvem }
    ];
  }
  abrirMenu($('#bt-nuvem'), itens);
}

/* ---------------- ciclo ---------------- */
async function verificarRemoto() {
  if (!nuvem.conectado || sincronizando) return;
  if (alteradoDesde) return sincronizar('periódica');
  const v = await NV.indiceVersao().catch(() => null);
  if (v && v.ok !== undefined && v.ok !== (dados.nuvem && dados.nuvem.versao)) sincronizar('remota');
  else if (v && v.erro !== undefined && (v.desconectou || v.reconectar)) tratarErro(Object.assign(new Error(v.erro), { desconectou: v.desconectou, reconectar: v.reconectar }));
}
async function iniciarNuvem() {
  if (!dados.nuvem || typeof dados.nuvem !== 'object') dados.nuvem = {};
  await atualizarEstadoNuvem();
  // navegador: a página acabou de voltar da tela de login do Google?
  const volta = NV.loginRetorno ? await NV.loginRetorno() : null;
  if (volta && !volta.erro && !volta.pausada && typeof volta.email === 'string') await concluirLogin(volta.email, volta.silencioso);
  else if (volta && volta.pausada) estadoNuvem('pausada');
  else {
    if (volta && volta.erro) aviso(volta.erro === 'cancelado' ? 'Login cancelado.' : 'Não foi possível entrar: ' + volta.erro, 6000);
    if (nuvem.conectado) sincronizar('início');
  }
  setInterval(verificarRemoto, 45000);
  window.addEventListener('focus', () => verificarRemoto());
  // celular: ao voltar para o app confere a nuvem; ao sair, manda o que mudou
  if (WEB) document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') verificarRemoto();
    else if (nuvem.conectado && alteradoDesde) sincronizar('segundo plano');
  });
  // ao fechar o programa: grava e manda as últimas mudanças (até 8 s)
  API.antesDeFechar(async () => {
    gravar(true);
    if (nuvem.conectado && (alteradoDesde || sincronizando)) await Promise.race([sincronizar('fechar'), new Promise(r => setTimeout(r, 8000))]);
  });
}
