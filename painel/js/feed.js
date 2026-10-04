// Feed publicado pelo coletor (coletor/coletor.mjs). Quando existe, o painel
// lê dele em vez de ir ao TSE: um arquivo por UF no lugar de centenas de
// arquivos municipais, placar a cada 15 s e zonas de cidades grandes que o
// navegador sozinho não daria conta de somar.
//
// Endereço: ?feed=<url> na página, ou ../feed/ ao lado do painel.

let base = null;

async function pedir(u, prazo = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), prazo);
  try {
    const r = await fetch(u, { cache: "no-cache", signal: ctrl.signal });
    if (!r.ok) {
      const e = new Error("HTTP " + r.status);
      e.status = r.status;
      throw e;
    }
    return r;
  } finally {
    clearTimeout(t);
  }
}

// Procura o feed e devolve o agora.json, ou null se não houver coletor.
export async function detectar() {
  const pedido = new URLSearchParams(location.search).get("feed");
  const opcoes = pedido ? [pedido] : ["../feed/"];
  for (const o of opcoes) {
    try {
      const u = new URL(o.endsWith("/") ? o : o + "/", location.href);
      const d = await (await pedir(new URL("agora.json", u), 6000)).json();
      if (d && d.versao && d.corridas) {
        base = u;
        return d;
      }
    } catch (_) { /* sem coletor nesse endereço */ }
  }
  return null;
}

export const ativo = () => !!base;
export const endereco = () => (base ? base.href : "");

export async function json(rel) {
  return (await pedir(new URL(rel, base))).json();
}

// Contador de pessoas online: um sinal a cada 15 s com um id aleatório da aba.
let id = null;
export async function vivo() {
  if (!base) return null;
  if (!id) {
    try { id = sessionStorage.getItem("painel.id"); } catch (_) { /* sem armazenamento */ }
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
      try { sessionStorage.setItem("painel.id", id); } catch (_) { /* sem armazenamento */ }
    }
  }
  try {
    const r = await fetch(new URL("../api/vivo", base), { method: "POST", body: id, cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return Number.isFinite(d.n) ? d.n : null;
  } catch (_) {
    return null;
  }
}

// Converte uma disputa do agora.json no formato de tse.lerResultado.
export function paraResultado(corrida, candidatos) {
  const validos = corrida.validos || 0;
  const cands = (candidatos || []).map((c, i) => ({
    n: c.n, sq: c.sq, nome: c.nome, completo: c.nome, partido: c.partido, npartido: "",
    federacao: "", coligacao: "", vices: (c.vices || []).map((v) => ({ tipo: "v", nome: v, partido: "" })),
    votos: corrida.votos[c.n] || 0,
    pct: validos ? (corrida.votos[c.n] || 0) / validos * 100 : 0,
    valido: true, destinacao: "Válido",
    eleito: /^eleito/i.test((corrida.situacao || {})[c.n] || ""),
    situacao: (corrida.situacao || {})[c.n] || "",
    seq: i
  }));
  cands.sort((a, b) => b.votos - a.votos || a.seq - b.seq);
  cands.forEach((c, i) => { c.pos = i + 1; });
  return {
    cargo: "", vagas: corrida.vagas || 1, data: corrida.data, hora: corrida.hora, gerado: corrida.gerado,
    secoes: { total: corrida.secoes, totalizadas: corrida.totalizadas, pct: corrida.secoes ? corrida.totalizadas / corrida.secoes * 100 : 0 },
    eleitorado: corrida.eleitorado, eleitoradoApurado: corrida.eleitoradoApurado,
    comparecimento: corrida.comparecimento, abstencao: corrida.abstencao,
    votos: { total: corrida.total, validos, brancos: corrida.brancos, nulos: corrida.nulos, legenda: 0, nominais: validos },
    cands,
    doColetor: true
  };
}

// Converte uf/<uf>-c<cargo>.json em linhas por município.
export function linhasDaUf(d) {
  const out = new Map();
  d.mun.forEach((cd, i) => {
    const votos = {};
    for (const [n, col] of Object.entries(d.votos)) if (col[i]) votos[n] = col[i];
    out.set(cd, {
      hora: d.hora[i], secoes: d.secoes[i], totalizadas: d.totalizadas[i],
      eleitorado: d.eleitorado[i], eleitoradoApurado: d.eleitoradoApurado[i],
      comparecimento: d.comparecimento[i], abstencao: d.abstencao[i],
      validos: d.validos[i], brancos: d.brancos[i], nulos: d.nulos[i], votos
    });
  });
  return out;
}
