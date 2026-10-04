// Acesso aos arquivos de divulgação do TSE (resultados.tse.jus.br).
// O TSE libera CORS para qualquer origem e serve gzip, então o navegador lê
// tudo direto da fonte. Este módulo monta os endereços, controla a fila de
// requisições e normaliza os JSON de resultado num formato único.

export const RAIZ = "https://resultados.tse.jus.br/oficial";
export const BASE = `${RAIZ}/ele2026`;

// Códigos do pleito e das eleições federal e estadual. Começam no 1º turno e
// são trocados por configurar(), que lê o índice oficial de eleições do TSE.
export let PLEITO = "3220";
export let FEDERAL = "6257";
export let ESTADUAL = "6259";
export let TURNO = 1;

export const CARGOS = [
  { id: "1", nome: "Presidente", curto: "Presidente", get ele() { return FEDERAL; }, nacional: true, maj: true, turno2: true },
  { id: "3", nome: "Governador", curto: "Governador", get ele() { return ESTADUAL; }, maj: true, turno2: true },
  { id: "5", nome: "Senador", curto: "Senador", get ele() { return ESTADUAL; }, maj: true },
  { id: "6", nome: "Deputado Federal", curto: "Dep. Federal", get ele() { return ESTADUAL; }, prop: true },
  { id: "7", nome: "Deputado Estadual", curto: "Dep. Estadual", get ele() { return ESTADUAL; }, prop: true }
];

// no 2º turno só há Presidente e Governador
export const cargosDoTurno = () => (TURNO === 2 ? CARGOS.filter((c) => c.id === "1" || c.id === "3") : CARGOS);

const hojeBrasilia = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const isoDe = (dt) => String(dt || "").split("/").reverse().join("-");

/**
 * Escolhe o pleito de 2026 pelo índice do TSE (comum/config/ele-c.json):
 * o turno pedido ou, sem pedido, o mais recente cuja data já chegou.
 * Devolve { pleito, federal, estadual, turno, data }; se o índice não
 * responder, mantém os códigos do 1º turno.
 */
export async function configurar({ turno } = {}) {
  try {
    const d = await json(`${RAIZ}/comum/config/ele-c.json`);
    const opcoes = [];
    for (const p of d.pl || []) {
      if (p.c !== "ele2026") continue;
      const fed = (p.e || []).find((e) => e.tp === "8");
      const est = (p.e || []).find((e) => e.tp === "1");
      if (!fed && !est) continue;
      opcoes.push({
        pleito: p.cd, federal: fed ? fed.cd : "", estadual: est ? est.cd : "", turno: Number((fed || est).t), data: isoDe(p.dt),
        federal2: fed ? fed.cdt2 : "", estadual2: est ? est.cdt2 : ""
      });
    }
    opcoes.sort((a, b) => a.data.localeCompare(b.data));
    const pedido = Number(turno) || 0;
    let escolha = pedido ? opcoes.filter((o) => o.turno === pedido).pop()
      : opcoes.filter((o) => o.data <= hojeBrasilia()).pop() || opcoes[0];
    // 2º turno pedido antes de o TSE publicar o pleito dele: usa os códigos
    // de 2º turno anunciados no 1º (os resultados aparecem quando existirem)
    if (!escolha && pedido === 2) {
      const t1 = opcoes.filter((o) => o.turno === 1 && (o.federal2 || o.estadual2)).pop();
      if (t1) escolha = { pleito: t1.pleito, federal: t1.federal2, estadual: t1.estadual2, turno: 2 };
    }
    if (escolha) {
      PLEITO = escolha.pleito;
      FEDERAL = escolha.federal || FEDERAL;
      ESTADUAL = escolha.estadual || ESTADUAL;
      TURNO = escolha.turno;
    }
  } catch (_) { /* índice fora do ar: segue com os códigos atuais */ }
  return { pleito: PLEITO, federal: FEDERAL, estadual: ESTADUAL, turno: TURNO };
}

export const UFS = [
  ["ac", "Acre", "12"], ["al", "Alagoas", "27"], ["ap", "Amapá", "16"], ["am", "Amazonas", "13"],
  ["ba", "Bahia", "29"], ["ce", "Ceará", "23"], ["df", "Distrito Federal", "53"],
  ["es", "Espírito Santo", "32"], ["go", "Goiás", "52"], ["ma", "Maranhão", "21"],
  ["mt", "Mato Grosso", "51"], ["ms", "Mato Grosso do Sul", "50"], ["mg", "Minas Gerais", "31"],
  ["pa", "Pará", "15"], ["pb", "Paraíba", "25"], ["pr", "Paraná", "41"], ["pe", "Pernambuco", "26"],
  ["pi", "Piauí", "22"], ["rj", "Rio de Janeiro", "33"], ["rn", "Rio Grande do Norte", "24"],
  ["rs", "Rio Grande do Sul", "43"], ["ro", "Rondônia", "11"], ["rr", "Roraima", "14"],
  ["sc", "Santa Catarina", "42"], ["sp", "São Paulo", "35"], ["se", "Sergipe", "28"], ["to", "Tocantins", "17"]
];
export const NOME_UF = Object.fromEntries(UFS.map(([cd, nm]) => [cd, nm]));
NOME_UF.br = "Brasil";
NOME_UF.zz = "Exterior";
export const UF_POR_IBGE = Object.fromEntries(UFS.map(([cd, , ibge]) => [ibge, cd]));

const pad = (s, n) => String(s).padStart(n, "0");
export const cargoDef = (id) => CARGOS.find((c) => c.id === id || (id === "8" && c.id === "7"));

// Dep. Estadual vira Dep. Distrital no DF
export const codigoCargo = (cargo, uf) => (cargo === "7" && uf === "df" ? "8" : cargo);
export const nomeCargo = (cargo, uf) => (codigoCargo(cargo, uf) === "8" ? "Deputado Distrital" : cargoDef(cargo).nome);

// ---------- endereços ----------

export const url = {
  resultado: (cargo, uf, mun = "") => {
    const ele = cargoDef(cargo).ele;
    return `${BASE}/${ele}/dados/${uf}/${uf}${mun}-c${pad(codigoCargo(cargo, uf), 4)}-e${pad(ele, 6)}-u.json`;
  },
  andamento: (ele, uf) => `${BASE}/${ele}/dados/${uf}/${uf}-e${pad(ele, 6)}-ab.json`,
  municipios: (ele) => `${BASE}/${ele}/config/mun-e${pad(ele, 6)}-cm.json`,
  foto: (cargo, uf, sq) => `${BASE}/${cargoDef(cargo).ele}/fotos/${cargoDef(cargo).nacional ? "br" : uf}/${sq}.jpeg`,
  secoes: (uf) => `${BASE}/arquivo-urna/${PLEITO}/config/${uf}/${uf}-p${pad(PLEITO, 6)}-cs.json`,
  auxSecao: (uf, mun, zona, secao) =>
    `${BASE}/arquivo-urna/${PLEITO}/dados/${uf}/${mun}/${zona}/${secao}/p${pad(PLEITO, 6)}-${uf}-m${mun}-z${zona}-s${secao}-aux.json`,
  arquivoSecao: (uf, mun, zona, secao, hash, nome) =>
    `${BASE}/arquivo-urna/${PLEITO}/dados/${uf}/${mun}/${zona}/${secao}/${hash}/${nome}`
};

// ---------- rede ----------

export class ErroHttp extends Error {
  constructor(status, u) {
    super(`HTTP ${status} em ${u}`);
    this.status = status;
  }
}

async function pedir(u, { signal, prazo = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), prazo);
  const desistir = () => ctrl.abort();
  signal?.addEventListener("abort", desistir, { once: true });
  try {
    const r = await fetch(u, { cache: "no-cache", signal: ctrl.signal });
    if (!r.ok) throw new ErroHttp(r.status, u);
    return r;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", desistir);
  }
}

const memoria = new Map();

// JSON com memória curta opcional: com `validade` > 0, pedidos repetidos dentro
// desse prazo reaproveitam a mesma resposta. Sem validade nada fica guardado,
// para a matriz de municípios não reter o JSON inteiro de cada arquivo.
export async function json(u, { validade = 0, signal } = {}) {
  if (validade > 0) {
    const m = memoria.get(u);
    if (m && Date.now() - m.t < validade) return m.p;
  }
  const p = pedir(u, { signal }).then((r) => r.json());
  if (validade > 0) {
    memoria.set(u, { t: Date.now(), p });
    p.catch(() => memoria.delete(u));
  }
  return p;
}

export async function bytes(u, { signal } = {}) {
  const r = await pedir(u, { signal });
  return new Uint8Array(await r.arrayBuffer());
}

// Executa `fn` sobre os itens com no máximo `n` em paralelo. HTTP/2 do TSE
// multiplexa bem; 16 é um bom equilíbrio entre velocidade e gentileza.
export async function fila(itens, fn, { n = 16, signal, progresso } = {}) {
  const out = new Array(itens.length);
  let prox = 0, feitos = 0;
  async function trabalhador() {
    while (prox < itens.length) {
      if (signal?.aborted) return;
      const i = prox++;
      try {
        out[i] = await fn(itens[i], i);
      } catch (e) {
        if (e.name === "AbortError" && signal?.aborted) return;
        out[i] = { erro: e };
      }
      feitos++;
      progresso?.(feitos, itens.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return out;
}

// ---------- leitura ----------

const int = (s) => Number(s) || 0;
const num = (s) => Number(String(s ?? "").replace(",", ".")) || 0;

// "DR.LUISINHO DA SILVA" -> "Dr.Luisinho da Silva"
export function titulo(s) {
  const minusculas = new Set(["da", "de", "do", "das", "dos", "e"]);
  return String(s).toLowerCase()
    .replace(/(^|[\s.\-'(])(\p{L})/gu, (m, antes, letra) => antes + letra.toUpperCase())
    .split(" ")
    .map((p, i) => (i > 0 && minusculas.has(p.toLowerCase()) ? p.toLowerCase() : p))
    .join(" ");
}

// Normaliza um arquivo -u.json do TSE.
export function lerResultado(d) {
  const c = (d.carg && d.carg[0]) || {};
  const fed = Object.fromEntries((c.fed || []).map((f) => [f.n, f.sg]));
  const cands = [];
  for (const a of c.agr || []) {
    for (const p of a.par || []) {
      for (const k of p.cand || []) {
        cands.push({
          n: k.n,
          sq: k.sqcand,
          nome: titulo(k.nmu || k.nm),
          completo: k.nm,
          partido: p.sg,
          npartido: p.n,
          federacao: p.nfed && fed[p.nfed] ? fed[p.nfed] : "",
          coligacao: a.tp === "c" ? a.nm : "",
          vices: (k.vs || []).map((v) => ({ tipo: v.tp, nome: titulo(v.nmu || v.nm), partido: v.sgp })),
          votos: int(k.vap),
          pct: num(k.pvapn || k.pvap),
          valido: String(k.dvt || "").startsWith("Válido"),
          destinacao: k.dvt || "",
          eleito: k.e === "s",
          situacao: k.st || "",
          seq: int(k.seq)
        });
      }
    }
  }
  cands.sort((x, y) => y.votos - x.votos || x.seq - y.seq);
  cands.forEach((k, i) => { k.pos = i + 1; });
  const s = d.s || {}, e = d.e || {}, v = d.v || {};
  return {
    cargo: c.cd,
    vagas: int(c.nv) || 1,
    data: d.dt,
    hora: d.ht,
    gerado: `${d.dg || ""} ${d.hg || ""}`,
    secoes: { total: int(s.ts), totalizadas: int(s.st), pct: num(s.pstn || s.pst) },
    eleitorado: int(e.te),
    eleitoradoApurado: int(e.est),
    comparecimento: int(e.c),
    abstencao: int(e.a),
    votos: {
      total: int(v.tv), validos: int(v.vv), brancos: int(v.vb), nulos: int(v.tvn),
      legenda: int(v.vl), nominais: int(v.vnom)
    },
    cands
  };
}

// Soma resultados normalizados (ex.: os estados para obter o Brasil). Os
// candidatos vêm de `base`; a hora é a mais recente entre as partes.
export function somarResultados(base, partes) {
  const soma = (f) => partes.reduce((s, r) => s + f(r), 0);
  const votos = new Map();
  for (const r of partes) for (const c of r.cands) votos.set(c.n, (votos.get(c.n) || 0) + c.votos);
  const validos = soma((r) => r.votos.validos);
  const cands = base.cands.map((c) => ({ ...c, votos: votos.get(c.n) || 0 }));
  cands.forEach((c) => { c.pct = validos ? c.votos / validos * 100 : 0; });
  cands.sort((x, y) => y.votos - x.votos || x.seq - y.seq);
  cands.forEach((c, i) => { c.pos = i + 1; });
  const total = soma((r) => r.secoes.total), totalizadas = soma((r) => r.secoes.totalizadas);
  // a hora exibida é a da totalização mais recente entre as partes cuja data
  // bate com a do arquivo (o exterior às vezes vem com o fuso de outro país)
  const coerentes = partes.filter((r) => r.data && r.gerado.startsWith(r.data));
  const ultima = coerentes.sort((a, b) => carimbo(b).localeCompare(carimbo(a)))[0];
  return {
    ...base,
    data: ultima ? ultima.data : base.data,
    hora: ultima ? ultima.hora : base.hora,
    gerado: partes.map((r) => r.gerado).sort((a, b) => geracao({ gerado: b }).localeCompare(geracao({ gerado: a })))[0] || base.gerado,
    secoes: { total, totalizadas, pct: total ? totalizadas / total * 100 : 0 },
    eleitorado: soma((r) => r.eleitorado),
    eleitoradoApurado: soma((r) => r.eleitoradoApurado),
    comparecimento: soma((r) => r.comparecimento),
    abstencao: soma((r) => r.abstencao),
    votos: {
      total: soma((r) => r.votos.total), validos, brancos: soma((r) => r.votos.brancos), nulos: soma((r) => r.votos.nulos),
      legenda: soma((r) => r.votos.legenda), nominais: soma((r) => r.votos.nominais)
    },
    cands,
    somado: true
  };
}

const inverter = (d) => String(d || "").split("/").reverse().join("");
export const carimbo = (r) => `${inverter(r.data)} ${r.hora || ""}`;
// momento em que o TSE gerou o arquivo, para comparar o frescor de agregados
export const geracao = (r) => { const [d, h] = String(r.gerado || "").split(" "); return `${inverter(d)} ${h || ""}`; };

// Lista de municípios: { uf: [{cd, ibge, nome, zonas, capital}] }
export async function municipios() {
  // no começo do 2º turno o TSE pode ainda não ter a lista nova; a do 1º serve
  const d = await json(url.municipios(FEDERAL), { validade: 36e5 }).catch(() => json(url.municipios("6257"), { validade: 36e5 }));
  const out = {};
  for (const a of d.abr || []) {
    out[a.cd] = (a.mu || []).map((m) => ({
      cd: m.cd,
      ibge: m.cdi,
      nome: titulo(m.nm),
      zonas: (m.z || []).map((z) => String(Number(z))),
      capital: m.c === "s"
    }));
  }
  return out;
}

// Andamento por município de uma UF: { mun: {hora, pct, eleitorado, comparecimento} }
export async function andamento(ele, uf, opts) {
  const d = await json(url.andamento(ele, uf), opts);
  const out = {};
  for (const a of d.abr || []) {
    out[a.cdabr] = {
      hora: `${a.dt} ${a.ht}`,
      pct: num(a.s && (a.s.pstn || a.s.pst)),
      eleitorado: int(a.e && a.e.te),
      comparecimento: int(a.e && a.e.c),
      abstencao: int(a.e && a.e.a)
    };
  }
  return out;
}

// Seções por município e zona (com hora de recebimento de cada uma)
export async function secoes(uf, opts) {
  const d = await json(url.secoes(uf), opts);
  const out = {};
  for (const a of d.abr || []) {
    for (const m of a.mu || []) {
      out[m.cd] = (m.zon || []).map((z) => ({
        zona: z.cd,
        secoes: (z.sec || []).map((s) => ({ ns: s.ns, recebida: s.ha ? `${s.da} ${s.ha}` : "" }))
      }));
    }
  }
  return out;
}
