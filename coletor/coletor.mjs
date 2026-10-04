// Coletor da apuração em tempo real.
//
// Lê os arquivos de divulgação do TSE a cada poucos segundos e publica um feed
// de JSON pequenos, prontos para o painel, numa pasta servida por qualquer
// hospedagem estática ou CDN. Assim o público lê o feed, e só o coletor fala
// com o TSE.
//
//   node coletor/coletor.mjs --saida feed
//
// Arquivos publicados (ver coletor/LEIAME.md):
//   agora.json            placar de todas as disputas majoritárias, por UF
//   candidatos.json       nome, partido e foto de cada candidato
//   historico.json        evolução de cada disputa ao longo da apuração
//   eventos.json          últimas atualizações (seções, viradas, eleitos)
//   uf/<uf>-c<cargo>.json resultado de todos os municípios da UF, por coluna
//   zonas/<uf>-<mun>.json zonas e locais de votação somados dos boletins
//   arquivo/<HHMM>.json   placar de cada minuto, para rever a noite
//   estado.json           saúde do coletor

import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as tse from "../painel/js/tse.js";
import { apurarCidade, agrupar } from "../painel/js/bu.js";

// ---------- opções ----------

const args = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = args.indexOf("--" + nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : padrao;
};
const bandeira = (nome) => args.includes("--" + nome);

export const CONFIG = {
  saida: opcao("saida", "feed"),
  intervalo: Number(opcao("intervalo", 15)),
  // cargos com matriz por município; deputados pesam bem mais
  cargosMunicipais: opcao("municipios", "1,3,5").split(",").filter(Boolean),
  // cidades com zonas lidas dos boletins: "capitais", "nenhuma" ou lista uf:mun
  zonas: opcao("zonas", "capitais"),
  // cargos guardados por seção nas zonas; deputados multiplicam a memória
  cargosZonas: opcao("zonas-cargos", "1,3,5").split(",").filter(Boolean),
  paralelo: Number(opcao("paralelo", 12)),
  umaVez: bandeira("uma-vez")
};

const UFS = tse.UFS.map(([cd]) => cd);
const MAJORITARIOS = [["1", ["br", ...UFS, "zz"]], ["3", UFS], ["5", UFS]];

// ---------- estado ----------

const estado = {
  corridas: new Map(),   // "cargo-uf" -> resultado normalizado
  historico: {},         // "cargo-uf" -> [[hora, % seções, {n: votos}]]
  eventos: [],
  candidatos: {},        // "cargo-uf" -> [{n, nome, partido, sq}]
  municipal: new Map(),  // "cargo-uf" -> Map(mun -> linha)
  zonas: new Map(),      // "uf-mun" -> {cache, res, proxima}
  secoes: new Map(),     // uf -> {quando, dados}
  arquivados: new Set(),
  saude: { iniciado: new Date().toISOString(), ciclos: 0, pedidos: 0, falhas: 0, ultimaLeitura: null, ultimoErro: null }
};

// ---------- utilidades ----------

const agoraBrasilia = () => new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour12: false });
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chave = (cargo, uf) => `${cargo}-${uf}`;

async function gravar(rel, dados) {
  const destino = join(CONFIG.saida, rel);
  await mkdir(join(destino, ".."), { recursive: true });
  const tmp = destino + ".tmp";
  await writeFile(tmp, JSON.stringify(dados));
  await rename(tmp, destino);
}

async function lerJsonLocal(rel, padrao) {
  try {
    return JSON.parse(await readFile(join(CONFIG.saida, rel), "utf8"));
  } catch (_) {
    return padrao;
  }
}

async function pedir(u) {
  estado.saude.pedidos++;
  try {
    return await tse.json(u);
  } catch (e) {
    if (e.status !== 404) estado.saude.falhas++;
    throw e;
  }
}

// ---------- validação ----------

// Descarta arquivos incoerentes; o último resultado bom continua publicado.
export function valido(r) {
  if (!r || !r.cands) return false;
  const v = r.votos;
  const nums = [r.secoes.total, r.secoes.totalizadas, r.comparecimento, v.total, v.validos, v.brancos, v.nulos];
  if (nums.some((x) => !Number.isFinite(x) || x < 0)) return false;
  if (r.secoes.totalizadas > r.secoes.total) return false;
  const nominais = r.cands.reduce((s, c) => s + c.votos, 0);
  if (nominais > v.validos + v.legenda + 1 && nominais > v.total) return false;
  if (v.validos + v.brancos + v.nulos > v.total + 1) return false;
  return true;
}

// ---------- disputas majoritárias ----------

function resumo(r) {
  const votos = {}, situacao = {};
  for (const c of r.cands) {
    votos[c.n] = c.votos;
    if (c.situacao || c.eleito) situacao[c.n] = c.situacao || "Eleito";
  }
  return {
    secoes: r.secoes.total, totalizadas: r.secoes.totalizadas,
    eleitorado: r.eleitorado, eleitoradoApurado: r.eleitoradoApurado,
    comparecimento: r.comparecimento, abstencao: r.abstencao,
    total: r.votos.total, validos: r.votos.validos, brancos: r.votos.brancos, nulos: r.votos.nulos,
    data: r.data, hora: r.hora, gerado: r.gerado, vagas: r.vagas,
    votos, situacao
  };
}

async function lerMajoritarios() {
  const pedidos = [];
  for (const [cargo, ufs] of MAJORITARIOS) for (const uf of ufs) pedidos.push({ cargo, uf });
  const novos = new Map();
  await tse.fila(pedidos, async ({ cargo, uf }) => {
    const r = tse.lerResultado(await pedir(tse.url.resultado(cargo, uf)));
    if (valido(r)) novos.set(chave(cargo, uf), r);
  }, { n: CONFIG.paralelo });

  // o arquivo nacional atrasa em relação aos estaduais: soma de baixo para cima
  const br = novos.get("1-br") || estado.corridas.get("1-br");
  const partes = ["zz", ...UFS].map((uf) => novos.get(chave("1", uf)) || estado.corridas.get(chave("1", uf))).filter(Boolean);
  if (br && partes.length === UFS.length + 1 && partes.some((p) => tse.geracao(p) > tse.geracao(br))) {
    novos.set("1-br", tse.somarResultados(br, partes));
  }

  for (const [k, r] of novos) {
    const antes = estado.corridas.get(k);
    if (antes && tse.geracao(r) < tse.geracao(antes)) continue; // nunca volta no tempo
    detectarEventos(k, antes, r);
    estado.corridas.set(k, r);
    registrarHistorico(k, antes, r);
    if (!estado.candidatos[k] || estado.candidatos[k].length !== r.cands.length) {
      estado.candidatos[k] = r.cands.map((c) => ({ n: c.n, nome: c.nome, partido: c.partido, sq: c.sq, vices: c.vices.map((v) => v.nome) }));
    }
  }
  return novos.size;
}

// artigo de cada UF, para "no Acre", "na Bahia", "em São Paulo"
const ARTIGO = { ac: "o", ap: "o", am: "o", ce: "o", df: "o", es: "o", ma: "o", pa: "o", pr: "o", pi: "o", rj: "o", rn: "o", rs: "o", to: "o", ba: "a", pb: "a" };
const comArtigo = (uf, { o, a, nada }) => `${{ o, a }[ARTIGO[uf]] || nada} ${tse.NOME_UF[uf]}`;
const em = (uf) => (uf === "br" ? "no Brasil" : uf === "zz" ? "no exterior" : comArtigo(uf, { o: "no", a: "na", nada: "em" }));
const de = (uf) => comArtigo(uf, { o: "do", a: "da", nada: "de" });
const por = (uf) => comArtigo(uf, { o: "pelo", a: "pela", nada: "por" });

// a disputa em palavras, sem supor o gênero de quem concorre
function disputa(cargo, uf) {
  if (cargo === "1") return uf === "br" ? "a Presidência" : `a Presidência ${em(uf)}`;
  if (cargo === "3") return `o governo ${de(uf)}`;
  return `o Senado ${por(uf)}`;
}

export function textoEvento(e, nomeDe) {
  const nome = nomeDe(e.n);
  if (e.tipo === "eleito") {
    if (e.cargo === "5") return `${nome} conquista uma vaga no Senado ${por(e.uf)}.`;
    if (e.cargo === "3") return `${nome} vence a eleição para o governo ${de(e.uf)}.`;
    return `${nome} vence a eleição presidencial.`;
  }
  if (e.tipo === "segundo-turno") return `${nome} vai ao 2º turno na disputa pel${disputa(e.cargo, e.uf).startsWith("a ") ? "a" : "o"} ${disputa(e.cargo, e.uf).slice(2)}.`;
  if (e.tipo === "virada") return `${nome} passa ${nomeDe(e.antes)} e assume a liderança na disputa pel${disputa(e.cargo, e.uf).startsWith("a ") ? "a" : "o"} ${disputa(e.cargo, e.uf).slice(2)}.`;
  if (e.tipo === "concluida") return `A apuração ${{ 1: "de presidente", 3: "de governador", 5: "do Senado" }[e.cargo]} ${em(e.uf)} chega a 100% das seções.`;
  return e.texto;
}

function evento(e, nomeDe) {
  const completo = { t: agoraBrasilia(), ...e };
  completo.texto = textoEvento(completo, nomeDe);
  estado.eventos.unshift(completo);
  estado.eventos.length = Math.min(estado.eventos.length, 300);
}

export const eventos = () => estado.eventos;

export function detectarEventos(k, antes, r) {
  const [cargo, uf] = k.split("-");
  const [a, b] = r.cands;
  if (!antes || !a) return;
  const [a0] = antes.cands;
  const nomeDe = (n) => (r.cands.find((c) => c.n === n) || {}).nome || n;

  // situação nova: eleito ou segundo turno
  for (const c of r.cands) {
    const s0 = (antes.cands.find((x) => x.n === c.n) || {}).situacao || "";
    if (c.situacao && c.situacao !== s0) {
      const st = c.situacao.toLowerCase();
      if (st.startsWith("eleit")) evento({ tipo: "eleito", cargo, uf, n: c.n }, nomeDe);
      else if (st.includes("turno")) evento({ tipo: "segundo-turno", cargo, uf, n: c.n }, nomeDe);
    }
  }
  // virada na liderança (só com votos de verdade em jogo)
  if (a0 && a.n !== a0.n && a.votos > 0 && antes.votos.validos > 0) {
    evento({ tipo: "virada", cargo, uf, n: a.n, antes: a0.n }, nomeDe);
  }
  // avanço da apuração no placar nacional de presidente
  const mais = r.secoes.totalizadas - antes.secoes.totalizadas;
  if (k === "1-br" && mais > 0 && b) {
    evento({
      tipo: "secoes", cargo, uf, secoes: mais,
      lider: [a.n, +a.pct.toFixed(2)], segundo: [b.n, +b.pct.toFixed(2)],
      texto: `+${mais.toLocaleString("pt-BR")} seções: ${a.nome} ${a.pct.toFixed(1).replace(".", ",")}%, ${b.nome} ${b.pct.toFixed(1).replace(".", ",")}%.`
    }, nomeDe);
  }
  // disputa chega a 100%
  if (antes.secoes.pct < 100 && r.secoes.pct >= 100) {
    evento({ tipo: "concluida", cargo, uf }, nomeDe);
  }
}

function registrarHistorico(k, antes, r) {
  const serie = (estado.historico[k] ||= []);
  const ultimo = serie[serie.length - 1];
  if (ultimo && ultimo[1] === +r.secoes.pct.toFixed(2)) return;
  // guarda os 6 mais votados de cada ponto; o resto não muda a leitura
  const votos = {};
  for (const c of r.cands.slice(0, 6)) votos[c.n] = c.votos;
  serie.push([r.hora, +r.secoes.pct.toFixed(2), votos, r.votos.validos]);
}

// ---------- matriz por município ----------

function linhaMun(r) {
  const votos = {};
  for (const c of r.cands) if (c.votos) votos[c.n] = c.votos;
  return {
    hora: r.hora, secoes: r.secoes.total, totalizadas: r.secoes.totalizadas,
    eleitorado: r.eleitorado, eleitoradoApurado: r.eleitoradoApurado,
    comparecimento: r.comparecimento, abstencao: r.abstencao,
    validos: r.votos.validos, brancos: r.votos.brancos, nulos: r.votos.nulos, votos
  };
}

let municipios = null;

// Percorre as UFs pelo índice de andamento e baixa só os municípios cuja hora
// de totalização mudou. `limite` evita que um ciclo estoure o intervalo.
export async function lerMunicipios(limite = 1500) {
  municipios ||= await tse.municipios();
  const tarefas = [];
  const ufsMudadas = new Set();
  for (const cargo of CONFIG.cargosMunicipais) {
    const def = tse.cargoDef(cargo);
    const ufs = def.nacional ? [...UFS, "zz"] : UFS;
    await tse.fila(ufs, async (uf) => {
      const and = await tse.andamento(def.ele, uf);
      const mapa = estado.municipal.get(chave(cargo, uf)) || new Map();
      estado.municipal.set(chave(cargo, uf), mapa);
      // o índice de andamento sai antes do arquivo de resultado: enquanto o
      // arquivo do município estiver atrás do índice, ele volta para a fila
      for (const m of municipios[uf] || []) {
        const a = and[m.cd];
        const lido = mapa.get(m.cd);
        if (!lido || (a && lido.hora < a.hora.split(" ")[1])) tarefas.push({ cargo, uf, mun: m.cd });
      }
    }, { n: 6 });
  }
  const lote = tarefas.slice(0, limite);
  await tse.fila(lote, async ({ cargo, uf, mun }) => {
    const r = tse.lerResultado(await pedir(tse.url.resultado(cargo, uf, mun)));
    if (!valido(r)) return;
    estado.municipal.get(chave(cargo, uf)).set(mun, linhaMun(r));
    ufsMudadas.add(chave(cargo, uf));
  }, { n: CONFIG.paralelo });
  for (const k of ufsMudadas) await gravarUf(k);
  return { pendentes: tarefas.length - lote.length, lidos: lote.length };
}

// Uma UF por arquivo, em colunas: listas alinhadas pelos municípios.
async function gravarUf(k) {
  const [cargo, uf] = k.split("-");
  const mapa = estado.municipal.get(k);
  const muns = [...mapa.keys()].sort();
  const col = (f) => muns.map((m) => f(mapa.get(m)));
  const nums = new Set();
  for (const m of muns) for (const n of Object.keys(mapa.get(m).votos)) nums.add(n);
  const votos = {};
  for (const n of nums) votos[n] = col((l) => l.votos[n] || 0);
  await gravar(`uf/${uf}-c${cargo}.json`, {
    versao: 1, gerado: new Date().toISOString(), cargo, uf, mun: muns,
    hora: col((l) => l.hora), secoes: col((l) => l.secoes), totalizadas: col((l) => l.totalizadas),
    eleitorado: col((l) => l.eleitorado), eleitoradoApurado: col((l) => l.eleitoradoApurado),
    comparecimento: col((l) => l.comparecimento), abstencao: col((l) => l.abstencao),
    validos: col((l) => l.validos), brancos: col((l) => l.brancos), nulos: col((l) => l.nulos), votos
  });
}

// ---------- zonas pelos boletins de urna ----------

function cidadesComZonas() {
  if (CONFIG.zonas === "nenhuma" || !municipios) return [];
  if (CONFIG.zonas === "capitais") {
    const out = [];
    for (const uf of UFS) for (const m of municipios[uf] || []) if (m.capital) out.push({ uf, mun: m.cd });
    return out;
  }
  return CONFIG.zonas.split(",").map((x) => { const [uf, mun] = x.split(":"); return { uf, mun }; });
}

async function secoesDaUf(uf) {
  const s = estado.secoes.get(uf);
  if (s && Date.now() - s.quando < 180e3) return s.dados;
  const dados = await tse.secoes(uf);
  estado.secoes.set(uf, { quando: Date.now(), dados });
  return dados;
}

// Lê os boletins novos de cada cidade configurada, em lotes: cada passada
// avança até 1.500 seções por cidade e publica o parcial, para a capital
// paulista (26.696 seções) não segurar as outras nem ficar sem nada no ar.
const LOTE_ZONAS = 1500;
export async function lerZonas() {
  let pendente = false;
  for (const { uf, mun } of cidadesComZonas()) {
    const z = estado.zonas.get(`${uf}-${mun}`) || { cache: new Map(), proxima: 0 };
    estado.zonas.set(`${uf}-${mun}`, z);
    if (Date.now() < z.proxima) continue;
    try {
      const zonas = (await secoesDaUf(uf))[mun];
      if (!zonas) continue;
      const cargos = CONFIG.cargosZonas.flatMap((c) => (c === "7" ? ["7", "8"] : [c]));
      const res = await apurarCidade(uf, mun, zonas, { cache: z.cache, limite: LOTE_ZONAS, cargos });
      z.res = res;
      // cidade completa (ou só com boletins ainda não publicados): volta em 1 min
      const completa = res.baixadas < LOTE_ZONAS;
      z.proxima = completa ? Date.now() + 60e3 : 0;
      pendente ||= !completa;
      await gravarZonas(uf, mun, res);
      console.log(`[${agoraBrasilia()}] zonas ${uf}-${mun}: ${res.lidas} de ${res.recebidas} boletins`);
    } catch (e) {
      estado.saude.ultimoErro = `zonas ${uf}-${mun}: ${e.message}`;
    }
  }
  return pendente;
}

async function gravarZonas(uf, mun, res) {
  const cargos = {};
  for (const cargo of ["1", "3", "5", "6", uf === "df" ? "8" : "7"]) {
    const enxuto = (g) => ({ zona: g.zona, local: g.local, secoes: g.secoes, comparecimento: g.comparecimento, validos: g.validos, votos: g.votos });
    const zonas = agrupar(res.secoes, cargo, "zona").map(enxuto);
    if (!zonas.length) continue;
    cargos[cargo] = { zonas, locais: agrupar(res.secoes, cargo, "local").map(enxuto) };
  }
  await gravar(`zonas/${uf}-${mun}.json`, {
    versao: 1, gerado: new Date().toISOString(), uf, mun,
    lidas: res.lidas, recebidas: res.recebidas, total: res.total, aguardando: res.aguardando, cargos
  });
}

// ---------- publicação ----------

async function publicar() {
  const corridas = {};
  for (const [k, r] of estado.corridas) {
    const [cargo, uf] = k.split("-");
    (corridas[cargo] ||= {})[uf] = resumo(r);
  }
  const br = estado.corridas.get("1-br");
  const seq = Math.floor(Date.now() / 1000);
  const agora = { versao: 1, seq, gerado: new Date().toISOString(), hora: agoraBrasilia(), turno: 1, totalizado: br ? br.hora : null, corridas };
  await gravar("agora.json", agora);
  await gravar("candidatos.json", { versao: 1, candidatos: estado.candidatos });
  await gravar("historico.json", { versao: 1, seq, series: estado.historico });
  await gravar("eventos.json", { versao: 1, seq, eventos: estado.eventos.slice(0, 120) });

  // um retrato por minuto para rever a noite
  const minuto = agoraBrasilia().slice(0, 5).replace(":", "");
  if (!estado.arquivados.has(minuto)) {
    estado.arquivados.add(minuto);
    await gravar(`arquivo/${minuto}.json`, agora);
    await gravar("arquivo/indice.json", { versao: 1, minutos: [...estado.arquivados].sort() });
  }
}

async function publicarSaude() {
  const zonas = {};
  for (const [k, z] of estado.zonas) if (z.res) zonas[k] = { lidas: z.res.lidas, recebidas: z.res.recebidas };
  await gravar("estado.json", { ...estado.saude, zonas, config: { ...CONFIG } });
}

// ---------- ciclos ----------

// Três laços independentes, para a leitura lenta das zonas da capital paulista
// nunca atrasar o placar: placar a cada `intervalo`, municípios em seguida um
// do outro e zonas cidade a cidade.

export async function cicloPlacar() {
  const t0 = Date.now();
  const lidas = await lerMajoritarios();
  await publicar();
  estado.saude.ciclos++;
  estado.saude.ultimaLeitura = new Date().toISOString();
  estado.saude.ultimoCicloMs = Date.now() - t0;
  estado.saude.disputas = lidas;
  await publicarSaude();
  return Date.now() - t0;
}

async function laco(nome, passo, pausa) {
  let falhas = 0;
  for (;;) {
    let espera = pausa();
    try {
      const ms = await passo();
      falhas = 0;
      espera = Math.max(1000, espera - ms);
    } catch (e) {
      falhas++;
      estado.saude.ultimoErro = `${nome}: ${e.message}`;
      espera = Math.min(60e3, 5e3 * 2 ** (falhas - 1));
      console.error(`[${agoraBrasilia()}] ${nome} falhou: ${e.message}; nova tentativa em ${Math.round(espera / 1000)} s`);
    }
    if (CONFIG.umaVez) return;
    await dormir(espera);
  }
}

async function retomar() {
  // reaproveita histórico e eventos de uma execução anterior na mesma pasta
  const h = await lerJsonLocal("historico.json", null);
  if (h && h.series) estado.historico = h.series;
  const ev = await lerJsonLocal("eventos.json", null);
  if (ev && ev.eventos) estado.eventos = ev.eventos;
  const idx = await lerJsonLocal("arquivo/indice.json", null);
  if (idx && idx.minutos) idx.minutos.forEach((m) => estado.arquivados.add(m));
}

export async function iniciar() {
  await mkdir(CONFIG.saida, { recursive: true });
  await retomar();
  const jitter = () => CONFIG.intervalo * 1000 * (0.8 + Math.random() * 0.4);
  const lacos = [
    laco("placar", async () => {
      const ms = await cicloPlacar();
      console.log(`[${agoraBrasilia()}] placar em ${ms} ms · ${estado.eventos.length} eventos`);
      return ms;
    }, jitter)
  ];
  if (CONFIG.cargosMunicipais.length) {
    lacos.push(laco("municípios", async () => {
      const t0 = Date.now();
      const r = await lerMunicipios();
      estado.saude.municipiosLidos = (estado.saude.municipiosLidos || 0) + r.lidos;
      estado.saude.municipiosPendentes = r.pendentes;
      if (r.lidos) console.log(`[${agoraBrasilia()}] municípios: ${r.lidos} lidos, ${r.pendentes} na fila`);
      return Date.now() - t0;
    }, jitter));
  }
  if (CONFIG.zonas !== "nenhuma") {
    let continuar = false;
    lacos.push(laco("zonas", async () => {
      const t0 = Date.now();
      municipios ||= await tse.municipios();
      continuar = await lerZonas();
      return Date.now() - t0;
    }, () => (continuar ? 1000 : 30e3)));
  }
  await Promise.all(lacos);
}

if (import.meta.url === `file://${process.argv[1]}`) iniciar();
