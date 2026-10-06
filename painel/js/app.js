import * as tse from "./tse.js";
import * as feed from "./feed.js";
import { apurarCidade, agrupar, nulosTecnicos } from "./bu.js";
import { malha, projetar, zoomavel } from "./geo.js";
import { perfil, municipios2022, referencia2022, comparar, leitura, pctTxt, pp } from "./analise.js";
import { Delaunay } from "./vendor/d3-delaunay.js";
import { corPartido, corTexto, corMargem, rampaMargem, rampaCandidato, quebrasCandidato, classeCandidato, misturar, AGUARDANDO, TERRA } from "./cores.js";

const BASE_W = 1600, BASE_H = 900;

// Página publicada como retrato (sem TSE ao vivo): window.PAINEL_CONFIG.estatico
const estatico = () => !!(globalThis.PAINEL_CONFIG && globalThis.PAINEL_CONFIG.estatico);
// no celular as seções empilham e a página rola
const celular = () => innerWidth < 900;
const REFRESH_S = 60;
const REFRESH_CIDADE_S = 180;
const LIMITE_SECOES = 3000;

const $ = (s, el = document) => el.querySelector(s);
const fmt = new Intl.NumberFormat("pt-BR");
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// troca o conteúdo só quando muda, para não recriar botões no meio de um clique
const anterior = new WeakMap();
function definir(el, html) {
  if (anterior.get(el) === html) return false;
  anterior.set(el, html);
  el.innerHTML = html;
  return true;
}

function grande(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + " milhões";
  if (n >= 1e4) return Math.round(n / 1e3) + " mil";
  return fmt.format(n);
}

// ---------- estado ----------

const st = {
  cargo: "1", uf: "br", mun: "", zona: "", cand: "",
  modo: "lider",
  resumoUF: null,       // resultado do estado (ou do Brasil)
  resumo: null,         // resultado do recorte (estado ou município)
  municipios: null,     // { uf: [{cd, ibge, nome, zonas, capital}] }
  matriz: new Map(),    // mun -> linha do município (cargo e UF atuais)
  andamento: {},        // mun -> {hora, pct, ...}
  nacional: new Map(),  // uf -> linha do estado (Presidente, visão Brasil)
  nacionalR: new Map(), // uf -> resultado completo do estado
  nacionalMun: false,   // matriz de todos os municípios do Brasil carregada
  carga: null,
  geo: null,
  hist: new Map(),
  locais: new Map(),
  secoesUF: new Map(),
  cidade: null,         // {cd, cache, res, grande, total, zonas, carga}
  locaisCidade: null,
  zonas2022: null,
  refN: null,
  comp: null,
  tabela: { aba: "areas", ordem: "votos", desc: true, filtro: "" },
  geracao: 0,
  ctrl: new AbortController(),
  indice: null,
  proxima: 0,
  proximaCidade: 0,
  escala: 1,
  agora: null,          // agora.json do coletor
  candFeed: {},         // candidatos.json do coletor
  historico: null,      // séries ao longo da apuração (coletor ou arquivo)
  eventos: [],          // últimas atualizações (coletor ou arquivo)
  arquivo: false,       // histórico e eventos vêm do arquivo da noite, não do coletor
  vivos: null           // pessoas com o painel aberto agora
};

let zoom = null;

// ---------- util ----------

const cargoDef = () => tse.cargoDef(st.cargo);
const codCargo = () => tse.codigoCargo(st.cargo, st.uf);
const nomeCargo = () => tse.nomeCargo(st.cargo, st.uf);
const listaMun = (uf = st.uf) => (st.municipios && st.municipios[uf]) || [];
const munInfo = (cd, uf = st.uf) => listaMun(uf).find((m) => m.cd === cd);
const candInfo = (n) => (st.resumoUF && st.resumoUF.cands.find((c) => c.n === n)) || null;
const partidoDe = (n) => (candInfo(n) || {}).partido || "";
const ehMajoritario = () => !cargoDef().prop;

function jsonLocal(mapa, pasta, uf) {
  if (!mapa.has(uf)) {
    const p = fetch(`dados/${pasta}/${uf}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    mapa.set(uf, p);
  }
  return mapa.get(uf);
}
const hist2022 = (uf) => jsonLocal(st.hist, "2022", uf);
const locais = (uf) => jsonLocal(st.locais, "locais", uf);
function secoesUF(uf) {
  if (!st.secoesUF.has(uf)) {
    const p = tse.secoes(uf);
    p.catch(() => st.secoesUF.delete(uf));
    st.secoesUF.set(uf, p);
  }
  return st.secoesUF.get(uf);
}

function linhaDe(cd, r) {
  const votos = {};
  for (const c of r.cands) votos[c.n] = c.votos;
  const [a, b] = r.cands;
  const lider = a && a.votos > 0 ? a.n : null;
  return {
    cd,
    validos: r.votos.validos,
    total: r.votos.total,
    eleitorado: r.eleitorado,
    eleitoradoApurado: r.eleitoradoApurado,
    abstencao: r.abstencao,
    comparecimento: r.comparecimento,
    secoesPct: r.secoes.pct,
    hora: r.hora,
    votos,
    ordem: r.cands.map((c) => c.n),
    lider,
    margem: lider ? a.pct - (b ? b.pct : 0) : 0,
    segundo: b && b.votos > 0 ? b.n : null,
    liderPartido: a ? a.partido : "",
    vantagem: lider ? a.votos - (b ? b.votos : 0) : 0,
    eleitos: r.cands.filter((c) => /^eleit/i.test(c.situacao) || c.eleito).length,
    segundoTurno: r.cands.some((c) => /turno/i.test(c.situacao))
  };
}

const indiceMun = new Map();
function munInfoGlobal(cd) {
  if (!indiceMun.size && st.municipios) {
    for (const [uf, lista] of Object.entries(st.municipios)) for (const m of lista) indiceMun.set(m.cd, { ...m, uf });
  }
  return indiceMun.get(cd);
}

const porEstado = () => st.uf === "br" && !st.nacionalMun;
// Governador e Senado no Brasil: um mapa de disputas estaduais, sem candidato único
const visaoEstados = () => st.uf === "br" && st.cargo !== "1";
const temVisaoBrasil = (cargo = st.cargo) => cargo === "1" || cargo === "3" || cargo === "5";

// "Benedita da Silva" -> "Benedita", "Carlos Portinho" -> "Portinho"
const SOBRENOMES_COMUNS = new Set(["silva", "santos", "souza", "sousa", "oliveira", "lima", "costa", "pereira", "ferreira", "rodrigues", "alves", "gomes", "junior", "júnior", "filho", "neto"]);
function nomeCurto(nome) {
  const p = String(nome).split(" ").filter(Boolean);
  const ultimo = p[p.length - 1] || "";
  return p.length > 1 && SOBRENOMES_COMUNS.has(ultimo.toLowerCase()) ? p[0] : ultimo;
}

// unidades que aparecem no mapa (o exterior não tem área na visão por estado)
function areasDoMapa() {
  if (!porEstado()) return st.matriz;
  const m = new Map(st.nacional);
  m.delete("zz");
  return m;
}

// linhas no formato do módulo de análise, para o candidato escolhido
function linhasAnalise(n) {
  const fonte = porEstado() ? st.nacional : st.matriz;
  const out = [];
  for (const [cd, l] of fonte) {
    if (!l.validos || (porEstado() && cd === "zz")) continue;
    const info = porEstado() ? { nome: tse.NOME_UF[cd], capital: false } : munInfoGlobal(cd);
    out.push({
      cd,
      nome: info ? info.nome : cd,
      capital: !!(info && info.capital),
      eleitorado: l.eleitorado,
      eleitoradoApurado: l.eleitoradoApurado,
      abstencao: l.abstencao,
      comparecimento: l.comparecimento,
      validos: l.validos,
      votos: l.votos[n] || 0,
      pos: l.ordem.indexOf(n) + 1 || l.ordem.length + 1,
      secoesPct: l.secoesPct
    });
  }
  return out;
}

// ---------- coletor ----------

const doColetor = (cargo = st.cargo) => feed.ativo() && ["1", "3", "5"].includes(cargo);
// matriz por município no feed: a dos majoritários e a dos cargos que o
// coletor anuncia em agora.json (deputados com --municipios 1,3,5,6,7)
const matrizNoFeed = (cargo = st.cargo) => doColetor(cargo) || (feed.ativo() && !!st.agora && (st.agora.municipais || []).includes(cargo));

function resultadoDoFeed(cargo, uf) {
  const c = st.agora && st.agora.corridas[cargo] && st.agora.corridas[cargo][uf];
  const nomes = st.candFeed[`${cargo}-${uf}`];
  return c && nomes ? feed.paraResultado(c, nomes) : null;
}

// linha de município do feed no formato de resultado (com os nomes do estado)
function resultadoDaLinha(l) {
  const base = st.resumoUF ? st.resumoUF.cands : [];
  return feed.paraResultado({ ...l, total: l.validos + l.brancos + l.nulos, situacao: {} }, base.map((c) => ({ ...c, vices: c.vices.map((v) => v.nome) })));
}

async function carregarHistorico() {
  try {
    if (feed.ativo()) {
      const [h, e] = await Promise.all([feed.json("historico.json"), feed.json("eventos.json")]);
      st.historico = h.series;
      st.eventos = e.eventos;
      st.arquivo = false;
      return;
    }
    const [h, e] = await Promise.all(["historico", "eventos"].map((f) => fetch(`dados/arquivo-${tse.TURNO}t/${f}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    if (h) { st.historico = h.series; st.arquivo = true; }
    if (e) st.eventos = e.eventos;
  } catch (_) { /* sem histórico: os blocos não aparecem */ }
}

// ---------- escala de desktop ----------

// Desenhado numa tela lógica de 1600×900; em monitores maiores tudo cresce
// junto com zoom, abaixo disso fica 1:1.
function ajustarEscala() {
  const hud = $("#hud");
  if (celular()) {
    st.escala = 1;
    hud.style.zoom = hud.style.width = hud.style.height = "";
    return;
  }
  const z = Math.min(3, Math.max(1, Math.min(innerWidth / BASE_W, innerHeight / BASE_H)));
  st.escala = z;
  hud.style.zoom = z;
  hud.style.width = innerWidth / z + "px";
  hud.style.height = innerHeight / z + "px";
}

function dims() {
  if (celular()) {
    const r = $("#mapaSvg").getBoundingClientRect();
    const w = Math.max(200, r.width), h = Math.max(200, r.height);
    return { w, h, area: [8, 8, w - 8, h - 8] };
  }
  const hud = $("#hud");
  const w = hud.clientWidth, h = hud.clientHeight;
  const css = getComputedStyle(hud);
  const v = (k) => parseFloat(css.getPropertyValue(k)) || 0;
  const m = v("--m"), gap = v("--gap");
  const x0 = m + v("--col-l") + m, x1 = w - m - v("--col-r") - m;
  const y0 = v("--topo") + 44, y1 = h - m - v("--gaveta") - gap - 8;
  return { w, h, area: [x0, y0, x1, Math.max(y0 + 120, y1)] };
}

// ---------- URL ----------

function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const out = {};
  const cargo = p.get("cargo");
  if (cargo && cargosDisponiveis().some((c) => c.id === cargo)) out.cargo = cargo;
  const uf = (p.get("uf") || "").toLowerCase();
  if (tse.NOME_UF[uf]) out.uf = uf;
  out.mun = /^\d{5}$/.test(p.get("mun") || "") ? p.get("mun") : "";
  out.zona = /^\d{1,4}$/.test(p.get("zona") || "") ? String(Number(p.get("zona"))) : "";
  out.cand = /^\d{1,5}$/.test(p.get("cand") || "") ? p.get("cand") : "";
  return out;
}

function gravarHash() {
  const p = new URLSearchParams({ cargo: st.cargo, uf: st.uf });
  if (st.mun) p.set("mun", st.mun);
  if (st.zona) p.set("zona", st.zona);
  if (st.cand) p.set("cand", st.cand);
  try { history.replaceState(null, "", "#" + p.toString()); } catch (_) { /* moldura sem histórico */ }
}

// PAINEL_CONFIG.cargos limita os cargos de um retrato que não tenha todos
const cargosDisponiveis = () => {
  const so = globalThis.PAINEL_CONFIG && globalThis.PAINEL_CONFIG.cargos;
  return tse.cargosDoTurno().filter((c) => !so || so.includes(c.id));
};

function normalizar() {
  if (!cargosDisponiveis().some((c) => c.id === st.cargo)) st.cargo = "1";
  if (!cargoDef().nacional && st.uf === "zz") st.uf = temVisaoBrasil() ? "br" : "sp";
  if (!temVisaoBrasil() && st.uf === "br") st.uf = "sp";
  if (st.uf === "br") st.mun = "";
  if (!st.mun) st.zona = "";
  if (visaoEstados()) st.cand = "";
}

// ---------- carga do recorte ----------

// muda o recorte e recarrega só o que depende do que mudou
async function mudar(alteracoes) {
  const antes = { cargo: st.cargo, uf: st.uf, mun: st.mun, cand: st.cand };
  Object.assign(st, alteracoes);
  normalizar();
  if (alteracoes.cand) st.modo = "candidato";
  else if (st.modo === "candidato" && !st.cand) st.modo = "lider";
  gravarHash();
  renderFiltros();
  if (antes.cargo !== st.cargo || antes.uf !== st.uf) {
    await carregarBase();
  } else if (antes.mun !== st.mun) {
    await carregarMunicipio();
  } else {
    renderTudo();
    if (antes.cand !== st.cand) prepararCidade();
  }
}

async function carregarBase() {
  st.ctrl.abort();
  st.ctrl = new AbortController();
  const ger = ++st.geracao;
  const { signal } = st.ctrl;
  Object.assign(st, {
    matriz: new Map(), andamento: {}, nacional: new Map(), nacionalR: new Map(), nacionalMun: false,
    cidade: null, resumoUF: null, resumo: null, comp: null, carga: null, linhasFeed: null
  });
  st.tabela.filtro = "";
  $("#tabFiltro").value = "";
  st.tabela.aba = "areas";
  // na visão de estados a tabela abre pelas disputas mais apertadas
  st.tabela.ordem = visaoEstados() ? "margem" : "votos";
  st.tabela.desc = !visaoEstados();
  renderControles();
  renderCarga();
  renderTudo();

  try {
    st.resumoUF = visaoEstados() ? null : (doColetor() && resultadoDoFeed(st.cargo, st.uf)) ||
      tse.lerResultado(await tse.json(tse.url.resultado(st.cargo, st.uf), { signal }));
  } catch (_) {
    if (ger !== st.geracao) return;
  }
  if (ger !== st.geracao) return;
  st.resumo = st.resumoUF;
  $("#live").dataset.st = st.resumoUF || visaoEstados() ? "ok" : "erro";
  renderTudo();

  await desenharMapa(ger);
  if (ger !== st.geracao) return;
  carregarMatriz(ger, signal);
  if (st.mun) carregarMunicipio();
  agendar();
}

async function carregarMunicipio() {
  st.cidade = null;
  st.tabela.aba = st.mun ? "zonas" : "areas";
  if (!st.mun) {
    st.resumo = st.resumoUF;
    marcarAtivo();
    zoom?.reiniciar();
    renderTudo();
    return;
  }
  const ger = st.geracao, mun = st.mun;
  focarMunicipio();
  renderTudo();
  try {
    const l = matrizNoFeed() && st.linhasFeed && st.linhasFeed.get(mun);
    const r = l ? resultadoDaLinha(l) : tse.lerResultado(await tse.json(tse.url.resultado(st.cargo, st.uf, mun), { signal: st.ctrl.signal }));
    if (ger !== st.geracao || mun !== st.mun) return;
    st.resumo = r;
    st.matriz.set(mun, linhaDe(mun, r));
  } catch (_) {
    if (ger !== st.geracao || mun !== st.mun) return;
    st.resumo = null;
  }
  renderTudo();
  await prepararCidade();
  abrirCidade(ger, mun);
}

// matriz de municípios: os arquivos municipais do cargo na UF
async function carregarMatriz(ger, signal, soMudados = false) {
  if (st.uf === "br") {
    await carregarNacional(ger, signal, soMudados);
    return;
  }
  // com coletor, a UF inteira vem num arquivo só
  if (matrizNoFeed() && await matrizDoFeed(ger, st.uf, st.cargo)) return;
  const lista = listaMun();
  if (!lista.length) return;
  let alvo = lista;
  try {
    const and = await tse.andamento(cargoDef().ele, st.uf, { signal });
    if (ger !== st.geracao) return;
    if (soMudados) alvo = lista.filter((m) => !st.matriz.has(m.cd) || !st.andamento[m.cd] || !and[m.cd] || st.andamento[m.cd].hora !== and[m.cd].hora);
    st.andamento = and;
  } catch (_) { /* sem andamento, baixa tudo */ }
  if (!alvo.length) return;
  await baixarMunicipios(ger, signal, alvo.map((m) => ({ uf: st.uf, cd: m.cd, cargo: st.cargo })),
    soMudados ? "Atualizando municípios" : "Carregando municípios", 16);
}

async function matrizDoFeed(ger, uf, cargo) {
  try {
    const d = await feed.json(`uf/${uf}-c${cargo}.json`);
    if (ger !== st.geracao) return true;
    const linhas = feed.linhasDaUf(d);
    if (uf === st.uf) st.linhasFeed = linhas;
    for (const [cd, l] of linhas) st.matriz.set(cd, linhaDe(cd, resultadoDaLinha(l)));
    renderTudo();
    return true;
  } catch (_) {
    return false;
  }
}

async function baixarMunicipios(ger, signal, alvos, rotulo, n) {
  st.carga = { feitos: 0, total: alvos.length, rotulo };
  renderCarga();
  let ultimo = 0, feitos = 0;
  const ler = async ({ uf, cd, cargo }) => {
    const r = tse.lerResultado(await tse.json(tse.url.resultado(cargo, uf, cd), { signal }));
    if (ger !== st.geracao) return;
    st.matriz.set(cd, linhaDe(cd, r));
  };
  let pendentes = alvos;
  // erros de rede ganham mais uma rodada, com menos pedidos em paralelo
  for (const lote of [n, 6]) {
    if (!pendentes.length || ger !== st.geracao) break;
    const r = await tse.fila(pendentes, ler, {
      n: lote, signal,
      progresso: () => {
        if (ger !== st.geracao) return;
        st.carga = { ...st.carga, feitos: Math.min(alvos.length, ++feitos) };
        renderCarga();
        if (Date.now() - ultimo > 800) { ultimo = Date.now(); pintar(); }
      }
    });
    const falhas = pendentes.filter((_, i) => r[i] && r[i].erro && r[i].erro.status !== 404);
    feitos -= falhas.length;
    pendentes = falhas;
  }
  if (ger !== st.geracao) return;
  st.carga = null;
  renderCarga();
  renderTudo();
}

async function carregarNacional(ger, signal, soMudados = false) {
  const cargo = st.cargo;
  const ufs = tse.UFS.map(([cd]) => cd).concat(cargo === "1" ? ["zz"] : []);
  if (doColetor(cargo) && st.agora) {
    for (const uf of ufs) {
      const r = resultadoDoFeed(cargo, uf);
      if (r) { st.nacional.set(uf, linhaDe(uf, r)); st.nacionalR.set(uf, r); }
    }
    renderTudo();
    if (st.nacionalMun) {
      for (const uf of tse.UFS.map(([cd]) => cd)) if (!(await matrizDoFeed(ger, uf, "1"))) break;
    }
    return;
  }
  await tse.fila(ufs, async (uf) => {
    const r = tse.lerResultado(await tse.json(tse.url.resultado(cargo, uf), { signal }));
    if (ger !== st.geracao) return;
    st.nacional.set(uf, linhaDe(uf, r));
    st.nacionalR.set(uf, r);
  }, { n: 14, signal });
  if (ger !== st.geracao) return;
  if (cargo === "1") somarBrasil();
  renderTudo();
  if (st.nacionalMun) await carregarTodosMunicipios(ger, signal, soMudados);
}

// O arquivo nacional do TSE costuma atrasar em relação aos estaduais; quando a
// soma dos estados (e do exterior) é mais recente, ela vira o total do Brasil.
function somarBrasil() {
  if (st.uf !== "br" || !st.resumoUF || st.nacionalR.size < 28) return;
  const partes = [...st.nacionalR.values()];
  const soma = tse.somarResultados(st.resumoUF, partes);
  if (partes.some((r) => tse.geracao(r) > tse.geracao(st.resumoUF))) {
    st.resumoUF = soma;
    if (!st.mun) st.resumo = soma;
  }
}

// visão Brasil por município: os ~5.570 arquivos municipais de Presidente
async function carregarTodosMunicipios(ger, signal, soMudados = false) {
  const alvos = [];
  for (const [uf] of tse.UFS) for (const m of listaMun(uf)) alvos.push({ uf, cd: m.cd, cargo: "1" });
  let lista = alvos;
  if (soMudados) {
    const mudou = new Set();
    await tse.fila(tse.UFS.map(([uf]) => uf), async (uf) => {
      const and = await tse.andamento(tse.FEDERAL, uf, { signal });
      for (const [cd, a] of Object.entries(and)) {
        if (!st.andamento[cd] || st.andamento[cd].hora !== a.hora) mudou.add(cd);
        st.andamento[cd] = a;
      }
    }, { n: 8, signal });
    lista = alvos.filter((a) => mudou.has(a.cd));
  }
  if (!lista.length) return;
  await baixarMunicipios(ger, signal, lista, "Carregando municípios do Brasil", 24);
}

// ---------- cidade: boletins de urna ----------

async function abrirCidade(ger, mun) {
  // com coletor, as zonas já vêm somadas (inclusive de cidades grandes)
  if (feed.ativo() && await zonasDoFeed(ger, mun)) return;
  if (estatico()) {
    st.cidade = { cd: mun, erro: "Neste retrato da noite, zonas e locais de votação estão disponíveis para as 27 capitais." };
    renderTudo();
    return;
  }
  let zonas;
  try {
    zonas = (await secoesUF(st.uf))[mun];
  } catch (_) {
    zonas = null;
  }
  if (ger !== st.geracao || mun !== st.mun) return;
  if (!zonas) {
    st.cidade = { cd: mun, erro: "Não foi possível ler a lista de seções do TSE." };
    renderTudo();
    return;
  }
  const total = zonas.reduce((s, z) => s + z.secoes.length, 0);
  if (total > LIMITE_SECOES) {
    st.cidade = { cd: mun, grande: true, total, zonas };
    renderTudo();
    return;
  }
  st.cidade = { cd: mun, cache: new Map(), res: null, total, zonas, carga: { feitos: 0, total } };
  renderTudo();
  await apurarSecoes(ger, mun);
}

async function zonasDoFeed(ger, mun) {
  try {
    const d = await feed.json(`zonas/${st.uf}-${mun}.json`);
    // cada cargo de deputado vem no seu arquivo
    const cod = codCargo();
    if (!d.cargos[cod] && (d.proporcionais || []).includes(cod)) {
      const p = await feed.json(`zonas/${st.uf}-${mun}-c${cod}.json`);
      d.cargos[cod] = { zonas: p.zonas, locais: p.locais };
    }
    if (ger !== st.geracao || mun !== st.mun) return true;
    const enquadrada = st.cidade && st.cidade.cd === mun ? st.cidade.enquadrada : null;
    st.cidade = { cd: mun, feedZonas: d, enquadrada, res: { lidas: d.lidas, recebidas: d.recebidas, total: d.total, aguardando: d.aguardando } };
    st.proximaCidade = Date.now() + 60e3;
    renderTudo();
    return true;
  } catch (_) {
    return false;
  }
}

// zonas, locais ou seções da cidade aberta, vindos do coletor ou dos boletins,
// com os nulos técnicos já fora dos válidos (como o TSE conta)
const memoGrupos = new WeakMap();
function gruposCidade(por) {
  const c = st.cidade;
  if (!c || !c.res) return [];
  const chave = `${codCargo()}|${por}|${c.res.secoes ? c.res.secoes.length : ""}`;
  let memo = memoGrupos.get(c.res);
  if (!memo || memo.r !== st.resumoUF) memoGrupos.set(c.res, memo = { r: st.resumoUF, grupos: new Map() });
  if (memo.grupos.has(chave)) return memo.grupos.get(chave);
  let grupos;
  if (c.feedZonas) {
    const g = c.feedZonas.cargos[codCargo()];
    grupos = !g ? [] : (por === "local" ? g.locais : g.zonas).map((x) => ({
      ...x, zona: String(x.zona), local: String(x.local),
      chave: por === "local" ? `${x.zona}/${x.local}` : String(x.zona)
    }));
  } else {
    grupos = agrupar(c.res.secoes, codCargo(), por);
  }
  if (st.resumoUF) grupos = nulosTecnicos(grupos, numerosValidos(st.resumoUF));
  memo.grupos.set(chave, grupos);
  return grupos;
}

// números que o TSE conta como válidos: os candidatos e, nos cargos
// proporcionais, a legenda (L<partido>) de cada partido com candidatos
const memoNumeros = new WeakMap();
function numerosValidos(r) {
  let s = memoNumeros.get(r);
  if (!s) {
    s = new Set(r.cands.map((c) => c.n));
    if (!ehMajoritario()) for (const c of r.cands) if (c.npartido) s.add(`L${c.npartido}`);
    memoNumeros.set(r, s);
  }
  return s;
}

async function apurarSecoes(ger, mun) {
  const c = st.cidade;
  if (!c || c.cd !== mun || !c.cache) return;
  const res = await apurarCidade(st.uf, mun, c.zonas, {
    cache: c.cache,
    signal: st.ctrl.signal,
    progresso: (f, t) => {
      if (ger !== st.geracao || st.cidade !== c) return;
      c.carga = { feitos: f, total: t };
      renderCargaCidade();
    }
  });
  if (ger !== st.geracao || st.cidade !== c) return;
  c.res = res;
  c.carga = null;
  st.proximaCidade = Date.now() + REFRESH_CIDADE_S * 1000;
  renderTudo();
}

// dados de apoio da cidade: locais de votação e zonas de 2022
async function prepararCidade() {
  if (!st.mun) {
    st.locaisCidade = st.zonas2022 = st.refN = null;
    return;
  }
  const mun = st.mun, uf = st.uf;
  const [loc, hist] = await Promise.all([locais(uf), hist2022(uf)]);
  if (mun !== st.mun || uf !== st.uf) return;
  st.locaisCidade = loc ? loc[mun] || {} : {};
  const base = ["1", "3", "5"].includes(st.cargo) ? municipios2022(hist, st.cargo, `t${tse.TURNO}`) : null;
  const n = alvoN();
  const c = n && candInfo(n);
  const ref = c && base ? referencia2022(c, base) : null;
  st.refN = ref ? ref.n : null;
  st.zonas2022 = base && base.mun[mun] ? base.mun[mun].zonas : {};
  renderTabela();
  pintarLocais();
}

// candidato de referência para tabela, tooltips e locais: o escolhido ou o líder do recorte (zona, cidade ou estado)
const alvoN = () => {
  if (st.cand) return st.cand;
  const rr = resultadoRecorte();
  const lider = (rr && rr.cands[0]) || (st.resumoUF && st.resumoUF.cands[0]);
  return lider ? lider.n : "";
};

// ---------- mapa ----------

async function desenharMapa(ger) {
  const svg = $("#mapaSvg");
  const area = $("#gArea"), pontos = $("#gLocais"), rotulos = $("#gRotulos");
  area.innerHTML = pontos.innerHTML = rotulos.innerHTML = $("#gCelulas").innerHTML = $("#gZonas").innerHTML = "";
  st.geo = null;
  const vazio = $("#mapaVazio");
  vazio.hidden = true;
  const d = dims();
  svg.setAttribute("viewBox", `0 0 ${d.w} ${d.h}`);
  const mostrarVazio = (txt) => {
    vazio.hidden = false;
    vazio.textContent = txt;
    vazio.style.left = (d.area[0] + d.area[2]) / 2 + "px";
    vazio.style.top = (d.area[1] + d.area[3]) / 2 + "px";
  };
  if (st.uf === "zz") {
    mostrarVazio("Os votos do exterior não têm malha no mapa. A tabela abaixo traz as cidades.");
    return;
  }
  let feicoes;
  try {
    feicoes = st.uf === "br" ? await malha(st.nacionalMun ? "municipios-br" : "estados")
      : await malha("uf", tse.UFS.find(([cd]) => cd === st.uf)[2]);
  } catch (_) {
    if (ger === st.geracao) mostrarVazio("Não foi possível carregar o mapa do IBGE.");
    return;
  }
  if (ger !== st.geracao) return;
  const estados = porEstado();
  const caixa = estados ? [d.area[0], d.area[1], d.area[2] - 96, d.area[3]] : d.area;
  const proj = projetar(feicoes, caixa);
  const ibgeParaArea = new Map();
  if (estados) {
    for (const [cd, , ibge] of tse.UFS) ibgeParaArea.set(ibge, cd);
  } else {
    const ufs = st.uf === "br" ? tse.UFS.map(([cd]) => cd) : [st.uf];
    for (const uf of ufs) for (const m of listaMun(uf)) ibgeParaArea.set(m.ibge, m.cd);
  }
  area.classList.toggle("estados", estados);
  area.innerHTML = proj.feicoes.map((f) => `<path data-area="${ibgeParaArea.get(f.id) || ""}" d="${f.d}"></path>`).join("");
  const porArea = new Map();
  area.querySelectorAll("path").forEach((p, i) => {
    porArea.set(p.dataset.area, { el: p, caixa: proj.feicoes[i].caixa, centro: proj.feicoes[i].centro });
  });
  if (st.uf === "br" && st.nacionalMun) {
    const ests = projetar(await malha("estados"), d.area);
    area.insertAdjacentHTML("beforeend", `<g class="contornos">${ests.feicoes.map((f) => `<path d="${f.d}"></path>`).join("")}</g>`);
  }
  let lado = -Infinity;
  for (const f of proj.feicoes) lado = Math.max(lado, f.caixa[2]);
  st.geo = { proj, porArea, estados, ladoDireito: lado };
  if (st.cidade) st.cidade.enquadrada = null;
  zoom.reiniciar();
  pintar();
  if (st.mun) focarMunicipio();
}

function marcarAtivo() {
  if (!st.geo) return;
  st.geo.porArea.forEach((x, id) => x.el.classList.toggle("ativo", id === st.mun));
  $("#gArea").classList.toggle("foco", !!st.mun);
}

function focarMunicipio() {
  if (!st.geo || !st.mun) return;
  marcarAtivo();
  const a = st.geo.porArea.get(st.mun);
  if (a) zoom.focar(a.caixa, 1.35);
}

function dadosArea(id) {
  if (!st.geo) return null;
  return st.geo.estados ? st.nacional.get(id) : st.matriz.get(id);
}

function corArea(d, n, q) {
  if (!d || !d.validos) return d ? AGUARDANDO : TERRA;
  if (st.modo === "apurado") return corApurado(d.secoesPct);
  if (st.modo === "vantagem") return TERRA;
  if (n) return rampaCandidato(partidoDe(n))[classeCandidato((d.votos[n] || 0) / d.validos * 100, q)];
  if (!d.lider) return AGUARDANDO;
  const sg = d.liderPartido || partidoDe(d.lider);
  if (visaoEstados()) {
    const tons = rampaMargem(sg);
    return d.eleitos ? tons[3] : d.segundoTurno ? tons[2] : tons[d.margem < 10 ? 0 : 1];
  }
  return corMargem(sg, d.margem);
}

// modo Apurado: cinzas do escuro ao claro conforme as seções totalizadas
const TONS_APURADO = ["#3A3936", "#52514E", "#6C6B68", "#868683", "#A7A6A4"];
const corApurado = (pct) => TONS_APURADO[pct >= 100 ? 4 : pct >= 75 ? 3 : pct >= 50 ? 2 : pct >= 25 ? 1 : 0];

function pintar() {
  if (!st.geo) return;
  const n = st.modo === "candidato" ? st.cand : "";
  const c = n && candInfo(n);
  const q = c ? quebrasCandidato(c.pct) : [];
  st.geo.porArea.forEach((a, id) => { a.el.style.fill = corArea(dadosArea(id), n, q); });
  st.quebras = q;
  renderPicos();
  renderRotulos();
  renderLegenda();
  pintarLocais();
}

// rótulos de UF com o percentual na visão por estado; os estados pequenos do
// litoral ganham caixas numa coluna à direita, ligadas por uma linha
const LATERAIS = ["rn", "pb", "pe", "al", "se", "es", "rj"];
function tinta(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0F0E0D" : "#FAFAF9";
}
function renderRotulos() {
  const g = $("#gRotulos");
  if (!st.geo || !st.geo.estados) { g.innerHTML = ""; return; }
  const n = st.modo === "candidato" ? st.cand : "";
  const c = n && candInfo(n);
  const q = c ? quebrasCandidato(c.pct) : [];
  const html = [], caixas = [];
  st.geo.porArea.forEach((a, uf) => {
    const d = st.nacional.get(uf);
    if (!d || !d.validos) return;
    const alvo = n || d.lider;
    const pct = Math.round(alvo ? (d.votos[alvo] || 0) / d.validos * 100 : 0);
    const [x, y] = a.centro;
    const lateral = LATERAIS.includes(uf);
    if (lateral) caixas.push({ uf, x, y, pct, cor: corArea(d, n, q) });
    html.push(`<text class="${lateral ? "rot-lateral" : ""}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${uf.toUpperCase()}<tspan class="v" x="${x.toFixed(1)}" dy="13">${pct}%</tspan></text>`);
  });
  // empilha as caixas pela latitude, sem sobreposição
  const x0 = st.geo.ladoDireito + 26;
  caixas.sort((a, b) => a.y - b.y);
  let ultimo = -Infinity;
  for (const k of caixas) {
    k.by = Math.max(k.y - 12, ultimo + 29);
    ultimo = k.by;
  }
  for (const k of caixas) {
    html.push(`<g class="caixa-uf" data-area="${k.uf}"><path d="M${k.x.toFixed(1)} ${k.y.toFixed(1)}L${(x0 - 8).toFixed(1)} ${(k.by + 12).toFixed(1)}H${x0}"></path>
      <rect x="${x0}" y="${k.by.toFixed(1)}" width="70" height="24" rx="4" style="fill:${k.cor}"></rect>
      <text x="${x0 + 10}" y="${(k.by + 16).toFixed(1)}" style="fill:${tinta(k.cor)}">${k.uf.toUpperCase()}<tspan class="v" dx="8">${k.pct}%</tspan></text></g>`);
  }
  g.innerHTML = html.join("");
  reescalar(zoom ? zoom.escala() : 1);
}

// Locais de votação da cidade aberta: cada local ganha a área aproximada dos
// eleitores mais próximos dele (Voronoi recortado pelo contorno do município),
// pintada pelo resultado daquele local, e um ponto proporcional aos votos.
// modo Vantagem: um pico em cada área, da altura da vantagem do líder em votos
// (raiz da vantagem, para as capitais não esmagarem o resto); metade esquerda
// na cor do partido, a direita um pouco mais clara
function renderPicos() {
  const g = $("#gPicos");
  if (!st.geo || st.modo !== "vantagem") { g.innerHTML = ""; return; }
  const itens = [];
  let max = 1;
  st.geo.porArea.forEach((a, id) => {
    const d = dadosArea(id);
    if (!d || !d.lider || !d.vantagem) return;
    max = Math.max(max, d.vantagem);
    itens.push({ x: a.centro[0], y: a.centro[1], v: d.vantagem, sg: d.liderPartido || partidoDe(d.lider) });
  });
  itens.sort((a, b) => a.y - b.y);
  const hmax = st.geo.estados ? 90 : 60;
  g.innerHTML = itens.map((it) => {
    const h = hmax * Math.min(1.25, Math.sqrt(it.v / max));
    const cor = corPartido(it.sg);
    return `<g class="pico" data-x="${it.x.toFixed(1)}" data-y="${it.y.toFixed(1)}" data-h="${h.toFixed(1)}"><path style="fill:${cor}"></path><path style="fill:${misturar(cor, "#FAFAF9", 0.2)}"></path></g>`;
  }).join("");
  desenharPicos(zoom ? zoom.escala() : 1);
}

function desenharPicos(escala) {
  const w = (st.geo && st.geo.estados ? 3.4 : 2.3) / escala;
  document.querySelectorAll("#gPicos .pico").forEach((g) => {
    const x = +g.dataset.x, y = +g.dataset.y, h = +g.dataset.h / escala;
    const [esq, dir] = g.children;
    esq.setAttribute("d", `M${(x - w).toFixed(2)} ${y.toFixed(2)}L${x.toFixed(2)} ${(y - h).toFixed(2)}L${x.toFixed(2)} ${y.toFixed(2)}Z`);
    dir.setAttribute("d", `M${x.toFixed(2)} ${(y - h).toFixed(2)}L${(x + w).toFixed(2)} ${y.toFixed(2)}L${x.toFixed(2)} ${y.toFixed(2)}Z`);
  });
}

function pintarLocais() {
  const g = $("#gLocais"), gc = $("#gCelulas"), gz = $("#gZonas");
  const c = st.cidade;
  const loc = st.locaisCidade;
  const area = st.geo && st.mun && st.geo.porArea.get(st.mun);
  if (!st.geo || !c || !c.res || !loc || !area) {
    g.innerHTML = gc.innerHTML = gz.innerHTML = "";
    $("#gArea").classList.remove("com-locais");
    return;
  }
  const grupos = gruposCidade("local");
  const n = st.modo === "candidato" ? st.cand : "";
  const cand = n && candInfo(n);
  const noRecorte = n && st.resumo ? st.resumo.cands.find((x) => x.n === n) : null;
  const q = cand ? quebrasCandidato(noRecorte ? noRecorte.pct : cand.pct) : [];
  const esc0 = zoom ? zoom.escala() : 1;

  const itens = [];
  for (const gr of grupos) {
    const info = loc[gr.zona] && loc[gr.zona][gr.local];
    if (!info || info[3] == null || info[4] == null) continue;
    const [x, y] = st.geo.proj.projetar(info[4], info[3]);
    let cor;
    if (n) {
      cor = rampaCandidato(cand.partido)[classeCandidato(gr.validos ? (gr.votos[n] || 0) / gr.validos * 100 : 0, q)];
    } else {
      const nominais = Object.entries(gr.votos).filter(([k]) => /^\d+$/.test(k)).sort((a, b) => b[1] - a[1]);
      const [l1, l2] = nominais;
      const margem = l1 && gr.validos ? (l1[1] - (l2 ? l2[1] : 0)) / gr.validos * 100 : 0;
      cor = l1 ? corMargem(partidoDe(l1[0]), margem) : AGUARDANDO;
    }
    itens.push({ gr, x, y, cor, valor: n ? (gr.votos[n] || 0) : gr.comparecimento });
  }
  if (!itens.length) {
    g.innerHTML = gc.innerHTML = gz.innerHTML = "";
    return;
  }

  // áreas aproximadas
  const [x0, y0, x1, y1] = area.caixa;
  const folga = Math.max(x1 - x0, y1 - y0) * 0.05 + 1;
  const vor = Delaunay.from(itens, (i) => i.x, (i) => i.y).voronoi([x0 - folga, y0 - folga, x1 + folga, y1 + folga]);
  const celulas = itens.map((it, i) => {
    const pol = vor.cellPolygon(i);
    if (!pol) return "";
    const apagado = st.zona && it.gr.zona !== st.zona ? " apagado" : "";
    return `<path class="celula${apagado}" data-local="${it.gr.chave}" d="M${pol.map(([px, py]) => px.toFixed(2) + " " + py.toFixed(2)).join("L")}Z" style="fill:${it.cor};stroke:${it.cor}"></path>`;
  }).join("");
  gc.innerHTML = `<clipPath id="recorteCidade"><path d="${area.el.getAttribute("d")}"></path></clipPath><g clip-path="url(#recorteCidade)">${celulas}</g>`;

  // pontos, maiores primeiro para os menores ficarem por cima
  const max = Math.max(1, ...itens.map((i) => i.valor));
  const pontos = itens.slice().sort((a, b) => b.valor - a.valor).map((it) => {
    const r = 1.6 + 6.5 * Math.sqrt(it.valor / max);
    const apagado = st.zona && it.gr.zona !== st.zona ? " apagado" : "";
    return `<circle class="local${apagado}" data-local="${it.gr.chave}" cx="${it.x.toFixed(2)}" cy="${it.y.toFixed(2)}" r="${(r / esc0).toFixed(3)}" data-r="${r.toFixed(2)}"></circle>`;
  });
  g.innerHTML = pontos.join("");

  // número de cada zona no centro de massa dos seus locais
  const porZona = new Map();
  for (const it of itens) {
    const z = porZona.get(it.gr.zona) || { x: 0, y: 0, p: 0 };
    const p = it.gr.comparecimento || 1;
    z.x += it.x * p; z.y += it.y * p; z.p += p;
    porZona.set(it.gr.zona, z);
  }
  gz.innerHTML = porZona.size > 1 ? [...porZona.entries()].map(([z, v]) =>
    `<text class="${st.zona && st.zona !== z ? "apagado" : ""}" x="${(v.x / v.p).toFixed(2)}" y="${(v.y / v.p).toFixed(2)}" text-anchor="middle" data-r="1">${z}</text>`).join("") : "";

  $("#gArea").classList.add("com-locais");
  if (c.enquadrada !== c.cd) {
    c.enquadrada = c.cd;
    zoom.focar(caixaNucleo(itens.map((i) => ({ x: i.x, y: i.y, peso: i.gr.comparecimento }))), 1.5);
  }
  reescalar(zoom ? zoom.escala() : 1);
}

// caixa dos locais que somam 85% dos votantes, mais perto do centro de massa:
// enquadra a mancha urbana sem deixar que um distrito rural distante encolha tudo
function caixaNucleo(pts) {
  const total = pts.reduce((s, p) => s + p.peso, 0) || 1;
  const cx = pts.reduce((s, p) => s + p.x * p.peso, 0) / total;
  const cy = pts.reduce((s, p) => s + p.y * p.peso, 0) / total;
  const perto = pts.slice().sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  let acum = 0;
  const nucleo = [];
  for (const p of perto) {
    nucleo.push(p);
    acum += p.peso;
    if (acum >= total * 0.85) break;
  }
  const xs = nucleo.map((p) => p.x), ys = nucleo.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function reescalar(escala) {
  desenharPicos(escala);
  document.querySelectorAll("#gLocais circle").forEach((c) => c.setAttribute("r", (Number(c.dataset.r) / escala).toFixed(3)));
  document.querySelectorAll("#gZonas text").forEach((t) => { t.style.fontSize = 12 / escala + "px"; t.style.strokeWidth = 3 / escala + "px"; });
  const g = $("#gRotulos");
  g.classList.toggle("perto", escala > 1.15);
  g.querySelectorAll(":scope > text").forEach((t) => {
    t.style.fontSize = 12 / escala + "px";
    t.style.strokeWidth = 3 / escala + "px";
    const v = t.querySelector("tspan");
    if (v) { v.style.fontSize = 11 / escala + "px"; v.setAttribute("dy", (13 / escala).toFixed(2)); }
  });
}

function renderLegenda() {
  const el = $("#legenda");
  if (!st.geo || (!st.resumoUF && !visaoEstados())) { el.innerHTML = ""; return; }
  const unidade = st.geo.estados ? "estados" : "municípios";
  const fonte = areasDoMapa();
  if (st.modo === "apurado") {
    let completos = 0;
    fonte.forEach((d) => { if (d.secoesPct >= 100) completos++; });
    el.innerHTML = `<div class="leg-linha"><b>${fmt.format(completos)}</b> de ${fmt.format(st.geo.porArea.size)} ${unidade} apurados</div>
      <div class="leg-rampa"><span>&lt; 25%</span><span class="rampa">${TONS_APURADO.map((c) => `<i style="background:${c}"></i>`).join("")}</span><span>100%</span></div>`;
    return;
  }
  if (st.modo === "vantagem" || visaoEstados()) {
    const soma = new Map();
    fonte.forEach((d) => {
      if (!d.lider) return;
      const sg = d.liderPartido || partidoDe(d.lider);
      const x = soma.get(sg) || { n: 0, v: 0 };
      x.n++; x.v += d.vantagem || 0;
      soma.set(sg, x);
    });
    const tops = [...soma.entries()].sort((a, b) => (st.modo === "vantagem" ? b[1].v - a[1].v : b[1].n - a[1].n)).slice(0, 4);
    if (st.modo === "vantagem") {
      el.innerHTML = `<div class="leg-linha">${tops.map(([sg, x]) => `<span style="--c:${corPartido(sg)}"><i></i>${esc(sg)} <b>+${esc(grande(x.v))}</b></span>`).join("")}</div>
        <div class="leg-rampa"><span>pico = votos de vantagem do líder</span></div>`;
    } else {
      el.innerHTML = `<div class="leg-linha">${tops.map(([sg, x]) => `<span style="--c:${corPartido(sg)}"><i></i>${esc(sg)} <b>${x.n}</b></span>`).join("")}<span>estados</span></div>
        <div class="leg-rampa"><span>claro: apurando · forte: definido</span></div>`;
    }
    return;
  }
  if (st.modo === "candidato" && st.cand) {
    const c = candInfo(st.cand);
    if (!c) { el.innerHTML = ""; return; }
    const q = st.quebras;
    let frente = 0;
    fonte.forEach((d) => { if (d.lider === c.n) frente++; });
    el.innerHTML = `<div class="leg-linha">À frente em <b>${fmt.format(frente)}</b> ${unidade}</div>
      <div class="leg-rampa"><span>&lt; ${pctTxt(q[0], 0)}</span><span class="rampa">${rampaCandidato(c.partido).map((cor) => `<i style="background:${cor}"></i>`).join("")}</span><span>≥ ${pctTxt(q[q.length - 1], 0)}</span></div>`;
    return;
  }
  const contagem = new Map();
  fonte.forEach((d) => { if (d.lider) contagem.set(d.lider, (contagem.get(d.lider) || 0) + 1); });
  const tops = [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const lider = tops[0] ? partidoDe(tops[0][0]) : (st.resumoUF.cands[0] || {}).partido;
  // com dois candidatos do mesmo partido (Senado, Deputados) a sigla não basta
  const siglas = tops.map(([n]) => partidoDe(n));
  const repetida = new Set(siglas).size < siglas.length;
  el.innerHTML = `<div class="leg-linha">${tops.map(([n, k]) => {
      const sg = partidoDe(n);
      const rot = repetida ? nomeCurto((candInfo(n) || { nome: n }).nome) : sg;
      return `<span style="--c:${corPartido(sg)}"><i></i>${esc(rot)} <b>${fmt.format(k)}</b></span>`;
    }).join("")}<span>${unidade}</span></div>
    <div class="leg-rampa"><span class="rampa">${rampaMargem(lider).map((cor) => `<i style="background:${cor}"></i>`).join("")}</span><span>até 10 · 25 · 45 · mais pontos</span></div>`;
}

// ---------- visão de estados (Governador e Senado no Brasil) ----------

function placarEstados() {
  const rs = [...st.nacionalR.entries()].filter(([uf]) => uf !== "zz");
  let total = 0, totalizadas = 0, eleitos = 0, segundo = 0, apurando = 0, vagas = 0;
  const disputas = rs.map(([uf, r]) => {
    total += r.secoes.total;
    totalizadas += r.secoes.totalizadas;
    vagas += r.vagas || 1;
    const el = r.cands.filter((c) => /^eleit/i.test(c.situacao) || c.eleito);
    const t2 = r.cands.some((c) => /turno/i.test(c.situacao));
    eleitos += el.length;
    if (t2) segundo++;
    else if (el.length < (r.vagas || 1)) apurando++;
    const [a, b] = r.cands;
    return { uf, r, a, b, margem: a && b ? a.pct - b.pct : 100, eleitos: el, t2 };
  });
  return { disputas, total, totalizadas, pct: total ? totalizadas / total * 100 : 0, eleitos, segundo, apurando, vagas };
}

function situacaoTexto(d) {
  if (d.t2) return "2º turno";
  if (d.eleitos.length) return d.eleitos.length > 1 ? "eleitos" : "eleito";
  return `${d.r.secoes.pct >= 100 ? "100" : Math.floor(d.r.secoes.pct)}% apurado`;
}

function renderHeroEstados() {
  const p = placarEstados();
  const senado = st.cargo === "5";
  const frase = !p.disputas.length ? "Carregando as disputas dos estados…"
    : senado ? `<b>${fmt.format(p.eleitos)}</b> de ${fmt.format(p.vagas)} vagas no Senado já definidas`
    : `<b>${fmt.format(p.eleitos)}</b> ${p.eleitos === 1 ? "governador eleito" : "governadores eleitos"}${p.segundo ? `, ${fmt.format(p.segundo)} ${p.segundo === 1 ? "disputa vai" : "disputas vão"} ao 2º turno` : ""}`;
  const tiles = tse.UFS.map(([uf]) => {
    const d = st.nacional.get(uf);
    const cor = d ? corArea(d, "", []) : AGUARDANDO;
    return `<button type="button" class="tile" data-ir-area="${uf}" style="background:${cor};color:${tinta(cor)}" title="${esc(tse.NOME_UF[uf])}">${uf.toUpperCase()}</button>`;
  }).join("");
  definir($("#hero"), `
    <div class="kicker">${esc(nomeCargo())} · Brasil · ${pctTxt(Math.floor(p.pct * 10) / 10)} das seções</div>
    <p class="sent">${frase}</p>
    <div class="faixa-uf">${tiles}</div>
    <div class="kv">
      <div><span>Eleitos</span>${fmt.format(p.eleitos)}</div>
      ${tse.TURNO === 1 ? `<div><span>Vão ao 2º turno</span>${fmt.format(p.segundo)} ${p.segundo === 1 ? "estado" : "estados"}</div>` : ""}
      <div><span>Em apuração</span>${fmt.format(p.apurando)} ${p.apurando === 1 ? "estado" : "estados"}</div>
    </div>`);
}

function renderDisputas() {
  const p = placarEstados();
  $("#candRecorte").textContent = "das mais apertadas";
  const termo = semAcento($("#candFiltro").value.trim());
  const lista = p.disputas
    .filter((d) => !termo || semAcento(tse.NOME_UF[d.uf]).includes(termo) || (d.a && semAcento(d.a.nome).includes(termo)))
    .sort((x, y) => (x.eleitos.length > 0) - (y.eleitos.length > 0) || x.margem - y.margem);
  definir($("#candLista"), lista.map((d) => `
    <li><button type="button" class="crow disputa" data-ir-area="${d.uf}" style="--c:${corPartido(d.a ? d.a.partido : "")}">
      <span class="uft" style="background:${corArea(st.nacional.get(d.uf), "", [])};color:${tinta(corArea(st.nacional.get(d.uf), "", []))}">${d.uf.toUpperCase()}</span>
      <span class="txt"><span class="nm">${esc(d.a ? d.a.nome : "—")}</span><span class="pm" style="--c:${corTexto(d.a ? d.a.partido : "")}">${esc(d.a ? `${d.a.partido} · ${pctTxt(d.a.pct)}` : "")}${d.b ? ` · ${esc(d.b.nome)} ${pctTxt(d.b.pct)}` : ""}</span></span>
      <span class="val">${esc(situacaoTexto(d))}<small>${d.b ? `vantagem ${d.margem.toFixed(1).replace(".", ",")} pts` : ""}</small></span>
    </button></li>`).join("") || `<li class="vazio">Carregando…</li>`);
}

function renderPanoramaEstados() {
  const p = placarEstados();
  const porPartido = new Map();
  for (const d of p.disputas) {
    if (!d.a) continue;
    const k = d.a.partido;
    const x = porPartido.get(k) || { lidera: 0, eleitos: 0 };
    x.lidera++;
    x.eleitos += d.eleitos.length;
    porPartido.set(k, x);
  }
  const partidos = [...porPartido.entries()].sort((a, b) => b[1].eleitos - a[1].eleitos || b[1].lidera - a[1].lidera).slice(0, 8);
  const apertadas = p.disputas.filter((d) => !d.eleitos.length && d.b).sort((a, b) => a.margem - b.margem).slice(0, 6);
  return `
    <div class="hd"><h3>Panorama</h3><span class="aside">${esc(nomeCargo())} · Brasil</span></div>
    <div class="kpis">
      ${kpi("Eleitos", fmt.format(p.eleitos), st.cargo === "5" ? `de ${fmt.format(p.vagas)} vagas` : "de 27 estados", true)}
      ${kpi(tse.TURNO === 1 ? "2º turno" : "Em disputa", fmt.format(tse.TURNO === 1 ? p.segundo : p.apurando), "estados", true)}
      ${kpi("Em apuração", fmt.format(p.apurando), "estados")}
      ${kpi("Seções", pctTxt(Math.floor(p.pct * 10) / 10), `${fmt.format(p.totalizadas)} de ${fmt.format(p.total)}`)}
    </div>
    ${partidos.length ? `<section class="sec"><div class="hd"><h3>Por partido</h3><span class="aside">lidera · eleitos</span></div>
      ${partidos.map(([sg, x]) => `<div class="krow estatico"><span><span class="nm" style="color:${corTexto(sg)}">${esc(sg)}</span><span class="sub">à frente em ${x.lidera} ${x.lidera === 1 ? "estado" : "estados"}</span></span><span class="kv" style="--c:${corTexto(sg)}">${x.eleitos}<small>${x.eleitos === 1 ? "eleito" : "eleitos"}</small></span></div>`).join("")}</section>` : ""}
    ${apertadas.length ? `<section class="sec"><div class="hd"><h3>Disputas mais apertadas</h3><span class="aside">sem eleito ainda</span></div>
      ${ranking(apertadas.map((d) => ({ cd: d.uf, nome: tse.NOME_UF[d.uf], d })), (l) => `${l.d.margem.toFixed(1).replace(".", ",")} pts`, (l) => `${l.d.a.nome} ${pctTxt(l.d.a.pct)} × ${l.d.b.nome} ${pctTxt(l.d.b.pct)}`, "var(--fg)")}</section>` : ""}
    ${listaEventos()}
    <section class="sec"><p class="nota">Clique num estado no mapa, na faixa ou na lista para abrir a disputa, com a votação por município e a leitura de cada candidato.</p></section>`;
}

// ---------- render ----------

function renderTudo() {
  renderCabecalho();
  renderHero();
  renderCandidatos();
  renderDossie();
  renderTabela();
  renderCargaCidade();
  pintar();
}

function renderControles() {
  $("#cargos").innerHTML = cargosDisponiveis().map((c) =>
    `<button type="button" data-cargo="${c.id}" aria-pressed="${c.id === st.cargo}">${esc(c.id === "7" && st.uf === "df" ? "Dep. Distrital" : c.curto)}</button>`
  ).join("");
  const nacional = cargoDef().nacional;
  $("#uf").innerHTML = (nacional ? `<option value="br">Brasil</option>` : temVisaoBrasil() ? `<option value="br">Brasil · todos os estados</option>` : "") +
    tse.UFS.map(([cd, nm]) => `<option value="${cd}">${esc(nm)}</option>`).join("") +
    (nacional ? `<option value="zz">Exterior</option>` : "");
  $("#uf").value = st.uf;
  $("#listaCidades").innerHTML = listaMun().map((m) => `<option value="${esc(m.nome)}"></option>`).join("");
  renderFiltros();
}

function renderFiltros() {
  $("#uf").value = st.uf;
  const m = st.mun && munInfo(st.mun);
  const cidade = $("#cidade");
  if (document.activeElement !== cidade) cidade.value = m ? m.nome : "";
  cidade.disabled = st.uf === "br" || !listaMun().length;
  cidade.placeholder = st.uf === "br" ? "Escolha um estado" : st.uf === "zz" ? "Cidade no exterior" : "Todas as cidades";
  const zonas = m ? m.zonas : [];
  $("#zona").innerHTML = `<option value="">${m ? "Todas as zonas" : "—"}</option>` + zonas.map((z) => `<option value="${z}">Zona ${z}</option>`).join("");
  $("#zona").value = st.zona;
  $("#zona").disabled = !m;
}

function nomeRecorte() {
  const partes = [tse.NOME_UF[st.uf] || st.uf.toUpperCase()];
  const m = st.mun && munInfo(st.mun);
  if (m) partes.push(m.nome);
  if (st.zona) partes.push(`Zona ${st.zona}`);
  return partes;
}

function renderCabecalho() {
  const partes = nomeRecorte();
  const alvos = ["uf", "mun", "zona"];
  $("#trilha").innerHTML = partes.map((p, i) => i === partes.length - 1
    ? `<span class="atual">${esc(p)}</span>`
    : `<button type="button" data-ir="${alvos[i]}">${esc(p)}</button>`).join('<span class="sep">›</span>');
  const r = visaoEstados() ? (() => { const p = placarEstados(); return p.total ? { secoes: { pct: p.pct, totalizadas: p.totalizadas, total: p.total }, hora: "" } : null; })() : st.resumo;
  $("#andamentoPct").textContent = r ? pctTxt(Math.floor(r.secoes.pct * 10) / 10) : "—";
  $("#andamentoBarra").style.width = r ? Math.min(100, r.secoes.pct) + "%" : "0";
  $("#andamentoTxt").textContent = r ? `${fmt.format(r.secoes.totalizadas)} de ${fmt.format(r.secoes.total)} seções${r.hora ? ` · totalizado às ${r.hora}` : ""}` : "";
  $("#modoMapa").querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.modo === st.modo));
    b.disabled = b.dataset.modo === "candidato" && !st.cand;
    b.hidden = b.dataset.modo === "candidato" && visaoEstados();
  });
  $("#btnBrasilMun").hidden = !porEstado() || st.cargo !== "1";
}

// votos no recorte mais fino disponível: zona (pelos boletins), cidade ou estado
function resultadoRecorte() {
  if (st.zona && st.cidade && st.cidade.res) {
    const g = gruposCidade("zona").find((x) => x.zona === st.zona);
    if (!g || !st.resumoUF) return null;
    const cands = st.resumoUF.cands.map((c) => ({ ...c, votos: g.votos[c.n] || 0 }));
    cands.forEach((c) => { c.pct = g.validos ? c.votos / g.validos * 100 : 0; });
    cands.sort((a, b) => b.votos - a.votos);
    cands.forEach((c, i) => { c.pos = i + 1; });
    return { cands, validos: g.validos, rotulo: `Zona ${st.zona}`, secoes: null };
  }
  if (st.zona) return null;
  const r = st.resumo;
  return r ? { cands: r.cands, validos: r.votos.validos, rotulo: nomeRecorte().slice(-1)[0], secoes: r.secoes, r } : null;
}

function avatar(c, s = 30, quadrado = false, uf = st.uf, cargo = st.cargo) {
  const cor = corPartido(c.partido);
  const fonte = pastaFotos() ? `data-foto="${pacoteFoto(cargo, uf)}/${esc(c.sq)}"` : `src="${esc(tse.url.foto(cargo, uf, c.sq))}" loading="lazy"`;
  return `<span class="av${quadrado ? " q" : ""}" style="--s:${s}px;--c:${cor}"><img ${fonte} alt="" data-ini="${esc(iniciais(c.nome))}"></span>`;
}
const iniciais = (nome) => String(nome).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("");

// Retratos: do TSE ou, com window.PAINEL_CONFIG.fotos (ex.: "dados/fotos/"),
// de pacotes locais ({sq: "data:image/jpeg;base64,…"}) para a página
// publicada sem acesso à rede. Um pacote para o Presidente, um por UF para
// Governador e Senador e um por UF e cargo para os deputados.
const pastaFotos = () => globalThis.PAINEL_CONFIG && globalThis.PAINEL_CONFIG.fotos;
const pacotesFotos = new Map();
function pacoteFoto(cargo, uf) {
  const def = tse.cargoDef(cargo);
  return def.nacional ? "br" : def.prop ? `${uf}-c${tse.codigoCargo(cargo, uf)}` : uf;
}

function trocarPorIniciais(img) {
  const b = document.createElement("b");
  b.textContent = img.dataset.ini || "";
  img.replaceWith(b);
}

function preencherFotos() {
  for (const img of document.querySelectorAll("img[data-foto]")) {
    const [pacote, sq] = img.dataset.foto.split("/");
    const fotos = pacotesFotos.get(pacote);
    if (!fotos) {
      const p = fetch(`${pastaFotos()}${pacote}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      pacotesFotos.set(pacote, p);
      p.then((d) => { pacotesFotos.set(pacote, d); preencherFotos(); });
      continue;
    }
    if (fotos instanceof Promise) continue;
    img.removeAttribute("data-foto");
    if (fotos[sq]) img.src = fotos[sq];
    else trocarPorIniciais(img);
  }
}

function renderHero() {
  if (visaoEstados()) return renderHeroEstados();
  const el = $("#hero");
  const rr = resultadoRecorte();
  const kicker = `${nomeCargo()} · ${nomeRecorte().join(" · ")}`;
  if (!rr || !rr.cands.length) {
    definir(el, `<div class="kicker">${esc(kicker)}</div><p class="sent">${st.zona ? "Lendo os boletins da zona…" : "Carregando a apuração…"}</p>`);
    return;
  }
  const [a, b] = rr.cands;
  const pctSec = rr.secoes ? Math.floor(rr.secoes.pct * 10) / 10 : null;
  const dif = a && b ? a.votos - b.votos : 0;
  const frase = !a.votos ? `Aguardando os primeiros votos`
    : ehMajoritario() && b ? `<b style="--c:${corTexto(a.partido)}">${esc(a.nome)}</b> lidera por ${esc(grande(dif))} ${dif >= 1e6 ? "de votos" : dif === 1 ? "voto" : "votos"}`
    : `<b style="--c:${corTexto(a.partido)}">${esc(a.nome)}</b> é quem mais tem votos: ${esc(grande(a.votos))}`;
  const lado = (c, cls) => c ? `<div class="leader ${cls}" style="--c:${corTexto(c.partido)}">
      <div class="who">${avatar(c, 52, true)}<div><div class="nm">${esc(c.nome)}</div><div class="pm">${esc(c.partido)} ${esc(c.n)}</div></div></div>
      <div class="fig">${pctTxt(c.pct, 2).replace("%", "")}<sup>%</sup></div>
      <div class="votes">${fmt.format(c.votos)} votos</div>
    </div>` : "";
  const goal = cargoDef().turno2 && b ? `
    <div class="goal"><i class="a" style="width:${Math.min(100, a.pct)}%;--c:${corPartido(a.partido)}"></i><i class="b" style="width:${Math.min(100 - Math.min(100, a.pct), b.pct)}%;--c:${corPartido(b.partido)}"></i><span class="fifty"></span></div>
    <div class="faltam"><span>${a.pct > 50 ? "passou dos 50%" : `faltam ${(50 - a.pct).toFixed(1).replace(".", ",")} pontos`}</span><span>${b.pct > 50 ? "passou dos 50%" : `faltam ${(50 - b.pct).toFixed(1).replace(".", ",")} pontos`}</span></div>` : "";
  const r = rr.r;
  const pendente = r ? Math.max(0, r.eleitorado - r.eleitoradoApurado) : 0;
  const eleitos = rr.cands.filter((c) => /^eleit/i.test(c.situacao)).length;
  definir(el, `
    <div class="kicker">${esc(kicker)}${pctSec != null ? ` · ${pctTxt(pctSec)} das seções` : ""}</div>
    <p class="sent">${frase}</p>
    <div class="leaders">${lado(a, "")}${lado(b, "r")}</div>
    ${goal}
    <div class="kv">
      ${b && !cargoDef().prop ? `<div><span>Vantagem</span>${(a.pct - b.pct).toFixed(2).replace(".", ",")} pontos</div>` : ""}
      ${cargoDef().prop || cargoDef().id === "5" ? `<div><span>Vagas</span>${r ? r.vagas : "—"}</div>` : ""}
      ${cargoDef().prop && eleitos ? `<div><span>Eleitos</span>${fmt.format(eleitos)}</div>` : ""}
      ${r ? `<div><span>Por apurar</span>${pendente ? `${grande(Math.round(pendente))} de eleitores` : "nada"}</div>` : ""}
    </div>`);
}

// situação oficial na lista: eleito, 2º turno ou suplente (o resto é ruído)
const situacaoLista = (c) => (/^eleit|turno|suplente/i.test(c.situacao || "") ? `<span class="sit"> · ${esc(c.situacao[0].toLowerCase() + c.situacao.slice(1))}</span>` : "");

function renderCandidatos() {
  $("#candTitulo").textContent = visaoEstados() ? "Disputas" : "Candidatos";
  if (visaoEstados()) return renderDisputas();
  const el = $("#candLista");
  const rr = resultadoRecorte();
  $("#candRecorte").textContent = rr ? rr.rotulo : "";
  if (!rr) {
    el.innerHTML = `<li class="vazio">${st.zona ? "Lendo os boletins da zona…" : "Carregando…"}</li>`;
    return;
  }
  const termo = semAcento($("#candFiltro").value.trim());
  const lista = rr.cands.filter((c) => !termo || semAcento(c.nome).includes(termo) || c.n.startsWith(termo) || semAcento(c.partido).includes(termo));
  const max = Math.max(1, rr.cands[0] ? rr.cands[0].votos : 1);
  definir(el, lista.slice(0, 150).map((c) => `
    <li><button type="button" class="crow${c.valido === false ? " anulado" : ""}" data-cand="${c.n}" aria-current="${c.n === st.cand}" style="--c:${corPartido(c.partido)}">
      ${avatar(c, 30)}
      <span class="txt"><span class="nm">${esc(c.nome)}</span><span class="pm" style="--c:${corTexto(c.partido)}">${esc(c.partido)} ${esc(c.n)}${situacaoLista(c)}</span></span>
      <span class="val">${pctTxt(c.pct)}<small>${fmt.format(c.votos)}</small></span>
      <span class="bar"><i style="width:${(c.votos / max * 100).toFixed(1)}%"></i></span>
    </button></li>`).join("") || `<li class="vazio">Nenhum candidato encontrado.</li>`);
}

// ---------- dossiê ----------

function kpi(k, v, s, serif = false) {
  return `<div class="kpi"><div class="k">${esc(k)}</div><div class="v${serif ? " serif" : ""}">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`;
}
function faixa(rot, v, media, sub, cor) {
  const w = Number.isFinite(v) ? Math.min(100, v) : 0;
  return `<div class="faixa" style="--c:${cor}"><div class="faixa-cab"><span>${esc(rot)}</span>${pctTxt(v)}</div>
    <div class="barra"><i style="width:${w}%"></i><b style="left:${Math.min(100, media)}%"></b></div><div class="micro">${esc(sub)}</div></div>`;
}
function ranking(itens, valor, sub, cor) {
  if (!itens.length) return `<p class="nota">Sem dados suficientes.</p>`;
  return `<ol class="ranking">${itens.map((l) => `<li><button type="button" class="krow" data-ir-area="${l.cd}">
    <span><span class="nm">${esc(l.nome)}</span><span class="sub">${esc(sub(l))}</span></span>
    <span class="kv" style="--c:${cor}">${esc(valor(l))}</span></button></li>`).join("")}</ol>`;
}

function renderDossie() {
  const el = $("#dossie");
  if (visaoEstados()) {
    definir(el, renderPanoramaEstados());
    return;
  }
  const c = st.cand && candInfo(st.cand);
  if (!c) {
    definir(el, renderPanorama());
    return;
  }
  const linhas = linhasAnalise(c.n);
  const p = perfil(linhas);
  const unidade = porEstado() ? "estados" : "municípios";
  const rr = resultadoRecorte();
  const noRecorte = rr && (st.mun || st.zona) ? rr.cands.find((x) => x.n === c.n) : null;
  const cor = corPartido(c.partido), corT = corTexto(c.partido);
  const fmtV = (l) => `${pctTxt(l.pct)}`;

  const mudou = definir(el, `
    <button type="button" class="upto" data-cand="">‹ ${esc(nomeCargo())} · ${esc(tse.NOME_UF[st.uf])}</button>
    <div class="sh" style="--c:${corT}">
      ${avatar(c, 44, true)}
      <div><h2>${esc(c.nome)}</h2><div class="sub">${esc(c.partido)} ${esc(c.n)}${c.federacao && c.federacao !== c.partido ? ` · ${esc(c.federacao)}` : ""}${c.situacao ? ` · ${esc(c.situacao)}` : ""}</div></div>
      <button type="button" class="fechar" data-cand="" aria-label="Fechar candidato"><svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
    </div>
    <div class="kpis">
      ${kpi("Votos", fmt.format(c.votos), `${pctTxt(c.pct, 2)} dos válidos`, true)}
      ${kpi("Posição", `${c.pos}º`, `de ${fmt.format(st.resumoUF.cands.length)} candidaturas`, true)}
      ${kpi("Lidera em", p.municipios ? `${fmt.format(p.lidera)}` : "—", p.municipios ? `de ${fmt.format(p.municipios)} ${unidade}` : "carregando a matriz")}
      ${noRecorte ? kpi(rr.rotulo, fmt.format(noRecorte.votos), `${pctTxt(noRecorte.pct)} · ${noRecorte.pos}º lugar`) : kpi("Eleitorado onde lidera", p.municipios ? pctTxt(p.eleitoradoLideraPct) : "—", "do recorte")}
    </div>
    ${origemNaCidade(c)}
    ${!st.mun ? graficoEvolucao([c.n, (st.resumoUF.cands.find((x) => x.n !== c.n) || {}).n]) : ""}
    ${!st.mun ? porRegiao(c.n) : ""}
    <section class="sec" id="dLeitura"><div class="hd"><h3>Leitura estratégica</h3></div><p class="nota">Calculando…</p></section>
    ${p.municipios ? `
    <section class="sec"><div class="hd"><h3>Desempenho por porte</h3><span class="aside">média ${pctTxt(p.media)}</span></div>
      ${p.faixas.map((f) => faixa(f.rotulo, f.pct, p.media, `${fmt.format(f.municipios)} ${unidade} · ${pctTxt(f.peso)} dos votos dele`, cor)).join("")}
    </section>
    <section class="sec"><div class="hd"><h3>De onde vêm os votos</h3><span class="aside">${pctTxt(p.top10Pct)} nos 10 maiores</span></div>
      ${ranking(p.maiores, (l) => fmt.format(l.votos), (l) => `${pctTxt(l.pct)} dos válidos · ${pctTxt(l.peso)} do total`, corT)}</section>
    <section class="sec"><div class="hd"><h3>Redutos</h3><span class="aside">maior %</span></div>
      ${ranking(p.fortes, fmtV, (l) => `${fmt.format(l.votos)} votos · ${grande(l.eleitorado)} eleitores`, corT)}</section>
    ${p.oportunidades.length ? `<section class="sec"><div class="hd"><h3>Voto a conquistar</h3><span class="aside">abaixo da média e abstenção alta</span></div>
      ${ranking(p.oportunidades, (l) => `+${fmt.format(Math.round(l.potencial))}`, (l) => `${pctTxt(l.pct)} · abstenção ${pctTxt(l.abstencao / (l.eleitoradoApurado || l.eleitorado) * 100)}`, "var(--fg)")}</section>` : ""}
    ` : `<section class="sec"><p class="nota">A matriz de ${unidade} ainda está carregando.</p></section>`}
    <section class="sec" id="dComp"></section>`);
  if (mudou) preencherLeitura(c, linhas, p);
}

// resumo da cidade aberta, a partir dos boletins: zonas e locais que mais pesam
function origemNaCidade(c) {
  const cid = st.cidade;
  if (!st.mun || !cid || !cid.res || !cid.res.lidas) return "";
  const zonas = gruposCidade("zona");
  const locs = gruposCidade("local");
  const total = zonas.reduce((s, g) => s + (g.votos[c.n] || 0), 0);
  if (!total) return "";
  const corT = corTexto(c.partido);
  const z22 = st.zonas2022 || {};
  const linhaZ = zonas.map((g) => {
    const v = g.votos[c.n] || 0, pct = g.validos ? v / g.validos * 100 : 0;
    const z = z22[g.zona];
    const delta = z && z.validos && st.refN && st.cand ? pct - (z.votos[st.refN] || 0) / z.validos * 100 : null;
    return { cd: g.zona, nome: `Zona ${g.zona}`, v, pct, peso: v / total * 100, delta };
  }).sort((a, b) => b.v - a.v);
  const loc = st.locaisCidade || {};
  const linhaL = locs.map((g) => {
    const v = g.votos[c.n] || 0;
    const info = loc[g.zona] && loc[g.zona][g.local];
    return { cd: g.chave, zona: g.zona, nome: info ? tse.titulo(info[0]) : `Local ${g.local}`, bairro: info ? tse.titulo(info[1]) : "", v, pct: g.validos ? v / g.validos * 100 : 0, peso: v / total * 100 };
  }).sort((a, b) => b.v - a.v).slice(0, 5);
  const lidas = cid.res.lidas, tot = cid.res.recebidas;
  return `<section class="sec"><div class="hd"><h3>Origem dos votos na cidade</h3><span class="aside">${fmt.format(lidas)} de ${fmt.format(tot)} boletins</span></div>
    ${lidas < tot ? `<p class="nota" style="margin:-6px 0 10px">O TSE totaliza a seção antes de publicar o boletim dela; os ${fmt.format(tot - lidas)} restantes entram nas próximas leituras.</p>` : ""}
    <ol class="ranking">${linhaZ.map((z) => `<li><button type="button" class="krow" data-zona="${z.cd}"><span><span class="nm">${esc(z.nome)}</span><span class="sub">${pctTxt(z.peso)} dos votos dele na cidade${z.delta != null ? ` · ${pp(z.delta)} vs 2022` : ""}</span></span><span class="kv" style="--c:${corT}">${pctTxt(z.pct)}<small>${fmt.format(z.v)}</small></span></button></li>`).join("")}</ol>
    <h4>Locais com mais votos</h4>
    <ol class="ranking">${linhaL.map((l) => `<li><button type="button" class="krow" data-zona="${l.zona}"><span><span class="nm">${esc(l.nome)}</span><span class="sub">${esc(l.bairro)} · zona ${l.zona}</span></span><span class="kv" style="--c:${corT}">${fmt.format(l.v)}<small>${pctTxt(l.pct)}</small></span></button></li>`).join("")}</ol>
  </section>`;
}

async function preencherLeitura(c, linhas, p) {
  const ger = st.geracao, cand = st.cand;
  let comp = null;
  if (["1", "3", "5"].includes(st.cargo) && codCargo() !== "8" && linhas.length) {
    const base = await base2022(st.cargo);
    if (ger !== st.geracao || cand !== st.cand) return;
    comp = comparar(linhas, base, referencia2022(c, base));
  }
  const andamento = st.resumoUF ? st.resumoUF.secoes.pct : 0;
  const itens = leitura({ cand: c, perfil: p, comp, andamento, cargoMaj: cargoDef().turno2, unidade: porEstado() ? "estados" : "municípios" });
  const el = $("#dLeitura");
  if (!el) return;
  el.innerHTML = `<div class="hd"><h3>Leitura estratégica</h3></div>` + (itens.length
    ? `<ul class="insights">${itens.map((i) => `<li class="tom-${i.tom}"><b>${esc(i.titulo)}</b><p>${esc(i.texto)}</p></li>`).join("")}</ul>`
    : `<p class="nota">Aguardando a matriz de municípios.</p>`);
  const dc = $("#dComp");
  const corT = corTexto(c.partido);
  if (dc) {
    dc.innerHTML = comp ? `<div class="hd"><h3>Contra 2022</h3><span class="aside">${esc(comp.ref.criterio)}</span></div>
      <div class="duelo">
        <div><div class="k">${esc(comp.ref.nome)} · 2022</div><div class="fig-m">${pctTxt(comp.pct22)}</div></div>
        <div><div class="k">${esc(c.nome)} · 2026</div><div class="fig-m" style="color:${corT}">${pctTxt(comp.pct26)}</div></div>
        <div><div class="k">Variação</div><div class="fig-m">${pp(comp.delta).replace(" p.p.", "")}</div></div>
      </div>
      <p class="nota">Nos mesmos ${fmt.format(comp.municipios)} ${porEstado() ? "estados" : "municípios"}, sobre os válidos. Correlação geográfica: ${Number.isFinite(comp.correlacao) ? comp.correlacao.toFixed(2).replace(".", ",") : "—"}.</p>
      ${comp.ganhos.length ? `<h4>Onde mais avançou</h4>${ranking(comp.ganhos, (l) => pp(l.delta), (l) => `${pctTxt(l.p22)} → ${pctTxt(l.p26)}`, "var(--fg)")}` : ""}
      ${comp.perdas.length ? `<h4>Onde mais recuou</h4>${ranking(comp.perdas, (l) => pp(l.delta), (l) => `${pctTxt(l.p22)} → ${pctTxt(l.p26)}`, "var(--fg-3)")}` : ""}`
      : (["6", "7"].includes(st.cargo) ? `<div class="hd"><h3>Contra 2022</h3></div><p class="nota">Nesta versão a comparação histórica cobre Presidente, Governador e Senador.</p>` : "");
  }
  st.comp = comp;
  if (st.tabela.aba === "areas") renderTabela();
}

async function base2022(cargo) {
  const turno = `t${tse.TURNO}`;
  if (st.uf !== "br") return municipios2022(await hist2022(st.uf), cargo, turno);
  const ufs = tse.UFS.map(([cd]) => cd).concat("zz");
  const todos = await Promise.all(ufs.map((uf) => hist2022(uf)));
  const out = { cand: {}, mun: {} };
  todos.forEach((h, i) => {
    const b = municipios2022(h, cargo, turno);
    if (!b) return;
    Object.assign(out.cand, b.cand);
    if (st.nacionalMun) {
      Object.assign(out.mun, b.mun);
      return;
    }
    const tot = { validos: 0, votos: {} };
    for (const m of Object.values(b.mun)) {
      tot.validos += m.validos;
      for (const [n, q] of Object.entries(m.votos)) tot.votos[n] = (tot.votos[n] || 0) + q;
    }
    out.mun[ufs[i]] = tot;
  });
  return out;
}

// ---------- ao longo da apuração ----------

// Linhas de % dos válidos contra % das seções totalizadas, como o coletor
// registrou. `nums` escolhe os candidatos; sem ele, os dois primeiros.
function graficoEvolucao(nums) {
  if (!ehMajoritario() || !st.historico) return "";
  const serie = st.historico[`${st.cargo}-${st.uf}`];
  if (!serie || serie.length < 2) return "";
  const ultimo = serie[serie.length - 1];
  const alvo = (nums && nums.length ? nums : Object.entries(ultimo[2]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n))
    .filter((n, i, a) => n && a.indexOf(n) === i);
  const W = 276, H = 132, l = 30, r = 6, t = 8, b = 20;
  const x0 = Math.max(0, Math.floor(serie[0][1] / 10) * 10);
  const linhas = alvo.map((n) => ({
    n, c: candInfo(n),
    pts: serie.filter((p) => p[3] && p[2][n] != null).map((p) => [p[1], p[2][n] / p[3] * 100])
  })).filter((x) => x.pts.length > 1);
  if (!linhas.length) return "";
  const ys = linhas.flatMap((x) => x.pts.map((p) => p[1]));
  let y0 = Math.floor(Math.min(...ys) - 1), y1 = Math.ceil(Math.max(...ys) + 1);
  if (y1 - y0 < 4) { y0 -= 2; y1 += 2; }
  const X = (v) => l + (v - x0) / (100 - x0 || 1) * (W - l - r);
  const Y = (v) => t + (y1 - v) / (y1 - y0) * (H - t - b);
  const passo = Math.max(1, Math.round((y1 - y0) / 4));
  const marcas = [];
  for (let v = Math.ceil(y0); v <= y1; v += passo) marcas.push(v);
  const meio = cargoDef().turno2 && y0 < 50 && y1 > 50 ? `<line class="g50" x1="${l}" x2="${W - r}" y1="${Y(50).toFixed(1)}" y2="${Y(50).toFixed(1)}"></line>` : "";
  const svg = `<svg class="evolucao" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução dos percentuais ao longo da apuração">
    ${marcas.map((v) => `<line class="grade" x1="${l}" x2="${W - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"></line><text x="${l - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}%</text>`).join("")}
    ${meio}
    <text x="${l}" y="${H - 5}">${x0}% das seções</text><text x="${W - r}" y="${H - 5}" text-anchor="end">100%</text>
    ${linhas.map(({ c, pts }) => {
      const cor = corPartido(c ? c.partido : "");
      const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${X(px).toFixed(1)} ${Y(py).toFixed(1)}`).join("");
      const [ux, uy] = pts[pts.length - 1];
      return `<path d="${d}" style="stroke:${cor}"></path><circle cx="${X(ux).toFixed(1)}" cy="${Y(uy).toFixed(1)}" r="3" style="fill:${cor}"></circle>`;
    }).join("")}
  </svg>`;
  const legenda = linhas.map(({ c, n }) => `<span style="--c:${corPartido(c ? c.partido : "")}"><i></i>${esc(c ? c.nome : n)}</span>`).join("");
  return `<section class="sec"><div class="hd"><h3>Ao longo da apuração</h3><span class="aside">${st.arquivo ? "arquivo da noite" : "coletor"}</span></div>
    <div class="leg-linha esq">${legenda}</div>${svg}</section>`;
}

function listaEventos() {
  if (!st.eventos || !st.eventos.length) return "";
  const rel = st.eventos.filter((e) => e.tipo !== "secoes" || e.cargo === st.cargo).slice(0, 8);
  return `<section class="sec"><div class="hd"><h3>Últimas atualizações</h3><span class="aside">${st.arquivo ? "arquivo da noite" : "coletor"}</span></div>
    <ol class="eventos">${rel.map((e) => `<li class="ev-${e.tipo}"><span class="t">${esc(String(e.t).slice(0, 5).replace(":", "h"))}</span><p>${esc(e.texto)}</p></li>`).join("")}</ol></section>`;
}

// ---------- por região ----------

const REGIOES = [
  ["Norte", ["ac", "ap", "am", "pa", "ro", "rr", "to"]],
  ["Nordeste", ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"]],
  ["Centro-Oeste", ["df", "go", "mt", "ms"]],
  ["Sudeste", ["es", "mg", "rj", "sp"]],
  ["Sul", ["pr", "rs", "sc"]],
  ["Exterior", ["zz"]]
];

let regioes2022 = null;
function carregarRegioes2022() {
  if (regioes2022) return regioes2022;
  regioes2022 = Promise.all(REGIOES.flatMap(([, ufs]) => ufs).map(async (uf) => [uf, municipios2022(await hist2022(uf), "1", `t${tse.TURNO}`)]))
    .then((lista) => {
      const porUf = Object.fromEntries(lista);
      const out = {};
      for (const [nome, ufs] of REGIOES) {
        const r = (out[nome] = { validos: 0, votos: {} });
        for (const uf of ufs) {
          const b = porUf[uf];
          if (!b) continue;
          for (const m of Object.values(b.mun)) {
            r.validos += m.validos;
            for (const [n, q] of Object.entries(m.votos)) r.votos[n] = (r.votos[n] || 0) + q;
          }
        }
      }
      st.regioes2022 = out;
      renderDossie();
      return out;
    }).catch(() => null);
  return regioes2022;
}

// `fixo`: com candidato escolhido, mostra o percentual dele em cada região
function porRegiao(fixo = "") {
  if (st.cargo !== "1" || st.uf !== "br" || !st.nacionalR.size) return "";
  carregarRegioes2022();
  const linhas = REGIOES.map(([nome, ufs]) => {
    let validos = 0, total = 0, totalizadas = 0, pendente = 0;
    const votos = {};
    for (const uf of ufs) {
      const r = st.nacionalR.get(uf);
      if (!r) continue;
      validos += r.votos.validos;
      total += r.secoes.total;
      totalizadas += r.secoes.totalizadas;
      pendente += Math.max(0, r.eleitorado - r.eleitoradoApurado);
      for (const c of r.cands) votos[c.n] = (votos[c.n] || 0) + c.votos;
    }
    const [n] = fixo ? [fixo] : Object.entries(votos).sort((a, b) => b[1] - a[1])[0] || [];
    if (!n || !validos) return "";
    const c = candInfo(n) || { nome: n, partido: "", n, sq: "" };
    const pct = votos[n] / validos * 100;
    const r22 = st.regioes2022 && st.regioes2022[nome];
    const delta = r22 && r22.validos ? pct - (r22.votos[n] || 0) / r22.validos * 100 : null;
    return `<button type="button" class="reg" ${ufs.length === 1 ? `data-ir-area="${ufs[0]}"` : ""} style="--c:${corPartido(c.partido)}">
      <span class="reg-nome">${esc(nome)}<small>${pctTxt(Math.floor(totalizadas / total * 1000) / 10)} · faltam ${esc(grande(Math.round(pendente)))}</small></span>
      <span class="reg-val">${avatar(c, 22, false, "br")}<span class="pm" style="--c:${corTexto(c.partido)}">${esc(c.partido)}</span><b>${pctTxt(pct)}</b>${delta != null ? `<small>${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1).replace(".", ",")}</small>` : ""}</span>
      <span class="reg-barra"><i style="width:${Math.min(100, pct)}%"></i><b></b></span>
    </button>`;
  }).join("");
  return `<section class="sec"><div class="hd"><h3>Por região</h3><span class="aside">${fixo ? "% dos válidos" : "quem lidera"} · vs 2022</span></div>${linhas}</section>`;
}

function renderPanorama() {
  const r = st.resumo;
  if (!r) return `<p class="vazio-d">Carregando o resultado…</p>`;
  const v = r.votos;
  const fonte = areasDoMapa();
  const contagem = new Map();
  fonte.forEach((d) => { if (d.lider) contagem.set(d.lider, (contagem.get(d.lider) || 0) + 1); });
  const unidade = porEstado() ? "estados" : "municípios";
  const lideres = [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `
    <div class="hd"><h3>Panorama</h3><span class="aside">${esc(nomeRecorte().join(" · "))}</span></div>
    <div class="kpis">
      ${kpi("Comparecimento", fmt.format(r.comparecimento), pctTxt(r.eleitoradoApurado ? r.comparecimento / r.eleitoradoApurado * 100 : NaN) + " do eleitorado apurado")}
      ${kpi("Abstenção", fmt.format(r.abstencao), pctTxt(r.eleitoradoApurado ? r.abstencao / r.eleitoradoApurado * 100 : NaN))}
      ${kpi("Brancos", fmt.format(v.brancos), pctTxt(v.total ? v.brancos / v.total * 100 : NaN) + " do total")}
      ${kpi("Nulos", fmt.format(v.nulos), pctTxt(v.total ? v.nulos / v.total * 100 : NaN) + " do total")}
    </div>
    ${!st.mun ? graficoEvolucao() : ""}
    ${!st.mun ? porRegiao() : ""}
    ${lideres.length && !st.mun ? `<section class="sec"><div class="hd"><h3>Quem lidera onde</h3><span class="aside">${unidade}</span></div>
      ${lideres.map(([n, k]) => {
        const c = candInfo(n) || { nome: n, partido: "" };
        return `<button type="button" class="krow" data-cand="${n}"><span><span class="nm">${esc(c.nome)}</span><span class="sub">${esc(c.partido)} ${esc(n)}</span></span><span class="kv" style="--c:${corTexto(c.partido)}">${fmt.format(k)}<small>${pctTxt(k / fonte.size * 100)} dos ${unidade}</small></span></button>`;
      }).join("")}</section>` : ""}
    ${listaEventos()}
    <section class="sec"><p class="nota">Escolha um candidato na lista, no mapa ou na busca para ver o mapa da votação dele, de onde vêm os votos, a leitura estratégica e a comparação com 2022.</p></section>`;
}

// ---------- tabela ----------

const COLUNAS_DISPUTAS = [["nome", "Estado", "t"], ["secoesPct", "Apurado", "p"], ["lider", "1º colocado", "t"], ["pct", "%", "p"], ["segundo", "2º colocado", "t"], ["pct2", "%", "p"], ["margem", "Vantagem", "n"], ["situacao", "Situação", "t"]];

const COLUNAS = {
  areas: [["nome", "Local", "t"], ["eleitorado", "Eleitorado", "n"], ["secoesPct", "Apurado", "p"], ["votos", "Votos", "n"], ["pct", "% válidos", "p"], ["peso", "Peso no total", "p"], ["pos", "Posição", "n"], ["delta", "vs 2022", "d"]],
  zonas: [["nome", "Zona", "t"], ["secoes", "Seções lidas", "n"], ["comparecimento", "Comparec.", "n"], ["votos", "Votos", "n"], ["pct", "% válidos", "p"], ["peso", "Peso na cidade", "p"], ["delta", "vs 2022", "d"]],
  locais: [["nome", "Local de votação", "t"], ["bairro", "Bairro", "t"], ["zona", "Zona", "n"], ["secoes", "Seções", "n"], ["comparecimento", "Comparec.", "n"], ["votos", "Votos", "n"], ["pct", "% válidos", "p"], ["peso", "Peso", "p"]]
};

function linhasTabela() {
  if (visaoEstados()) {
    return placarEstados().disputas.map((d) => ({
      cd: d.uf, nome: tse.NOME_UF[d.uf], secoesPct: d.r.secoes.pct,
      lider: d.a ? `${d.a.nome} (${d.a.partido})` : "", pct: d.a ? d.a.pct : NaN,
      segundo: d.b ? `${d.b.nome} (${d.b.partido})` : "", pct2: d.b ? d.b.pct : NaN,
      margem: d.b ? +d.margem.toFixed(1) : NaN, situacao: situacaoTexto(d)
    }));
  }
  const n = alvoN();
  if (st.tabela.aba === "areas") {
    const deltas = st.comp && st.cand ? st.comp.porMun : {};
    const linhas = linhasAnalise(n);
    const total = linhas.reduce((s, l) => s + l.votos, 0);
    return linhas.map((l) => ({ ...l, pct: l.validos ? l.votos / l.validos * 100 : NaN, peso: total ? l.votos / total * 100 : NaN, delta: deltas[l.cd] }));
  }
  const c = st.cidade;
  if (!c || !c.res) return [];
  const porLocal = st.tabela.aba === "locais";
  const grupos = gruposCidade(porLocal ? "local" : "zona");
  const totalCand = grupos.reduce((s, g) => s + (g.votos[n] || 0), 0);
  const loc = st.locaisCidade || {};
  const z22 = st.zonas2022 || {};
  return grupos
    .filter((g) => !porLocal || !st.zona || g.zona === st.zona)
    .map((g) => {
      const votos = g.votos[n] || 0;
      const pct = g.validos ? votos / g.validos * 100 : NaN;
      const info = loc[g.zona] && loc[g.zona][g.local];
      const z = z22[g.zona];
      return {
        cd: g.chave,
        zonaCd: g.zona,
        nome: porLocal ? (info ? tse.titulo(info[0]) : `Local ${g.local}`) : `Zona ${g.zona}`,
        bairro: info ? tse.titulo(info[1]) : "",
        zona: Number(g.zona),
        secoes: g.secoes,
        comparecimento: g.comparecimento,
        votos, pct,
        peso: totalCand ? votos / totalCand * 100 : NaN,
        delta: z && z.validos && st.refN ? pct - (z.votos[st.refN] || 0) / z.validos * 100 : undefined
      };
    });
}

function renderTabela() {
  const abas = [["areas", porEstado() ? "Estados" : "Municípios"]];
  if (st.mun) abas.push(["zonas", "Zonas"], ["locais", "Locais de votação"]);
  if (!abas.some(([id]) => id === st.tabela.aba)) st.tabela.aba = "areas";
  definir($("#tabAbas"), abas.map(([id, rot]) => `<button type="button" data-aba="${id}" aria-pressed="${st.tabela.aba === id}">${rot}</button>`).join(""));
  const c = !visaoEstados() && alvoN() && candInfo(alvoN());
  const res = st.cidade && st.cidade.res;
  const boletins = st.tabela.aba !== "areas" && res ? ` · ${fmt.format(res.lidas)} de ${fmt.format(res.recebidas)} boletins de urna publicados` : "";
  $("#tabNota").textContent = c ? `Votos de ${c.nome}${st.cand ? "" : ", líder no recorte"}${boletins}` : "";

  const cols = visaoEstados() ? COLUNAS_DISPUTAS : COLUNAS[st.tabela.aba].filter(([k]) => k !== "delta" || ["1", "3", "5"].includes(st.cargo));
  const { ordem, desc } = st.tabela;
  const termo = semAcento(st.tabela.filtro);
  const linhas = linhasTabela().filter((l) => !termo || semAcento(l.nome).includes(termo) || semAcento(l.bairro).includes(termo));
  const tipo = (cols.find(([k]) => k === ordem) || [])[2];
  linhas.sort((a, b) => {
    const va = a[ordem], vb = b[ordem];
    const r = tipo === "t" ? String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR") : (Number.isFinite(va) ? va : -Infinity) - (Number.isFinite(vb) ? vb : -Infinity);
    return desc ? -r : r;
  });
  const atual = st.tabela.aba === "areas" ? st.mun : st.zona;
  definir($("#tab"), `<thead><tr>${cols.map(([k, rot, t]) => `<th class="${t !== "t" ? "r" : ""}" data-ordem="${k}" aria-sort="${ordem === k ? (desc ? "descending" : "ascending") : "none"}">${rot}</th>`).join("")}</tr></thead>
    <tbody>${linhas.slice(0, 1000).map((l) => `<tr data-linha="${esc(l.cd)}" aria-current="${atual && (l.cd === atual || l.zonaCd === atual) ? "true" : "false"}">${cols.map(([k, , t]) => `<td class="${t !== "t" ? "r" : ""}">${celula(l[k], t, l, k)}</td>`).join("")}</tr>`).join("")}</tbody>`);
  let vazio = "";
  if (!linhas.length) {
    if (visaoEstados()) {
      vazio = "Carregando as disputas dos estados…";
    } else if (st.tabela.aba !== "areas" && st.cidade) {
      const nome = (munInfo(st.cidade.cd) || {}).nome || "Esta cidade";
      vazio = st.cidade.grande ? (feed.ativo()
          ? `${nome} tem ${fmt.format(st.cidade.total)} seções. O coletor ainda não publicou as zonas desta cidade; elas aparecem aqui sozinhas assim que o primeiro lote de boletins for somado.`
          : `${nome} tem ${fmt.format(st.cidade.total)} seções. Abrir zonas e locais nesse porte precisa do coletor no servidor (veja ARQUITETURA.md).`)
        : st.cidade.erro || (st.cidade.res ? "O TSE ainda não publicou boletins de urna desta cidade." : "Lendo os boletins de urna…");
    } else {
      vazio = st.carga ? "Carregando…" : "Sem dados para este recorte.";
    }
  }
  $("#tabVazio").hidden = !vazio;
  $("#tabVazio").textContent = vazio;
}

function celula(v, t, l, k) {
  if (t === "t") return k === "nome" && l.capital ? `${esc(v)} <span class="sub">capital</span>` : esc(v);
  if (t === "p") return pctTxt(v);
  if (t === "d") return v === undefined || !Number.isFinite(v) ? "—" : pp(v);
  return Number.isFinite(v) ? fmt.format(v) : "—";
}

function renderCarga() {
  const c = st.carga;
  $("#carga").hidden = !c;
  if (!c) return;
  $("#cargaTxt").textContent = `${c.rotulo}: ${fmt.format(c.feitos)} de ${fmt.format(c.total)}`;
  $("#cargaBarra").style.width = (c.total ? c.feitos / c.total * 100 : 0) + "%";
}

function renderCargaCidade() {
  const el = $("#cargaCidade");
  const c = st.cidade;
  el.hidden = !(c && c.carga);
  if (el.hidden) return;
  el.querySelector("span").textContent = `Lendo boletins de urna: ${fmt.format(c.carga.feitos)} de ${fmt.format(c.carga.total)} seções`;
  el.querySelector("i").style.width = (c.carga.total ? c.carga.feitos / c.carga.total * 100 : 0) + "%";
}

// ---------- tooltip ----------

function candDaArea(id, n) {
  const r = st.geo && st.geo.estados && st.nacionalR.get(id);
  return (r && r.cands.find((c) => c.n === n)) || candInfo(n) || { nome: n, partido: "", n, sq: "" };
}

function linhaTip(c, votos, validos, uf = st.uf) {
  return `<div class="crow" style="--c:${corPartido(c.partido)}">${avatar(c, 26, false, uf)}<span class="txt"><span class="nm">${esc(c.nome)}</span><span class="pm" style="--c:${corTexto(c.partido)}">${esc(c.partido)} ${esc(c.n)}</span></span><span class="val">${pctTxt(validos ? votos / validos * 100 : NaN)}<small>${fmt.format(votos)}</small></span></div>`;
}

function tooltipArea(id) {
  const d = dadosArea(id);
  const info = st.geo.estados ? null : munInfoGlobal(id);
  const nome = st.geo.estados ? tse.NOME_UF[id] : (info || {}).nome || id;
  const tag = st.geo.estados ? id.toUpperCase() : (info ? info.uf.toUpperCase() : "");
  const cab = (sub) => `<div class="tip-cab"><span class="uft">${tag}</span><div><b>${esc(nome)}</b><small>${esc(sub)}</small></div></div>`;
  if (!d || !d.validos) return cab("Aguardando votos");
  const alvo = st.cand ? [st.cand] : [];
  const nums = [...alvo, ...[d.lider, d.segundo].filter((n) => n && !alvo.includes(n))].slice(0, st.cand ? 2 : 2);
  const linhas = nums.map((n) => linhaTip(candDaArea(id, n), d.votos[n] || 0, d.validos, st.geo.estados && st.cargo !== "1" ? id : st.uf)).join("");
  let then = "";
  if (st.comp && st.cand && st.comp.porMun[id] !== undefined) then = `<div class="then">Contra ${esc(st.comp.ref.nome)} em 2022: ${pp(st.comp.porMun[id])}</div>`;
  return cab(`${pctTxt(Math.floor(d.secoesPct * 10) / 10)} das seções · ${grande(d.eleitorado)} eleitores`) + linhas +
    (st.cand ? `<div class="micro">${d.ordem.indexOf(st.cand) + 1}º lugar aqui</div>` : "") + then;
}

function tooltipLocal(chave) {
  const c = st.cidade;
  if (!c || !c.res) return "";
  const g = gruposCidade("local").find((x) => x.chave === chave);
  if (!g) return "";
  const info = st.locaisCidade && st.locaisCidade[g.zona] && st.locaisCidade[g.zona][g.local];
  const nums = Object.entries(g.votos).filter(([k]) => /^\d+$/.test(k)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const mostrar = st.cand ? [st.cand, ...nums.filter((n) => n !== st.cand)].slice(0, 2) : nums.slice(0, 2);
  return `<div class="tip-cab"><span class="uft">${g.zona}</span><div><b>${esc(info ? tse.titulo(info[0]) : "Local " + g.local)}</b><small>${esc(info ? `${tse.titulo(info[1])} · ` : "")}${g.secoes} seç${g.secoes > 1 ? "ões" : "ão"} · ${fmt.format(g.comparecimento)} votantes</small></div></div>` +
    mostrar.map((n) => linhaTip(candInfo(n) || { nome: n, partido: "", n, sq: "" }, g.votos[n] || 0, g.validos)).join("");
}

// ---------- busca global ----------

async function construirIndice() {
  if (st.indice) return st.indice;
  const itens = [];
  // com coletor, os candidatos majoritários já estão no feed
  const doFeed = feed.ativo() && st.agora ? Object.keys(st.candFeed) : [];
  for (const k of doFeed) {
    const [cargo, uf] = k.split("-");
    if (uf === "zz" || (cargo === "1" && uf !== "br")) continue;
    const r = resultadoDoFeed(cargo, uf);
    if (r) for (const c of r.cands) itens.push({ ...c, cargo, uf, chave: semAcento(`${c.nome} ${c.completo} ${c.partido}`) });
  }
  const pedidos = [];
  if (!doFeed.length) pedidos.push({ cargo: "1", uf: "br" });
  const cargosTse = (doFeed.length ? ["6", "7"] : ["3", "5", "6", "7"]).filter((c) => cargosDisponiveis().some((x) => x.id === c));
  for (const [uf] of tse.UFS) for (const cargo of cargosTse) pedidos.push({ cargo, uf });
  st.indice = { itens, pronto: false, feitos: 0, total: pedidos.length };
  await tse.fila(pedidos, async ({ cargo, uf }) => {
    const r = tse.lerResultado(await tse.json(tse.url.resultado(cargo, uf)));
    for (const c of r.cands) itens.push({ ...c, cargo, uf, chave: semAcento(`${c.nome} ${c.completo} ${c.partido}`) });
  }, { n: 12, progresso: (f) => { st.indice.feitos = f; if (f % 12 === 0) renderBusca(); } });
  st.indice.pronto = true;
  renderBusca();
  return st.indice;
}

function renderBusca() {
  const el = $("#buscaRes");
  const termo = semAcento($("#busca").value.trim());
  if (termo.length < 2) { el.hidden = true; return; }
  el.hidden = false;
  const idx = st.indice;
  if (!idx) { el.innerHTML = `<li class="vazio">Preparando a busca…</li>`; return; }
  const fUf = $("#buscaUf").value, fCargo = $("#buscaCargo").value;
  const res = idx.itens
    .filter((c) => (!fUf || c.uf === fUf) && (!fCargo || c.cargo === fCargo))
    .filter((c) => c.chave.includes(termo) || c.n === termo)
    .sort((a, b) => b.votos - a.votos)
    .slice(0, 40);
  const status = idx.pronto ? "" : `<li class="vazio">Indexando candidatos: ${idx.feitos} de ${idx.total} listas</li>`;
  // municípios entram na mesma busca, antes dos candidatos
  const cidades = [];
  if (termo.length >= 3 && st.municipios && !fCargo) {
    for (const [uf, lista] of Object.entries(st.municipios)) {
      if (fUf && fUf !== uf) continue;
      for (const m of lista) if (semAcento(m.nome).includes(termo)) cidades.push({ uf, m });
    }
    cidades.sort((a, b) => (semAcento(a.m.nome).startsWith(termo) ? 0 : 1) - (semAcento(b.m.nome).startsWith(termo) ? 0 : 1) || a.m.nome.localeCompare(b.m.nome, "pt-BR"));
  }
  const htmlCidades = cidades.slice(0, 5).map(({ uf, m }) => `
    <li><button type="button" role="option" data-busca-mun="${uf}|${m.cd}">
      <span class="uft">${uf.toUpperCase()}</span>
      <span class="b-nome">${esc(m.nome)}</span>
      <span class="b-sub">Município · ${m.zonas.length} ${m.zonas.length === 1 ? "zona" : "zonas"}${m.capital ? " · capital" : ""}</span>
      <span class="b-num"></span>
    </button></li>`).join("");
  el.innerHTML = status + htmlCidades + (res.map((c) => `
    <li><button type="button" role="option" data-busca="${c.cargo}|${c.uf}|${c.n}">
      ${avatar(c, 34, false, c.uf, c.cargo)}
      <span class="b-nome">${esc(c.nome)}</span>
      <span class="b-sub">${c.uf.toUpperCase()} · ${esc(tse.nomeCargo(c.cargo, c.uf))} · <span style="color:${corTexto(c.partido)}">${esc(c.partido)} ${esc(c.n)}</span> · ${esc(titulo(c.completo))}</span>
      <span class="b-num"><b>${pctTxt(c.pct)}</b><small>${fmt.format(c.votos)}</small></span>
    </button></li>`).join("") || (idx.pronto && !htmlCidades ? `<li class="vazio">Nenhum candidato ou município com esse nome.</li>` : ""));
}
const titulo = tse.titulo;

// ---------- ciclo ao vivo ----------

function agendar() {
  st.proxima = estatico() ? Infinity : Date.now() + (feed.ativo() ? 15 : REFRESH_S) * 1000;
}

async function atualizarAoVivo() {
  const ger = st.geracao;
  agendar();
  $("#live").dataset.st = "carregando";
  let ok = true;
  if (feed.ativo()) {
    try {
      const ag = await feed.json("agora.json");
      const mudou = !st.agora || ag.seq !== st.agora.seq;
      st.agora = ag;
      if (mudou) carregarHistorico().then(() => { if (ger === st.geracao) renderDossie(); });
    } catch (_) {
      ok = false;
    }
    feed.vivo().then((n) => { st.vivos = n; renderVivos(); });
  }
  try {
    const r = visaoEstados() ? null : doColetor() ? resultadoDoFeed(st.cargo, st.uf) : tse.lerResultado(await tse.json(tse.url.resultado(st.cargo, st.uf)));
    if (r) st.resumoUF = r;
    if (ger !== st.geracao) return;
    if (st.mun) {
      const l = matrizNoFeed() && st.linhasFeed && st.linhasFeed.get(st.mun);
      st.resumo = l ? resultadoDaLinha(l) : tse.lerResultado(await tse.json(tse.url.resultado(st.cargo, st.uf, st.mun)));
    } else {
      st.resumo = st.resumoUF;
    }
  } catch (_) {
    ok = false;
  }
  if (ger !== st.geracao) return;
  $("#live").dataset.st = ok ? "ok" : "erro";
  renderTudo();
  // com coletor, a matriz da UF é um arquivo só e basta a cada 30 s
  if (!matrizNoFeed() || Date.now() >= (st.proximaMatriz || 0)) {
    st.proximaMatriz = Date.now() + 30e3;
    await carregarMatriz(ger, st.ctrl.signal, true);
  }
  if (st.cidade && Date.now() >= st.proximaCidade) {
    if (st.cidade.feedZonas || (st.cidade.grande && feed.ativo())) {
      st.proximaCidade = Date.now() + 60e3;
      await zonasDoFeed(ger, st.cidade.cd);
    } else if (st.cidade.cache) {
      st.secoesUF.delete(st.uf);
      try {
        st.cidade.zonas = (await secoesUF(st.uf))[st.cidade.cd] || st.cidade.zonas;
        await apurarSecoes(ger, st.cidade.cd);
      } catch (_) { /* tenta no próximo ciclo */ }
    }
  }
}

function renderVivos() {
  const el = $("#vivos");
  el.hidden = st.vivos == null;
  if (st.vivos == null) return;
  $("#vivosN").textContent = fmt.format(st.vivos);
  $("#vivosRot").textContent = st.vivos === 1 ? "pessoa agora" : "pessoas agora";
}

setInterval(() => {
  if (document.hidden) return;
  const resta = Math.max(0, Math.ceil((st.proxima - Date.now()) / 1000));
  const estado = $("#live").dataset.st;
  // na visão de estados não há placar único: vale a totalização mais recente
  const r = st.resumoUF || (visaoEstados() && [...st.nacionalR.values()].sort((a, b) => tse.carimbo(b).localeCompare(tse.carimbo(a)))[0]) || null;
  $("#liveTxt").textContent = estado === "erro" ? `Sem resposta do TSE · nova tentativa em ${resta}s`
    : estado === "carregando" ? "Atualizando…"
    : r ? `${r.hora.slice(0, 5).replace(":", "h")} · ${pctTxt(Math.floor(r.secoes.pct * 10) / 10)}` : "Ao vivo";
  if (estatico()) {
    $("#live").dataset.st = "retrato";
    $(".live .lw").textContent = "Retrato das ";
  }
  $("#live").title = `${feed.ativo() ? "Dados do coletor" : "Leitura direta do TSE"} · próxima em ${resta}s`;
  if (st.proxima && Date.now() >= st.proxima && estado !== "carregando") atualizarAoVivo();
}, 1000);

// ---------- eventos ----------

function ligarEventos() {
  $("#cargos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cargo]");
    if (b && b.dataset.cargo !== st.cargo) mudar({ cargo: b.dataset.cargo, mun: "", zona: "", cand: "" });
  });
  $("#uf").addEventListener("change", () => mudar({ uf: $("#uf").value, mun: "", zona: "", cand: st.cargo === "1" ? st.cand : "" }));
  $("#cidade").addEventListener("change", () => {
    const v = semAcento($("#cidade").value.trim());
    const m = listaMun().find((x) => semAcento(x.nome) === v);
    if (m && m.cd !== st.mun) mudar({ mun: m.cd, zona: "" });
    else if (!v && st.mun) mudar({ mun: "", zona: "" });
  });
  $("#zona").addEventListener("change", () => mudar({ zona: $("#zona").value }));
  $("#candFiltro").addEventListener("input", renderCandidatos);

  document.addEventListener("click", (e) => {
    const cand = e.target.closest("[data-cand]");
    if (cand) {
      const n = cand.dataset.cand;
      mudar({ cand: n && n === st.cand ? "" : n });
      return;
    }
    const ir = e.target.closest("[data-ir]");
    if (ir) {
      mudar(ir.dataset.ir === "uf" ? { mun: "", zona: "" } : { zona: "" });
      return;
    }
    const zona = e.target.closest("[data-zona]");
    if (zona) {
      mudar({ zona: zona.dataset.zona === st.zona ? "" : zona.dataset.zona });
      return;
    }
    const area = e.target.closest("[data-ir-area]");
    if (area) {
      irParaArea(area.dataset.irArea);
      return;
    }
    const buscaMun = e.target.closest("[data-busca-mun]");
    if (buscaMun) {
      const [uf, mun] = buscaMun.dataset.buscaMun.split("|");
      $("#buscaRes").hidden = true;
      $("#busca").value = "";
      const cargo = uf === "zz" && st.cargo !== "1" ? "1" : st.cargo;
      mudar({ cargo, uf, mun, zona: "", cand: st.cargo === cargo ? st.cand : "" });
      return;
    }
    const busca = e.target.closest("[data-busca]");
    if (busca) {
      const [cargo, uf, n] = busca.dataset.busca.split("|");
      $("#buscaRes").hidden = true;
      $("#busca").value = "";
      mudar({ cargo, uf, mun: "", zona: "", cand: n });
      return;
    }
    if (!e.target.closest(".busca")) $("#buscaRes").hidden = true;
  });

  const svg = $("#mapaSvg");
  svg.addEventListener("click", (e) => {
    if (zoom.arrastou()) return;
    const local = e.target.closest("[data-local]");
    if (local) {
      mudar({ zona: local.dataset.local.split("/")[0] });
      return;
    }
    const p = e.target.closest("[data-area]");
    if (p && p.dataset.area) irParaArea(p.dataset.area);
  });
  const tip = $("#tip");
  svg.addEventListener("pointermove", (e) => {
    const local = e.target.closest("[data-local]");
    const p = e.target.closest("[data-area]");
    let html = "";
    if (local) html = tooltipLocal(local.dataset.local);
    else if (p && p.dataset.area && st.geo) html = tooltipArea(p.dataset.area);
    tip.hidden = !html;
    if (!html) return;
    tip.innerHTML = html;
    const hud = $("#hud").getBoundingClientRect();
    const z = st.escala;
    const w = hud.width / z, h = hud.height / z;
    let x = (e.clientX - hud.left) / z + 18, y = (e.clientY - hud.top) / z + 14;
    if (x + tip.offsetWidth > w - 12) x -= tip.offsetWidth + 36;
    if (y + tip.offsetHeight > h - 12) y = h - 12 - tip.offsetHeight;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  svg.addEventListener("zoom", (e) => reescalar(e.detail));

  $("#modoMapa").addEventListener("click", (e) => {
    const b = e.target.closest("[data-modo]");
    if (!b || b.disabled) return;
    st.modo = b.dataset.modo;
    renderCabecalho();
    pintar();
  });
  $("#btnEnquadrar").addEventListener("click", () => (st.mun ? focarMunicipio() : zoom.reiniciar()));
  const passo = (f) => {
    const svg = $("#mapaSvg");
    const r = svg.getBoundingClientRect();
    const d = dims();
    svg.dispatchEvent(new WheelEvent("wheel", {
      deltaY: Math.log(f) / 0.0022,
      clientX: r.left + (d.area[0] + d.area[2]) / 2 * st.escala,
      clientY: r.top + (d.area[1] + d.area[3]) / 2 * st.escala,
      cancelable: true
    }));
  };
  $("#btnMais").addEventListener("click", () => passo(1 / 1.6));
  $("#btnMenos").addEventListener("click", () => passo(1.6));
  $("#btnBrasilMun").addEventListener("click", async () => {
    st.nacionalMun = true;
    st.comp = null;
    renderCabecalho();
    const ger = st.geracao;
    await desenharMapa(ger);
    renderTudo();
    carregarTodosMunicipios(ger, st.ctrl.signal);
  });

  $("#btnGaveta").addEventListener("click", () => alternarGaveta());
  $("#btnCompartilhar").addEventListener("click", compartilhar);
  $("#tabAbas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-aba]");
    if (!b) return;
    st.tabela.aba = b.dataset.aba;
    st.tabela.ordem = "votos";
    st.tabela.desc = true;
    if ($("#hud").classList.contains("fechada")) alternarGaveta(false);
    renderTabela();
  });
  $("#tab").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-ordem]");
    if (th) {
      const k = th.dataset.ordem;
      st.tabela.desc = st.tabela.ordem === k ? !st.tabela.desc : !["nome", "bairro", "zona"].includes(k);
      st.tabela.ordem = k;
      renderTabela();
      return;
    }
    const tr = e.target.closest("tr[data-linha]");
    if (!tr) return;
    if (st.tabela.aba === "areas") irParaArea(tr.dataset.linha);
    else mudar({ zona: tr.dataset.linha.split("/")[0] });
  });
  $("#tabFiltro").addEventListener("input", () => {
    st.tabela.filtro = $("#tabFiltro").value;
    renderTabela();
  });

  let tBusca;
  $("#busca").addEventListener("focus", () => construirIndice());
  $("#busca").addEventListener("input", () => {
    clearTimeout(tBusca);
    tBusca = setTimeout(renderBusca, 120);
  });
  $("#buscaUf").addEventListener("change", renderBusca);
  $("#buscaCargo").addEventListener("change", renderBusca);
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !["INPUT", "SELECT"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      $("#busca").focus();
    }
    if (e.key === "Escape") $("#buscaRes").hidden = true;
  });

  // retrato que não existe vira iniciais
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.parentElement || !img.parentElement.classList.contains("av")) return;
    trocarPorIniciais(img);
  }, true);
  if (pastaFotos()) new MutationObserver(preencherFotos).observe(document.body, { childList: true, subtree: true });

  window.addEventListener("hashchange", () => {
    const alvo = { cargo: st.cargo, uf: st.uf, ...lerHash() };
    const chave = (o) => [o.cargo, o.uf, o.mun, o.zona, o.cand].join("|");
    if (chave(alvo) !== chave(st)) mudar(alvo);
  });

  let tRedim;
  window.addEventListener("resize", () => {
    clearTimeout(tRedim);
    tRedim = setTimeout(() => {
      ajustarEscala();
      desenharMapa(st.geracao);
    }, 200);
  });
}

async function compartilhar() {
  const dados = { title: document.title, text: `${nomeCargo()} · ${nomeRecorte().join(" · ")}`, url: location.href };
  if (navigator.share) {
    try { await navigator.share(dados); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(location.href);
    avisar("Link copiado.");
  } catch (_) {
    avisar("Não foi possível copiar o link. Copie o endereço da barra do navegador.");
  }
}

let tAviso;
function avisar(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(tAviso);
  tAviso = setTimeout(() => { el.hidden = true; }, 2400);
}

function alternarGaveta(fechar = !$("#hud").classList.contains("fechada")) {
  $("#hud").classList.toggle("fechada", fechar);
  $("#btnGaveta").setAttribute("aria-expanded", String(!fechar));
  $("#btnGaveta").setAttribute("aria-label", fechar ? "Abrir tabela" : "Recolher tabela");
  try { localStorage.setItem("painel.gaveta", fechar ? "fechada" : "aberta"); } catch (_) { /* sem armazenamento */ }
  desenharMapa(st.geracao);
}

function irParaArea(id) {
  if (st.geo && st.geo.estados) {
    mudar({ uf: id, mun: "", zona: "", cand: st.cargo === "1" ? st.cand : "" });
    return;
  }
  if (st.uf === "br") {
    const m = munInfoGlobal(id);
    if (m) mudar({ uf: m.uf, mun: id, zona: "" });
    return;
  }
  mudar({ mun: id, zona: "" });
}

// ---------- início ----------

async function iniciar() {
  await tse.configurar({ turno: new URLSearchParams(location.search).get("turno") });
  $(".marca span").textContent = `${tse.TURNO}º turno · ${estatico() ? "retrato da apuração" : "análise da apuração"}`;
  try {
    if (localStorage.getItem("painel.gaveta") === "fechada") $("#hud").classList.add("fechada");
  } catch (_) { /* sem armazenamento */ }
  ajustarEscala();
  zoom = zoomavel($("#mapaSvg"), dims);
  ligarEventos();
  Object.assign(st, lerHash());
  normalizar();
  st.modo = st.cand ? "candidato" : "lider";
  gravarHash();
  renderControles();
  renderTudo();
  const [, agora] = await Promise.all([
    tse.municipios().then((m) => { st.municipios = m; }, () => { st.municipios = {}; }),
    feed.detectar()
  ]);
  // um feed de outro turno não serve: o painel volta a ler o TSE direto
  if (agora && agora.turno && agora.turno !== tse.TURNO) feed.desligar();
  if (agora && feed.ativo()) {
    st.agora = agora;
    try { st.candFeed = (await feed.json("candidatos.json")).candidatos || {}; } catch (_) { st.candFeed = {}; }
    feed.vivo().then((n) => { st.vivos = n; renderVivos(); });
  }
  carregarHistorico().then(() => renderDossie());
  renderControles();
  await carregarBase();
}

iniciar();
