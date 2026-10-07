// Leitura do Boletim de Urna (BU) publicado pelo TSE para cada seção.
// O arquivo -bu.dat é um envelope ASN.1/DER; dentro dele, um OCTET STRING traz
// o boletim propriamente dito com os totais por eleição, cargo e votável.
// Somar os BUs de uma cidade reproduz exatamente os totais oficiais do
// município, e permite abrir o resultado por zona, local de votação e seção.

import * as tse from "./tse.js";
import { url, json, bytes, fila } from "./tse.js";

// as eleições do turno configurado (os códigos mudam do 1º para o 2º turno)
const eleicoes = () => new Set([Number(tse.FEDERAL), Number(tse.ESTADUAL)]);

// ---------- DER mínimo ----------

function no(b, i) {
  const t = b[i++];
  const cls = t >> 6, cons = (t >> 5) & 1;
  let num = t & 31;
  if (num === 31) {
    num = 0;
    let x;
    do { x = b[i++]; num = num * 128 + (x & 127); } while (x & 128);
  }
  let len = b[i++];
  if (len & 128) {
    const n = len & 127;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + b[i++];
  }
  return { cls, cons, num, ini: i, fim: i + len };
}

function filhos(b, n) {
  const out = [];
  for (let i = n.ini; i < n.fim;) {
    const f = no(b, i);
    out.push(f);
    i = f.fim;
  }
  return out;
}

function inteiro(b, n) {
  let v = 0;
  for (let i = n.ini; i < n.fim; i++) v = v * 256 + b[i];
  if (n.fim > n.ini && b[n.ini] & 128) v -= 2 ** (8 * (n.fim - n.ini));
  return v;
}

const ehSeq = (n) => n.cls === 0 && n.num === 16 && n.cons;

// ---------- boletim ----------

// Tipos de voto do BU: 1 nominal, 2 branco, 3 nulo, 4 legenda
const TIPO = { 1: "nominal", 2: "branco", 3: "nulo", 4: "legenda" };

/**
 * Lê um BU e devolve
 * { zona, local, secao, aptos: {eleicao: n}, cargos: { cargo: {comparecimento, votos: {chave: n}} } }
 * onde a chave é o número do candidato, "branco", "nulo" ou "L<partido>" para legenda.
 */
export function lerBU(b) {
  const env = no(b, 0);
  const conteudo = filhos(b, env).find((f) => f.cls === 0 && f.num === 4);
  if (!conteudo) throw new Error("BU sem conteúdo");
  const bu = no(b, conteudo.ini);
  const partes = filhos(b, bu);

  const ident = partes.find((p) => ehSeq(p) && filhos(b, p).length >= 3 && ehSeq(filhos(b, p)[0]));
  const idf = filhos(b, ident);
  const [, zona] = filhos(b, idf[0]).map((x) => inteiro(b, x));
  const local = inteiro(b, idf[1]);
  const secao = inteiro(b, idf[idf.length - 1]);

  const out = { zona, local, secao, aptos: {}, cargos: {} };
  const ELEICOES = eleicoes();
  for (const p of partes) {
    if (!ehSeq(p)) continue;
    for (const porEleicao of filhos(b, p)) {
      if (!ehSeq(porEleicao)) break;
      const f = filhos(b, porEleicao);
      if (!f.length || f[0].num !== 2) break;
      const eleicao = inteiro(b, f[0]);
      if (!ELEICOES.has(eleicao)) break;
      out.aptos[eleicao] = inteiro(b, f[1]);
      for (const lista of f.filter(ehSeq)) {
        for (const rv of filhos(b, lista)) {
          const rf = filhos(b, rv);
          const comparecimento = inteiro(b, rf[1]);
          for (const tc of filhos(b, rf[2])) {
            const cf = filhos(b, tc);
            const cargo = String(inteiro(b, cf[0]));
            const alvo = (out.cargos[cargo] ||= { comparecimento, votos: {} });
            for (const vv of filhos(b, cf[2])) {
              const vf = filhos(b, vv);
              const tipo = TIPO[inteiro(b, vf[0])] || "outro";
              const qtd = inteiro(b, vf[1]);
              let codigo = null, partido = null;
              if (vf[2] && vf[2].cons && vf[2].cls === 2) {
                const id = filhos(b, vf[2]);
                partido = inteiro(b, id[0]);
                codigo = inteiro(b, id[1]);
              }
              const chave = tipo === "nominal" ? String(codigo)
                : tipo === "legenda" ? "L" + (partido ?? codigo)
                : tipo;
              alvo.votos[chave] = (alvo.votos[chave] || 0) + qtd;
            }
          }
        }
      }
    }
  }
  return out;
}

// ---------- apuração de uma cidade ----------

// Seção totalizada cujo boletim ainda não saiu (404) espera antes do próximo
// pedido: 90 s, depois o dobro a cada nova recusa, até 10 min. Sem isso, um
// lote com 1.500 seções nessa situação se repetia sem fim (na noite do 1º
// turno, a capital paulista ficou parada em 727 de 26.683 boletins das 21h43
// às 22h45), e o TSE pode bloquear o IP que acumula 404.
const ESPERA_404 = 90e3, ESPERA_MAX = 600e3;
// o boletim costuma sair alguns minutos depois de a seção chegar ao TSE
const IDADE_MINIMA = 60e3;
const chaveEspera = (s) => `${s.zona}/${s.ns}@${s.recebida}`;
// "dd/mm/aaaa hh:mm:ss" no horário de Brasília
export function horaRecebida(txt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/.exec(txt || "");
  return m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}-03:00`) : NaN;
}

/**
 * Escolhe até `limite` seções a baixar: as que ainda não estão no cache (ou
 * chegaram de novo), recebidas há pelo menos um minuto e fora da espera depois
 * de um 404; primeiro as nunca tentadas, das que chegaram antes às mais novas,
 * depois as que esperam há mais tempo.
 */
export function escolherPendentes(recebidas, cache, espera, limite = Infinity, agora = Date.now()) {
  const fila = [];
  for (const s of recebidas) {
    if (cache.get(`${s.zona}/${s.ns}`)?.recebida === s.recebida) continue;
    const e = espera.get(chaveEspera(s));
    if (e && e.ate > agora) continue;
    const quando = horaRecebida(s.recebida);
    if (agora - quando < IDADE_MINIMA) continue;
    fila.push([e ? e.ate : 0, Number.isFinite(quando) ? quando : 0, s]);
  }
  fila.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return fila.slice(0, limite).map(([, , s]) => s);
}

/**
 * Baixa e soma os BUs de todas as seções recebidas de um município.
 * `zonas` vem de tse.secoes(uf)[mun]. Seções já lidas (no `cache`) e sem nova
 * hora de recebimento não são baixadas de novo.
 *
 * O TSE totaliza a seção antes de publicar o boletim dela; enquanto o arquivo
 * não sai, o pedido volta 404 e a seção conta como "aguardando publicação".
 * Erros de rede ganham mais duas tentativas, com menos pedidos em paralelo.
 * Devolve { secoes, lidas, recebidas, aguardando, falhas, total, baixadas }.
 */
export async function apurarCidade(uf, mun, zonas, { cache = new Map(), signal, progresso, limite = Infinity, cargos = null } = {}) {
  const lista = [];
  for (const z of zonas) for (const s of z.secoes) lista.push({ zona: z.zona, ns: s.ns, recebida: s.recebida });
  const recebidas = lista.filter((s) => s.recebida);

  const ler = async (s) => {
    const aux = await json(url.auxSecao(uf, mun, s.zona, s.ns), { signal });
    for (const h of aux.hashes || []) {
      const arq = (h.arq || []).find((a) => a.tp === "bu");
      if (!arq) continue;
      const b = await bytes(url.arquivoSecao(uf, mun, s.zona, s.ns, h.hash, arq.nm), { signal });
      const bu = lerBU(b);
      // `cargos` poupa memória quando só alguns cargos interessam (o coletor
      // guarda dezenas de milhares de seções da capital paulista)
      if (cargos) for (const c of Object.keys(bu.cargos)) if (!cargos.includes(c)) delete bu.cargos[c];
      cache.set(`${s.zona}/${s.ns}`, { recebida: s.recebida, bu });
      return "ok";
    }
    return "sem-bu";
  };

  // `limite` deixa o coletor avançar cidades grandes aos poucos, publicando a cada lote
  const espera = (cache.espera ||= new Map());
  let pendentes = escolherPendentes(recebidas, cache, espera, limite);
  const total = pendentes.length;
  let feitos = 0, aguardando = 0;
  for (const n of [16, 6, 3]) {
    if (!pendentes.length || signal?.aborted) break;
    const r = await fila(pendentes, ler, {
      n, signal,
      progresso: () => progresso?.(Math.min(total, ++feitos), total)
    });
    const falhas = [];
    aguardando = 0;
    r.forEach((x, i) => {
      const k = chaveEspera(pendentes[i]);
      if (x === "sem-bu" || (x && x.erro && x.erro.status === 404)) {
        aguardando++;
        const n = (espera.get(k)?.n || 0) + 1;
        espera.set(k, { n, ate: Date.now() + Math.min(ESPERA_MAX, ESPERA_404 * 2 ** (n - 1)) });
      } else if (x && x.erro) falhas.push(pendentes[i]);
      else espera.delete(k);
    });
    feitos -= falhas.length;
    pendentes = falhas;
  }

  const secoes = [];
  for (const s of lista) {
    const c = cache.get(`${s.zona}/${s.ns}`);
    if (c) secoes.push(c.bu);
  }
  // aguardando: recebidas pelo TSE e ainda sem boletim lido (inclui as que esperam após um 404)
  aguardando = recebidas.filter((s) => cache.get(`${s.zona}/${s.ns}`)?.recebida !== s.recebida).length;
  return { secoes, lidas: secoes.length, recebidas: recebidas.length, aguardando, falhas: pendentes.length, total: lista.length, baixadas: total };
}

/**
 * O boletim registra como nominal o voto num número que saiu da disputa depois
 * da carga das urnas (candidatura cancelada ou renúncia); o TSE conta esse voto
 * como nulo técnico. Move para "nulo" os votos fora de `numeros` (candidatos e
 * legendas que o TSE lista) e tira esses votos dos válidos.
 */
export function nulosTecnicos(grupos, numeros) {
  return grupos.map((g) => {
    let fora = 0;
    for (const [k, v] of Object.entries(g.votos)) if (k !== "branco" && k !== "nulo" && k !== "outro" && !numeros.has(k)) fora += v;
    if (!fora) return g;
    const votos = {};
    for (const [k, v] of Object.entries(g.votos)) if (k === "branco" || k === "nulo" || k === "outro" || numeros.has(k)) votos[k] = v;
    votos.nulo = (votos.nulo || 0) + fora;
    return { ...g, votos, validos: g.validos - fora };
  });
}

/**
 * Agrupa as seções lidas por zona ou por local para um cargo.
 * Devolve [{chave, zona, local, secoes, comparecimento, validos, votos: {n: qtd}}]
 */
export function agrupar(secoes, cargo, por = "zona") {
  const grupos = new Map();
  for (const s of secoes) {
    const c = s.cargos[cargo];
    if (!c) continue;
    const chave = por === "local" ? `${s.zona}/${s.local}` : por === "secao" ? `${s.zona}/${s.secao}` : String(s.zona);
    let g = grupos.get(chave);
    if (!g) {
      g = { chave, zona: String(s.zona), local: String(s.local), secao: String(s.secao), secoes: 0, comparecimento: 0, validos: 0, votos: {} };
      grupos.set(chave, g);
    }
    g.secoes++;
    g.comparecimento += c.comparecimento;
    for (const [k, v] of Object.entries(c.votos)) {
      g.votos[k] = (g.votos[k] || 0) + v;
      if (k !== "branco" && k !== "nulo" && k !== "outro") g.validos += v;
    }
  }
  return [...grupos.values()];
}
