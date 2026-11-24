'use strict';
/* Mr. B Reader — versão para navegador (computador e celular).
   Faz o papel do Electron: entrega à página o mesmo objeto window.leitor que o programa de Windows usa.
   - Livros, capas, posições e preferências ficam no próprio navegador (IndexedDB), só neste aparelho.
   - Nenhum servidor recebe nada. A nuvem é opcional: cada pessoa entra com o próprio Google Drive.
   - Login do Google direto no navegador (OAuth 2.0 para apps JavaScript): o Google devolve uma chave de
     acesso de 1 hora, que fica guardada só neste navegador. Permissões mínimas: drive.file e drive.appdata. */
(() => {
  const CFG = window.MRB_CONFIG || {};
  const G = {
    auth: CFG.auth || 'https://accounts.google.com/o/oauth2/v2/auth',
    api: CFG.api || 'https://www.googleapis.com',
    revoke: CFG.revoke || 'https://oauth2.googleapis.com/revoke',
    userinfo: CFG.userinfo || 'https://www.googleapis.com/oauth2/v3/userinfo'
  };
  const ESCOPOS = 'openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
  const MB = 1024 * 1024;
  const MAX_LIVRO = 800 * MB, MAX_IMAGEM = 80 * MB, MAX_CAPA = 3 * MB, MAX_FUNDO = 25 * MB, MAX_DADOS = 32 * MB, MAX_LOCAIS = 16 * MB, MAX_INDICE = 32 * MB;
  const EXT_LIVRO = /\.(pdf|epub|docx|doc|txt|md|markdown|html|htm)$/i;
  const RE_ID = /^[a-f0-9]{64}$/;
  const RE_ID_DRIVE = /^[A-Za-z0-9_-]{10,200}$/;
  const MIMES = { pdf: 'application/pdf', epub: 'application/epub+zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain', md: 'text/markdown', html: 'text/html' };
  const ACEITA_LIVROS = '.pdf,.epub,.docx,.doc,.txt,.md,.markdown,.html,.htm,' + Object.values(MIMES).join(',');
  const PASTA_RAIZ = 'Mr. B Reader', NOME_INDICE = 'mrb-biblioteca.json', PASTA_MIME = 'application/vnd.google-apps.folder';
  const PEDACO = 4 * MB;   // envio retomável em pedaços de 4 MB (múltiplo de 256 KB)

  /* ---------------- banco do navegador (IndexedDB) ---------------- */
  let bancoP = null;
  function banco() {
    if (!bancoP) bancoP = new Promise((ok, erro) => {
      const r = indexedDB.open('mrb-leitor', 1);
      r.onupgradeneeded = () => { for (const l of ['kv', 'livros', 'capas', 'locais']) if (!r.result.objectStoreNames.contains(l)) r.result.createObjectStore(l); };
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); ok(db); };
      r.onerror = () => erro(r.error || new Error('Não consegui abrir o armazenamento do navegador.'));
    });
    return bancoP;
  }
  async function idb(loja, modo, fn) {
    const db = await banco();
    return new Promise((ok, erro) => {
      const tx = db.transaction(loja, modo);
      const req = fn(tx.objectStore(loja));
      let res;
      if (req) req.onsuccess = () => { res = req.result; };
      tx.oncomplete = () => ok(res);
      tx.onerror = () => erro(tx.error);
      tx.onabort = () => erro(tx.error || new Error('Operação cancelada pelo navegador.'));
    });
  }
  const ler = (loja, k) => idb(loja, 'readonly', s => s.get(k));
  const guardar = (loja, k, v) => idb(loja, 'readwrite', s => s.put(v, k));
  const tirar = (loja, k) => idb(loja, 'readwrite', s => s.delete(k));
  const chaves = loja => idb(loja, 'readonly', s => s.getAllKeys());
  const semEspaco = e => e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)));
  let pediuPersistencia = false;
  function pedirPersistencia() {
    // pede ao navegador para não apagar a biblioteca quando faltar espaço (alguns concedem sem perguntar)
    if (pediuPersistencia || !navigator.storage || !navigator.storage.persist) return;
    pediuPersistencia = true;
    navigator.storage.persisted().then(j => j || navigator.storage.persist()).catch(() => {});
  }

  /* ---------------- utilidades ---------------- */
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async dados => hex(await crypto.subtle.digest('SHA-256', dados));
  const aleatorio = (n = 24) => { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const tipoDe = nome => { const m = EXT_LIVRO.exec(nome || ''); if (!m) return null; const t = m[1].toLowerCase(); return { markdown: 'md', htm: 'html' }[t] || t; };
  function ehImagem(b) {
    if (!(b instanceof Uint8Array) || b.byteLength < 12) return false;
    const jpg = b[0] === 0xff && b[1] === 0xd8;
    const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const webp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    return jpg || png || webp;
  }
  const chamar = (nome, ...a) => { try { if (typeof window[nome] === 'function') return window[nome](...a); } catch (e) {} };

  // seletor de arquivo do aparelho (no celular abre o "Arquivos" do sistema)
  function escolherArquivo(aceita) {
    return new Promise(ok => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = aceita; inp.style.display = 'none';
      let feito = false;
      const fim = v => { if (feito) return; feito = true; inp.remove(); ok(v); };
      inp.addEventListener('change', () => fim((inp.files && inp.files[0]) || null));
      inp.addEventListener('cancel', () => fim(null));
      document.body.appendChild(inp);
      inp.click();
    });
  }

  /* ---------------- livros guardados no navegador ---------------- */
  // caminhos "idb:<sha256>" fazem o papel dos caminhos do disco no programa de Windows
  const soltos = new Map(); let nSolto = 0;   // arquivos arrastados para a janela, até serem guardados
  function registro(hash, r, dados) {
    return { path: 'idb:' + hash, name: r.nome, size: r.tamanho, mtime: r.mtime, hash, data: dados };
  }
  async function guardarArquivo(file) {
    if (!file || !tipoDe(file.name)) return { erro: 'Só consigo abrir arquivos .pdf, .epub, .docx, .doc, .txt, .md e .html.' };
    if (file.size > MAX_LIVRO) return { erro: 'Arquivo grande demais (máximo 800 MB).' };
    const buf = await file.arrayBuffer();
    const hash = await sha256(buf);
    const r = { nome: file.name, tamanho: buf.byteLength, mtime: file.lastModified || Date.now() };
    try {
      if (!(await ler('livros', hash))) await guardar('livros', hash, { ...r, blob: new Blob([buf], { type: MIMES[tipoDe(file.name)] }) });
    } catch (e) {
      if (semEspaco(e)) return { erro: 'Não há espaço no navegador para guardar este livro. Remova alguns da biblioteca.' };
      throw e;
    }
    pedirPersistencia();
    return registro(hash, r, new Uint8Array(buf));
  }
  async function lerGuardado(caminho) {
    const hash = String(caminho).slice(4);
    if (!RE_ID.test(hash)) return { erro: 'não encontrado' };
    const r = await ler('livros', hash);
    if (!r || !r.blob) return { erro: 'não encontrado' };
    return registro(hash, r, new Uint8Array(await r.blob.arrayBuffer()));
  }

  /* ---------------- capas, posições e fundo ---------------- */
  const urls = new Map();   // chave → endereço blob: em uso (para liberar a memória ao trocar)
  function urlDe(chave, blob) {
    const velha = urls.get(chave); if (velha) URL.revokeObjectURL(velha);
    const u = URL.createObjectURL(blob); urls.set(chave, u); return u;
  }
  async function capaGravar(id, bytes) {
    if (!RE_ID.test(id) || !(bytes instanceof Uint8Array) || bytes.byteLength > MAX_CAPA || !ehImagem(bytes)) throw new Error('Capa inválida');
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    await guardar('capas', id, blob);
    return urlDe('capa:' + id, blob);
  }

  /* ---------------- Google Drive ---------------- */
  let conta = null;     // { email, raizId, indiceId }
  let acesso = null;    // { token, expira }
  let retorno = null;   // resultado do login que acabou de voltar do Google (lido uma vez pela página)
  let aoProgresso = () => {};
  const avisar = m => { try { aoProgresso(m); } catch (e) {} };
  const urlRetorno = () => new URL('./', location.href).href;
  const salvarConta = () => (conta ? guardar('kv', 'conta', conta) : tirar('kv', 'conta'));

  function irAoGoogle(prompt, modo) {
    const estado = aleatorio();
    sessionStorage.setItem('mrb-estado', estado);
    sessionStorage.setItem('mrb-modo', modo);
    // depois de voltar, reabre o livro que estava aberto
    try { if (typeof atual !== 'undefined' && atual && /^idb:/.test(atual.path)) sessionStorage.setItem('mrb-reabrir', atual.path); } catch (e) {}
    const p = { client_id: CFG.clientId, redirect_uri: urlRetorno(), response_type: 'token', scope: ESCOPOS, state: estado, include_granted_scopes: 'true', prompt };
    if (conta && conta.email && prompt === 'none') p.login_hint = conta.email;
    location.assign(G.auth + '?' + new URLSearchParams(p));
    return new Promise(() => {});   // a página vai embora
  }
  async function voltaDoGoogle() {
    if (!/^#.*(access_token|error)=/.test(location.hash)) return false;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);   // tira a chave da barra de endereço
    const esperado = sessionStorage.getItem('mrb-estado'), modo = sessionStorage.getItem('mrb-modo') || 'interativo';
    sessionStorage.removeItem('mrb-estado'); sessionStorage.removeItem('mrb-modo');
    if (!esperado || h.get('state') !== esperado) { retorno = { erro: 'O retorno do Google não confere. Tente entrar de novo.' }; return true; }
    const erro = h.get('error');
    if (erro) {
      const precisaTela = /interaction_required|login_required|consent_required|account_selection_required/.test(erro);
      if (precisaTela && modo === 'manual') { await irAoGoogle('select_account', 'interativo'); return true; }   // tentou sem tela, agora mostra a do Google
      retorno = precisaTela ? { pausada: true } : { erro: erro === 'access_denied' ? 'cancelado' : erro };
      return true;
    }
    const escopos = (h.get('scope') || '').split(/\s+/);
    if (!escopos.some(s => s.endsWith('/drive.file')) || !escopos.some(s => s.endsWith('/drive.appdata'))) {
      retorno = { erro: 'Para sincronizar, deixe marcadas as permissões do Google Drive na tela do Google.' };
      return true;
    }
    acesso = { token: h.get('access_token'), expira: Date.now() + (+h.get('expires_in') || 3600) * 1000 };
    let email = '';
    try {
      const r = await fetch(G.userinfo, { headers: { authorization: 'Bearer ' + acesso.token } });
      if (r.ok) email = String((await r.json()).email || '');
    } catch (e) {}
    const mesma = conta && conta.email === email;
    conta = mesma ? conta : { email };
    await guardar('kv', 'acesso', acesso); await salvarConta();
    retorno = { email, silencioso: mesma && modo !== 'interativo' };
    return true;
  }
  const pronto = (async () => {
    try { conta = (await ler('kv', 'conta')) || null; acesso = (await ler('kv', 'acesso')) || null; } catch (e) {}
    const voltou = await voltaDoGoogle().catch(e => { retorno = { erro: String(e.message || e) }; return true; });
    // quem já usa a nuvem: ao abrir o site, renova a chave sem perguntar nada (uma vez por sessão)
    if (!voltou && conta && CFG.clientId && navigator.onLine && !(acesso && acesso.expira - 5 * 60000 > Date.now()) && !sessionStorage.getItem('mrb-auto')) {
      sessionStorage.setItem('mrb-auto', '1');
      await irAoGoogle('none', 'auto');
    }
  })();

  function erroReconectar() { return Object.assign(new Error('Toque na nuvem para continuar sincronizando.'), { reconectar: true }); }
  async function token() {
    if (!conta) throw Object.assign(new Error('desconectado'), { desconectou: true });
    if (acesso && acesso.expira - 60000 > Date.now()) return acesso.token;
    throw erroReconectar();
  }
  async function api(metodo, rota, { query, json, corpo, headers = {}, resposta = 'json', ok = [200] } = {}) {
    let tentativa = 0;
    for (;;) {
      const h = { authorization: 'Bearer ' + (await token()), ...headers };
      let body = corpo;
      if (json !== undefined) { h['content-type'] = 'application/json; charset=utf-8'; body = JSON.stringify(json); }
      const url = G.api + rota + (query ? '?' + new URLSearchParams(query) : '');
      let res;
      try { res = await fetch(url, { method: metodo, headers: h, body }); }
      catch (e) { if (++tentativa <= 3) { await espera(1000 * 2 ** tentativa); continue; } throw new Error('Sem conexão com a internet.'); }
      if (res.status === 401) { acesso = null; tirar('kv', 'acesso').catch(() => {}); throw erroReconectar(); }
      if ((res.status === 429 || res.status >= 500) && ++tentativa <= 4) { await espera(1000 * 2 ** tentativa + Math.random() * 500); continue; }
      if (!ok.includes(res.status)) {
        const j = await res.json().catch(() => ({}));
        const motivo = j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
        const e = new Error(motivo === 'storageQuotaExceeded' ? 'Seu Google Drive está cheio.' : (j.error && j.error.message) || ('Erro ' + res.status + ' do Google Drive'));
        e.status = res.status; throw e;
      }
      if (resposta === 'json') return res.json();
      if (resposta === 'texto') return res.text();
      return res;
    }
  }
  const aspas = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const CAMPOS = 'id,name,mimeType,parents,size,md5Checksum,modifiedTime,trashed,appProperties';
  async function listar(q, espacos = 'drive') {
    const out = []; let pageToken;
    do {
      const r = await api('GET', '/drive/v3/files', { query: { q, spaces: espacos, fields: `nextPageToken,files(${CAMPOS})`, pageSize: '1000', ...(pageToken ? { pageToken } : {}) } });
      out.push(...(r.files || [])); pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }
  async function raiz() {
    if (conta.raizId) {
      try { const f = await api('GET', '/drive/v3/files/' + conta.raizId, { query: { fields: 'id,trashed' } }); if (!f.trashed) return conta.raizId; }
      catch (e) { if (e.status !== 404) throw e; }
    }
    const achadas = await listar(`name = '${aspas(PASTA_RAIZ)}' and mimeType = '${PASTA_MIME}' and 'root' in parents and trashed = false`);
    conta.raizId = achadas.length ? achadas[0].id : (await api('POST', '/drive/v3/files', { query: { fields: 'id' }, json: { name: PASTA_RAIZ, mimeType: PASTA_MIME, parents: ['root'] } })).id;
    await salvarConta();
    return conta.raizId;
  }
  async function acharIndice() {
    if (conta.indiceId) return conta.indiceId;
    const a = await listar(`name = '${NOME_INDICE}' and trashed = false`, 'appDataFolder');
    a.sort((x, y) => String(x.modifiedTime).localeCompare(String(y.modifiedTime)));
    conta.indiceId = a.length ? a[a.length - 1].id : null;
    if (conta.indiceId) await salvarConta();
    return conta.indiceId;
  }
  const versaoDe = f => (f ? `${f.modifiedTime}|${f.md5Checksum || ''}` : null);
  function multipart(meta, dados, tipo) {
    const lim = 'mrb' + aleatorio(12).replace(/[^A-Za-z0-9]/g, '');
    const corpo = new Blob([
      `--${lim}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${lim}\r\ncontent-type: ${tipo}\r\n\r\n`,
      dados, `\r\n--${lim}--`
    ]);
    return { corpo, headers: { 'content-type': `multipart/related; boundary=${lim}` } };
  }
  const nomeLimpo = (n, max = 120) => String(n || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, max) || 'Sem nome';

  const nuvem = {
    async estado() {
      await pronto;
      return { configurado: !!CFG.clientId, embutida: true, conectado: !!conta, email: conta ? conta.email || '' : '' };
    },
    async configurar() { throw new Error('Nesta versão a conexão com o Google já vem pronta.'); },
    async entrar() { await pronto; return irAoGoogle(conta ? 'none' : 'select_account', conta ? 'manual' : 'interativo'); },
    async cancelar() { return true; },
    async sair() {
      await pronto;
      const t = acesso && acesso.token;
      conta = null; acesso = null;
      await tirar('kv', 'conta').catch(() => {}); await tirar('kv', 'acesso').catch(() => {});
      if (t) fetch(G.revoke + '?token=' + encodeURIComponent(t), { method: 'POST', mode: 'no-cors' }).catch(() => {});
      return true;
    },
    async loginRetorno() { await pronto; const r = retorno; retorno = null; return r; },
    async indiceVersao() {
      const id = await acharIndice(); if (!id) return null;
      try { return versaoDe(await api('GET', '/drive/v3/files/' + id, { query: { fields: 'modifiedTime,md5Checksum' } })); }
      catch (e) { if (e.status === 404) { conta.indiceId = null; return null; } throw e; }
    },
    async indiceBaixar() {
      const id = await acharIndice(); if (!id) return null;
      let meta;
      try { meta = await api('GET', '/drive/v3/files/' + id, { query: { fields: 'modifiedTime,md5Checksum,size' } }); }
      catch (e) { if (e.status === 404) { conta.indiceId = null; return null; } throw e; }
      if (+meta.size > MAX_INDICE) throw new Error('Índice da nuvem grande demais.');
      const texto = await api('GET', '/drive/v3/files/' + id, { query: { alt: 'media' }, resposta: 'texto' });
      return { texto, versao: versaoDe(meta) };
    },
    async indiceSubir(texto) {
      if (typeof texto !== 'string' || texto.length > MAX_INDICE) throw new Error('Índice inválido.');
      const id = await acharIndice();
      let f;
      if (id) f = await api('PATCH', '/upload/drive/v3/files/' + id, { query: { uploadType: 'media', fields: 'id,modifiedTime,md5Checksum' }, corpo: texto, headers: { 'content-type': 'application/json; charset=utf-8' } });
      else {
        const m = multipart({ name: NOME_INDICE, parents: ['appDataFolder'], mimeType: 'application/json' }, texto, 'application/json; charset=UTF-8');
        f = await api('POST', '/upload/drive/v3/files', { query: { uploadType: 'multipart', fields: 'id,modifiedTime,md5Checksum' }, corpo: m.corpo, headers: m.headers });
        conta.indiceId = f.id; await salvarConta();
      }
      return versaoDe(f);
    },
    async pastaCriar(nome) {
      const pai = await raiz();
      return (await api('POST', '/drive/v3/files', { query: { fields: 'id' }, json: { name: nomeLimpo(nome, 80), mimeType: PASTA_MIME, parents: [pai] } })).id;
    },
    async pastaRenomear(id, nome) {
      if (!RE_ID_DRIVE.test(id)) throw new Error('id inválido');
      await api('PATCH', '/drive/v3/files/' + id, { query: { fields: 'id' }, json: { name: nomeLimpo(nome, 80) } });
      return true;
    },
    async lixeira(id) {
      if (!RE_ID_DRIVE.test(id)) throw new Error('id inválido');
      try { await api('PATCH', '/drive/v3/files/' + id, { query: { fields: 'id' }, json: { trashed: true } }); }
      catch (e) { if (e.status !== 404) throw e; }
      return true;
    },
    async livroSubir({ caminho, id, nome, tipo, pastaId }) {
      if (!RE_ID.test(id) || !MIMES[tipo] || !/^idb:/.test(caminho)) throw new Error('Pedido inválido');
      if (pastaId != null && !RE_ID_DRIVE.test(pastaId)) throw new Error('Pasta inválida');
      const ja = await listar(`appProperties has { key='mrbId' and value='${id}' } and trashed = false`);
      if (ja.length) return ja[0].id;
      const f = await lerGuardado(caminho);
      if (f.erro) throw new Error('O livro não está mais guardado neste aparelho.');
      if (f.hash !== id) throw new Error('O livro guardado não confere.');
      const destino = pastaId || await raiz();
      const meta = { name: nomeLimpo(nome, 240), mimeType: MIMES[tipo], parents: [destino], appProperties: { mrbId: id } };
      const total = f.data.byteLength;
      const ini = await api('POST', '/upload/drive/v3/files', {
        query: { uploadType: 'resumable', fields: 'id' }, json: meta, resposta: 'bruta',
        headers: { 'x-upload-content-type': MIMES[tipo], 'x-upload-content-length': String(total) }
      });
      const sessao = ini.headers.get('location');
      if (!sessao) throw new Error('O Google Drive não abriu o envio.');
      let enviado = 0, falhas = 0;
      while (enviado < total) {
        const fim = Math.min(total, enviado + PEDACO);
        avisar({ tipo: 'envio', id, feito: enviado, total });
        let res = null;
        try { res = await fetch(sessao, { method: 'PUT', headers: { 'content-range': `bytes ${enviado}-${fim - 1}/${total}` }, body: f.data.slice(enviado, fim) }); } catch (e) {}
        if (res && (res.status === 200 || res.status === 201)) { avisar({ tipo: 'envio', id, feito: total, total }); return (await res.json()).id; }
        if (res && res.status === 308) { const r = res.headers.get('range'); enviado = r ? +r.split('-')[1] + 1 : fim; falhas = 0; continue; }
        if (res && res.status === 404) throw new Error('O envio expirou. Ele será tentado de novo.');
        if (++falhas > 5) throw new Error('Não consegui enviar o livro (conexão instável).');
        await espera(1000 * 2 ** falhas);
        try {
          const st = await fetch(sessao, { method: 'PUT', headers: { 'content-range': `bytes */${total}` } });
          if (st.status === 200 || st.status === 201) return (await st.json()).id;
          if (st.status === 308) { const r = st.headers.get('range'); enviado = r ? +r.split('-')[1] + 1 : 0; }
        } catch (e) {}
      }
      throw new Error('Envio incompleto.');
    },
    async livroMover(arquivoId, pastaId) {
      if (!RE_ID_DRIVE.test(arquivoId) || (pastaId != null && !RE_ID_DRIVE.test(pastaId))) throw new Error('id inválido');
      const destino = pastaId || await raiz();
      const f = await api('GET', '/drive/v3/files/' + arquivoId, { query: { fields: 'parents' } });
      const antigos = (f.parents || []).filter(p => p !== destino).join(',');
      await api('PATCH', '/drive/v3/files/' + arquivoId, { query: { addParents: destino, ...(antigos ? { removeParents: antigos } : {}), fields: 'id' }, json: {} });
      return destino;
    },
    async livroBaixar({ arquivoId, id, nome }) {
      if (!RE_ID_DRIVE.test(arquivoId) || !RE_ID.test(id) || !tipoDe(nome)) throw new Error('Pedido inválido');
      if (await ler('livros', id)) return 'idb:' + id;   // já está neste aparelho
      const res = await api('GET', '/drive/v3/files/' + arquivoId, { query: { alt: 'media' }, resposta: 'fluxo' });
      const total = +res.headers.get('content-length') || 0;
      const partes = []; let feito = 0, ultimo = 0;
      if (res.body && res.body.getReader) {
        const leitor = res.body.getReader();
        for (;;) {
          const { done, value } = await leitor.read();
          if (done) break;
          partes.push(value); feito += value.byteLength;
          if (feito > MAX_LIVRO) { leitor.cancel().catch(() => {}); throw new Error('Arquivo grande demais.'); }
          if (Date.now() - ultimo > 250) { ultimo = Date.now(); avisar({ tipo: 'baixa', id, feito, total }); }
        }
      } else partes.push(new Uint8Array(await res.arrayBuffer()));
      const blob = new Blob(partes, { type: MIMES[tipoDe(nome)] });
      if ((await sha256(await blob.arrayBuffer())) !== id) throw new Error('O arquivo baixado não confere com o original.');
      try { await guardar('livros', id, { nome: String(nome).slice(0, 240), tamanho: blob.size, mtime: Date.now(), blob }); }
      catch (e) { if (semEspaco(e)) throw new Error('Não há espaço no navegador para guardar este livro.'); throw e; }
      pedirPersistencia();
      avisar({ tipo: 'baixa', id, feito: blob.size, total: blob.size });
      return 'idb:' + id;
    },
    async capaSubir(id) {
      if (!RE_ID.test(id)) throw new Error('id inválido');
      const blob = await ler('capas', id);
      if (!blob) throw new Error('capa não encontrada');
      const m = multipart({ name: `capa-${id}.jpg`, parents: ['appDataFolder'], mimeType: 'image/jpeg' }, blob, 'image/jpeg');
      return (await api('POST', '/upload/drive/v3/files', { query: { uploadType: 'multipart', fields: 'id' }, corpo: m.corpo, headers: m.headers })).id;
    },
    async capaBaixar(id, arquivoId) {
      if (!RE_ID_DRIVE.test(arquivoId)) throw new Error('id inválido');
      const res = await api('GET', '/drive/v3/files/' + arquivoId, { query: { alt: 'media' }, resposta: 'bruta' });
      const b = new Uint8Array(await res.arrayBuffer());
      return capaGravar(id, b);
    }
  };
  // mesmo formato de resposta do programa de Windows: { ok } ou { erro, desconectou, reconectar }
  const envolver = fn => async (...a) => {
    try { await pronto; return { ok: await fn(...a) }; }
    catch (e) { return { erro: String((e && e.message) || e), desconectou: !!(e && e.desconectou), reconectar: !!(e && e.reconectar) }; }
  };
  const NV = {
    estado: nuvem.estado, configurar: envolver(nuvem.configurar), entrar: envolver(nuvem.entrar), cancelar: nuvem.cancelar,
    sair: nuvem.sair, loginRetorno: nuvem.loginRetorno,
    aoProgresso: fn => { aoProgresso = typeof fn === 'function' ? fn : () => {}; }
  };
  for (const k of ['indiceVersao', 'indiceBaixar', 'indiceSubir', 'pastaCriar', 'pastaRenomear', 'lixeira', 'livroSubir', 'livroMover', 'livroBaixar', 'capaSubir', 'capaBaixar']) NV[k] = envolver(nuvem[k]);

  /* ---------------- o objeto que a página usa ---------------- */
  let aoFechar = null;
  window.leitor = {
    web: true,
    async arquivoInicial() {
      await pronto;
      const p = sessionStorage.getItem('mrb-reabrir'); sessionStorage.removeItem('mrb-reabrir');
      return p && /^idb:[a-f0-9]{64}$/.test(p) ? p : null;
    },
    async abrirDialogo() {
      const f = await escolherArquivo(ACEITA_LIVROS);
      if (!f) return null;
      chamar('carregando', true);
      try { return await guardarArquivo(f); }
      catch (e) { return { erro: String(e.message || e) }; }
      finally { chamar('carregando', false); }
    },
    async abrirCaminho(p) {
      try {
        if (typeof p === 'string' && p.startsWith('arq:')) { const f = soltos.get(p); soltos.delete(p); return f ? await guardarArquivo(f) : { erro: 'não encontrado' }; }
        if (typeof p === 'string' && p.startsWith('idb:')) return await lerGuardado(p);
        return { erro: 'não encontrado' };
      } catch (e) { return { erro: String(e.message || e) }; }
    },
    caminhoDoArquivo(f) { const k = 'arq:' + (++nSolto); soltos.set(k, f); return k; },
    aoAbrirCaminho() {},
    async esquecer(caminho) {
      const hash = String(caminho || '').slice(4);
      if (/^idb:/.test(caminho) && RE_ID.test(hash)) await tirar('livros', hash).catch(() => {});
      return true;
    },
    async dadosLer() {
      await pronto;
      const t = await ler('kv', 'dados');
      try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
    },
    async dadosGravar(o) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Dados inválidos');
      const t = JSON.stringify(o);
      if (t.length > MAX_DADOS) throw new Error('Dados grandes demais');
      await guardar('kv', 'dados', t);
      return true;
    },
    async salvar(nome, bytes, tipo) {
      const TIPOS_SALVAR = { pdf: 'application/pdf', txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8', bib: 'application/x-bibtex;charset=utf-8', json: 'application/json' };
      if (!TIPOS_SALVAR[tipo] || !(bytes instanceof Uint8Array)) throw new Error('Pedido inválido');
      let n = String(nome || 'arquivo').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180);
      if (!n.toLowerCase().endsWith('.' + tipo)) n += '.' + tipo;
      const url = URL.createObjectURL(new Blob([bytes], { type: TIPOS_SALVAR[tipo] }));
      const a = document.createElement('a'); a.href = url; a.download = n; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      return n;
    },
    async mostrarNaPasta() { return false; },
    async abrirBackup() {
      const f = await escolherArquivo('.json,application/json');
      if (!f) return null;
      if (f.size > 64 * 1024 * 1024) return { erro: 'Arquivo grande demais para ser um backup.' };
      return { texto: await f.text() };
    },
    async capas(lista) {
      if (!Array.isArray(lista)) return {};
      const tem = new Set(await chaves('capas').catch(() => []));
      const out = {};
      for (const id of lista.slice(0, 5000)) {
        if (!RE_ID.test(id) || !tem.has(id)) continue;
        const u = urls.get('capa:' + id);
        if (u) { out[id] = u; continue; }
        const blob = await ler('capas', id).catch(() => null);
        if (blob) out[id] = urlDe('capa:' + id, blob);
      }
      return out;
    },
    capaGravar,
    async locaisLer(id) { return RE_ID.test(id) ? (await ler('locais', id).catch(() => null)) || null : null; },
    async locaisGravar(id, txt) {
      if (!RE_ID.test(id) || typeof txt !== 'string' || txt.length > MAX_LOCAIS) throw new Error('Pedido inválido');
      await guardar('locais', id, txt); return true;
    },
    async fundoEscolher() {
      const f = await escolherArquivo('image/jpeg,image/png,image/webp');
      if (!f) return null;
      if (f.size > MAX_IMAGEM) return { erro: 'Imagem grande demais (máximo 80 MB)' };
      return { nome: f.name, data: new Uint8Array(await f.arrayBuffer()) };
    },
    async fundoGravar(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FUNDO || !ehImagem(bytes)) throw new Error('Imagem inválida');
      const blob = new Blob([bytes]);
      await guardar('kv', 'fundo', blob);
      return urlDe('fundo', blob);
    },
    async fundoRemover() { await tirar('kv', 'fundo').catch(() => {}); return true; },
    async fundoUrl() { const b = await ler('kv', 'fundo').catch(() => null); return b ? urlDe('fundo', b) : null; },
    async temaInterface(v) {
      const escuro = v === 'escuro' || (v === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches);
      const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = escuro ? '#212327' : '#fbfaf7';
      return escuro;
    },
    async migrarIds() { return {}; },
    antesDeFechar(fn) { aoFechar = typeof fn === 'function' ? fn : null; },
    nuvem: NV
  };
  // ao sair da página ou mandar o app para o segundo plano: grava e tenta mandar as últimas mudanças
  window.addEventListener('pagehide', () => { if (aoFechar) aoFechar(); });

  /* ---------------- funcionar sem internet (app instalável) ---------------- */
  if ('serviceWorker' in navigator && CFG.offline !== false) {
    const tinha = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('modo sem internet indisponível', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (tinha) chamar('aviso', 'O Mr. B Reader foi atualizado. A versão nova vale na próxima vez que você abrir.', 5000);
    });
  }
})();
