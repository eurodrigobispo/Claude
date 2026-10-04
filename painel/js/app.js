import * as tse from "./tse.js";
import { apurarCidade, agrupar } from "./bu.js";
import { malha, projetar, zoomavel } from "./geo.js";
import { perfil, municipios2022, referencia2022, comparar, leitura, pctTxt, pp } from "./analise.js";
import { Delaunay } from "./vendor/d3-delaunay.js";
import { corPartido, corTexto, corMargem, rampaMargem, rampaCandidato, quebrasCandidato, classeCandidato, AGUARDANDO, TERRA } from "./cores.js";

const BASE_W = 1600, BASE_H = 900;
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
  escala: 1
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
    segundo: b && b.votos > 0 ? b.n : null
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

// ---------- escala de desktop ----------

// Desenhado numa tela lógica de 1600×900; em monitores maiores tudo cresce
// junto com zoom, abaixo disso fica 1:1.
function ajustarEscala() {
  const z = Math.min(3, Math.max(1, Math.min(innerWidth / BASE_W, innerHeight / BASE_H)));
  st.escala = z;
  const hud = $("#hud");
  hud.style.zoom = z;
  hud.style.width = innerWidth / z + "px";
  hud.style.height = innerHeight / z + "px";
}

function dims() {
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
  if (cargo && tse.CARGOS.some((c) => c.id === cargo)) out.cargo = cargo;
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
  history.replaceState(null, "", "#" + p.toString());
}

function normalizar() {
  if (!cargoDef().nacional && (st.uf === "br" || st.uf === "zz")) st.uf = "sp";
  if (st.uf === "br") st.mun = "";
  if (!st.mun) st.zona = "";
}

// ---------- carga do recorte ----------

// muda o recorte e recarrega só o que depende do que mudou
async function mudar(alteracoes) {
  const antes = { cargo: st.cargo, uf: st.uf, mun: st.mun, cand: st.cand };
  Object.assign(st, alteracoes);
  normalizar();
  st.modo = st.cand ? "candidato" : "lider";
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
    cidade: null, resumoUF: null, resumo: null, comp: null, carga: null
  });
  st.tabela.filtro = "";
  $("#tabFiltro").value = "";
  st.tabela.aba = "areas";
  renderControles();
  renderCarga();
  renderTudo();

  try {
    st.resumoUF = tse.lerResultado(await tse.json(tse.url.resultado(st.cargo, st.uf), { signal }));
  } catch (_) {
    if (ger !== st.geracao) return;
  }
  if (ger !== st.geracao) return;
  st.resumo = st.resumoUF;
  $("#live").dataset.st = st.resumoUF ? "ok" : "erro";
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
    const r = tse.lerResultado(await tse.json(tse.url.resultado(st.cargo, st.uf, mun), { signal: st.ctrl.signal }));
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
  const ufs = tse.UFS.map(([cd]) => cd).concat("zz");
  await tse.fila(ufs, async (uf) => {
    const r = tse.lerResultado(await tse.json(tse.url.resultado("1", uf), { signal }));
    if (ger !== st.geracao) return;
    st.nacional.set(uf, linhaDe(uf, r));
    st.nacionalR.set(uf, r);
  }, { n: 14, signal });
  if (ger !== st.geracao) return;
  somarBrasil();
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
  const base = ["1", "3", "5"].includes(st.cargo) ? municipios2022(hist, st.cargo) : null;
  const n = alvoN();
  const c = n && candInfo(n);
  const ref = c && base ? referencia2022(c, base) : null;
  st.refN = ref ? ref.n : null;
  st.zonas2022 = base && base.mun[mun] ? base.mun[mun].zonas : {};
  renderTabela();
  pintarLocais();
}

// candidato de referência para tabela, tooltips e locais: o escolhido ou o líder
const alvoN = () => st.cand || (st.resumoUF && st.resumoUF.cands[0] && st.resumoUF.cands[0].n) || "";

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
  if (n) return rampaCandidato(partidoDe(n))[classeCandidato((d.votos[n] || 0) / d.validos * 100, q)];
  return d.lider ? corMargem(partidoDe(d.lider), d.margem) : AGUARDANDO;
}

function pintar() {
  if (!st.geo) return;
  const n = st.modo === "candidato" ? st.cand : "";
  const c = n && candInfo(n);
  const q = c ? quebrasCandidato(c.pct) : [];
  st.geo.porArea.forEach((a, id) => { a.el.style.fill = corArea(dadosArea(id), n, q); });
  st.quebras = q;
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
  const grupos = agrupar(c.res.secoes, codCargo(), "local");
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
  if (!st.geo || !st.resumoUF) { el.innerHTML = ""; return; }
  const unidade = st.geo.estados ? "estados" : "municípios";
  const fonte = areasDoMapa();
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
  $("#cargos").innerHTML = tse.CARGOS.map((c) =>
    `<button type="button" data-cargo="${c.id}" aria-pressed="${c.id === st.cargo}">${esc(c.id === "7" && st.uf === "df" ? "Dep. Distrital" : c.curto)}</button>`
  ).join("");
  const nacional = cargoDef().nacional;
  $("#uf").innerHTML = (nacional ? `<option value="br">Brasil</option>` : "") +
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
  const r = st.resumo;
  $("#andamentoPct").textContent = r ? pctTxt(Math.floor(r.secoes.pct * 10) / 10) : "—";
  $("#andamentoBarra").style.width = r ? Math.min(100, r.secoes.pct) + "%" : "0";
  $("#andamentoTxt").textContent = r ? `${fmt.format(r.secoes.totalizadas)} de ${fmt.format(r.secoes.total)} seções · totalizado às ${r.hora}` : "";
  $("#modoMapa").querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.modo === st.modo));
    b.disabled = b.dataset.modo === "candidato" && !st.cand;
  });
  $("#btnBrasilMun").hidden = !porEstado();
}

// votos no recorte mais fino disponível: zona (pelos boletins), cidade ou estado
function resultadoRecorte() {
  if (st.zona && st.cidade && st.cidade.res) {
    const g = agrupar(st.cidade.res.secoes, codCargo(), "zona").find((x) => x.zona === st.zona);
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

function avatar(c, s = 30, quadrado = false) {
  const cor = corPartido(c.partido);
  return `<span class="av${quadrado ? " q" : ""}" style="--s:${s}px;--c:${cor}"><img src="${esc(tse.url.foto(st.cargo, st.uf, c.sq))}" alt="" loading="lazy" data-ini="${esc(iniciais(c.nome))}"></span>`;
}
const iniciais = (nome) => String(nome).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("");

function renderHero() {
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
  definir(el, `
    <div class="kicker">${esc(kicker)}${pctSec != null ? ` · ${pctTxt(pctSec)} das seções` : ""}</div>
    <p class="sent">${frase}</p>
    <div class="leaders">${lado(a, "")}${lado(b, "r")}</div>
    ${goal}
    <div class="kv">
      ${b ? `<div><span>Vantagem</span>${(a.pct - b.pct).toFixed(2).replace(".", ",")} pontos</div>` : ""}
      ${cargoDef().prop || cargoDef().id === "5" ? `<div><span>Vagas</span>${r ? r.vagas : "—"}</div>` : ""}
      ${r ? `<div><span>Por apurar</span>${pendente ? `${grande(Math.round(pendente))} de eleitores` : "nada"}</div>` : ""}
    </div>`);
}

function renderCandidatos() {
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
      <span class="txt"><span class="nm">${esc(c.nome)}</span><span class="pm" style="--c:${corTexto(c.partido)}">${esc(c.partido)} ${esc(c.n)}</span></span>
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
  if (!st.mun || !cid || !cid.res || !cid.res.secoes.length) return "";
  const cargo = codCargo();
  const zonas = agrupar(cid.res.secoes, cargo, "zona");
  const locs = agrupar(cid.res.secoes, cargo, "local");
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
  if (st.uf !== "br") return municipios2022(await hist2022(st.uf), cargo);
  const ufs = tse.UFS.map(([cd]) => cd).concat("zz");
  const todos = await Promise.all(ufs.map((uf) => hist2022(uf)));
  const out = { cand: {}, mun: {} };
  todos.forEach((h, i) => {
    const b = municipios2022(h, cargo);
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
    ${lideres.length && !st.mun ? `<section class="sec"><div class="hd"><h3>Quem lidera onde</h3><span class="aside">${unidade}</span></div>
      ${lideres.map(([n, k]) => {
        const c = candInfo(n) || { nome: n, partido: "" };
        return `<button type="button" class="krow" data-cand="${n}"><span><span class="nm">${esc(c.nome)}</span><span class="sub">${esc(c.partido)} ${esc(n)}</span></span><span class="kv" style="--c:${corTexto(c.partido)}">${fmt.format(k)}<small>${pctTxt(k / fonte.size * 100)} dos ${unidade}</small></span></button>`;
      }).join("")}</section>` : ""}
    <section class="sec"><p class="nota">Escolha um candidato na lista, no mapa ou na busca para ver o mapa da votação dele, de onde vêm os votos, a leitura estratégica e a comparação com 2022.</p></section>`;
}

// ---------- tabela ----------

const COLUNAS = {
  areas: [["nome", "Local", "t"], ["eleitorado", "Eleitorado", "n"], ["secoesPct", "Apurado", "p"], ["votos", "Votos", "n"], ["pct", "% válidos", "p"], ["peso", "Peso no total", "p"], ["pos", "Posição", "n"], ["delta", "vs 2022", "d"]],
  zonas: [["nome", "Zona", "t"], ["secoes", "Seções lidas", "n"], ["comparecimento", "Comparec.", "n"], ["votos", "Votos", "n"], ["pct", "% válidos", "p"], ["peso", "Peso na cidade", "p"], ["delta", "vs 2022", "d"]],
  locais: [["nome", "Local de votação", "t"], ["bairro", "Bairro", "t"], ["zona", "Zona", "n"], ["secoes", "Seções", "n"], ["comparecimento", "Comparec.", "n"], ["votos", "Votos", "n"], ["pct", "% válidos", "p"], ["peso", "Peso", "p"]]
};

function linhasTabela() {
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
  const grupos = agrupar(c.res.secoes, codCargo(), porLocal ? "local" : "zona");
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
  const c = alvoN() && candInfo(alvoN());
  const res = st.cidade && st.cidade.res;
  const boletins = st.tabela.aba !== "areas" && res ? ` · ${fmt.format(res.lidas)} de ${fmt.format(res.recebidas)} boletins de urna publicados` : "";
  $("#tabNota").textContent = c ? `Votos de ${c.nome}${st.cand ? "" : ", líder no recorte"}${boletins}` : "";

  const cols = COLUNAS[st.tabela.aba].filter(([k]) => k !== "delta" || ["1", "3", "5"].includes(st.cargo));
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
    if (st.tabela.aba !== "areas" && st.cidade) {
      const nome = (munInfo(st.cidade.cd) || {}).nome || "Esta cidade";
      vazio = st.cidade.grande ? `${nome} tem ${fmt.format(st.cidade.total)} seções. Abrir zonas e locais nesse porte precisa do coletor no servidor (veja ARQUITETURA.md).`
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

function linhaTip(c, votos, validos) {
  return `<div class="crow" style="--c:${corPartido(c.partido)}">${avatar(c, 26)}<span class="txt"><span class="nm">${esc(c.nome)}</span><span class="pm" style="--c:${corTexto(c.partido)}">${esc(c.partido)} ${esc(c.n)}</span></span><span class="val">${pctTxt(validos ? votos / validos * 100 : NaN)}<small>${fmt.format(votos)}</small></span></div>`;
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
  const linhas = nums.map((n) => linhaTip(candInfo(n) || { nome: n, partido: "", n, sq: "" }, d.votos[n] || 0, d.validos)).join("");
  let then = "";
  if (st.comp && st.cand && st.comp.porMun[id] !== undefined) then = `<div class="then">Contra ${esc(st.comp.ref.nome)} em 2022: ${pp(st.comp.porMun[id])}</div>`;
  return cab(`${pctTxt(Math.floor(d.secoesPct * 10) / 10)} das seções · ${grande(d.eleitorado)} eleitores`) + linhas +
    (st.cand ? `<div class="micro">${d.ordem.indexOf(st.cand) + 1}º lugar aqui</div>` : "") + then;
}

function tooltipLocal(chave) {
  const c = st.cidade;
  if (!c || !c.res) return "";
  const g = agrupar(c.res.secoes, codCargo(), "local").find((x) => x.chave === chave);
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
  const pedidos = [{ cargo: "1", uf: "br" }];
  for (const [uf] of tse.UFS) for (const cargo of ["3", "5", "6", "7"]) pedidos.push({ cargo, uf });
  const itens = [];
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
  el.innerHTML = status + (res.map((c) => `
    <li><button type="button" role="option" data-busca="${c.cargo}|${c.uf}|${c.n}">
      <span class="uft">${c.uf === "br" ? "BR" : c.uf.toUpperCase()}</span>
      <span class="b-nome">${esc(c.nome)}</span>
      <span class="b-sub">${esc(tse.nomeCargo(c.cargo, c.uf))} · <span style="color:${corTexto(c.partido)}">${esc(c.partido)} ${esc(c.n)}</span> · ${esc(titulo(c.completo))}</span>
      <span class="b-num"><b>${pctTxt(c.pct)}</b><small>${fmt.format(c.votos)}</small></span>
    </button></li>`).join("") || (idx.pronto ? `<li class="vazio">Nenhum candidato com esse nome.</li>` : ""));
}
const titulo = tse.titulo;

// ---------- ciclo ao vivo ----------

function agendar() {
  st.proxima = Date.now() + REFRESH_S * 1000;
}

async function atualizarAoVivo() {
  const ger = st.geracao;
  agendar();
  $("#live").dataset.st = "carregando";
  try {
    const r = tse.lerResultado(await tse.json(tse.url.resultado(st.cargo, st.uf)));
    if (ger !== st.geracao) return;
    st.resumoUF = r;
    st.resumo = st.mun ? tse.lerResultado(await tse.json(tse.url.resultado(st.cargo, st.uf, st.mun))) : r;
    if (ger !== st.geracao) return;
    $("#live").dataset.st = "ok";
  } catch (_) {
    $("#live").dataset.st = "erro";
  }
  renderTudo();
  await carregarMatriz(ger, st.ctrl.signal, true);
  if (st.cidade && st.cidade.cache && Date.now() >= st.proximaCidade) {
    st.secoesUF.delete(st.uf);
    try {
      st.cidade.zonas = (await secoesUF(st.uf))[st.cidade.cd] || st.cidade.zonas;
      await apurarSecoes(ger, st.cidade.cd);
    } catch (_) { /* tenta no próximo ciclo */ }
  }
}

setInterval(() => {
  if (document.hidden) return;
  const resta = Math.max(0, Math.ceil((st.proxima - Date.now()) / 1000));
  const estado = $("#live").dataset.st;
  const r = st.resumoUF;
  $("#liveTxt").textContent = estado === "erro" ? `Sem resposta do TSE · nova tentativa em ${resta}s`
    : estado === "carregando" ? "Atualizando…"
    : r ? `${r.hora.slice(0, 5).replace(":", "h")} · ${pctTxt(Math.floor(r.secoes.pct * 10) / 10)}` : "Ao vivo";
  $("#live").title = `Próxima leitura do TSE em ${resta}s`;
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
    const b = document.createElement("b");
    b.textContent = img.dataset.ini || "";
    img.replaceWith(b);
  }, true);

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
  try {
    st.municipios = await tse.municipios();
  } catch (_) {
    st.municipios = {};
  }
  renderControles();
  await carregarBase();
}

iniciar();
