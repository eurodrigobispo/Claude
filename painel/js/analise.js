import { titulo } from "./tse.js";

// Métricas e leitura estratégica de um candidato sobre a matriz de municípios.
// Tudo é calculado a partir de percentuais, então funciona com a apuração
// parcial; contagens absolutas só fecham quando a apuração chega a 100%.

const fmt = new Intl.NumberFormat("pt-BR");
const pctTxt = (v, casas = 1) => (Number.isFinite(v) ? v.toFixed(casas).replace(".", ",") + "%" : "—");
const pp = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1).replace(".", ",") + " p.p.";

export const FAIXAS = [
  { rotulo: "Até 10 mil eleitores", max: 1e4 },
  { rotulo: "10 a 50 mil", max: 5e4 },
  { rotulo: "50 a 200 mil", max: 2e5 },
  { rotulo: "Acima de 200 mil", max: Infinity }
];

/**
 * linhas: [{cd, nome, capital, eleitorado, abstencao, comparecimento, validos, votos, pos, lider, liderVotos, secoesPct}]
 * uma por município com resultado lido, para o candidato escolhido.
 */
export function perfil(linhas) {
  const comDados = linhas.filter((l) => l.validos > 0);
  const votos = comDados.reduce((s, l) => s + l.votos, 0);
  const validos = comDados.reduce((s, l) => s + l.validos, 0);
  const media = validos ? votos / validos * 100 : 0;

  const porVotos = comDados.slice().sort((a, b) => b.votos - a.votos);
  let acum = 0, para50 = 0;
  for (const l of porVotos) {
    acum += l.votos;
    para50++;
    if (acum >= votos / 2) break;
  }
  const top10 = porVotos.slice(0, 10).reduce((s, l) => s + l.votos, 0);
  const capital = comDados.find((l) => l.capital);

  const lidera = comDados.filter((l) => l.pos === 1);
  const eleitoradoTotal = comDados.reduce((s, l) => s + l.eleitorado, 0);
  const eleitoradoLidera = lidera.reduce((s, l) => s + l.eleitorado, 0);

  const faixas = FAIXAS.map((f, i) => {
    const min = i ? FAIXAS[i - 1].max : 0;
    const g = comDados.filter((l) => l.eleitorado > min && l.eleitorado <= f.max);
    const v = g.reduce((s, l) => s + l.votos, 0), val = g.reduce((s, l) => s + l.validos, 0);
    return { rotulo: f.rotulo, municipios: g.length, votos: v, validos: val, pct: val ? v / val * 100 : NaN, peso: votos ? v / votos * 100 : 0 };
  });

  // redutos: maior % entre municípios com eleitorado relevante para o recorte
  const corte = Math.max(2000, percentil(comDados.map((l) => l.eleitorado), 0.25));
  const comPct = comDados.map((l) => ({ ...l, pct: l.votos / l.validos * 100 }));
  const fortes = comPct.filter((l) => l.eleitorado >= corte).sort((a, b) => b.pct - a.pct).slice(0, 8);
  const grandes = comPct.slice().sort((a, b) => b.eleitorado - a.eleitorado).slice(0, 30);
  const fracos = grandes.filter((l) => l.pct < media).sort((a, b) => (a.pct - media) * a.eleitorado - (b.pct - media) * b.eleitorado).slice(0, 6);

  // onde há voto a buscar: muito eleitor, desempenho abaixo da média e abstenção alta
  const apurado = (l) => l.eleitoradoApurado || l.eleitorado;
  const baseAbst = comDados.reduce((s, l) => s + apurado(l), 0);
  const abstMedia = baseAbst ? comDados.reduce((s, l) => s + l.abstencao, 0) / baseAbst * 100 : 0;
  const oportunidades = comPct
    .filter((l) => l.pct < media && apurado(l) && l.abstencao / apurado(l) * 100 > abstMedia)
    .map((l) => ({ ...l, potencial: (media - l.pct) / 100 * l.validos }))
    .sort((a, b) => b.potencial - a.potencial)
    .slice(0, 6);

  return {
    municipios: comDados.length,
    votos, validos, media,
    para50, top10Pct: votos ? top10 / votos * 100 : 0,
    capital: capital ? { nome: capital.nome, peso: votos ? capital.votos / votos * 100 : 0, pct: capital.votos / capital.validos * 100 } : null,
    lidera: lidera.length,
    eleitoradoLideraPct: eleitoradoTotal ? eleitoradoLidera / eleitoradoTotal * 100 : 0,
    faixas, fortes, fracos, oportunidades,
    maiores: porVotos.slice(0, 8).map((l) => ({ ...l, pct: l.votos / l.validos * 100, peso: l.votos / votos * 100 })),
    abstMedia
  };
}

function percentil(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function pearson(xs, ys, ws) {
  let sw = 0, mx = 0, my = 0;
  for (let i = 0; i < xs.length; i++) { sw += ws[i]; mx += xs[i] * ws[i]; my += ys[i] * ws[i]; }
  if (!sw) return NaN;
  mx /= sw; my /= sw;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += ws[i] * dx * dy; vx += ws[i] * dx * dx; vy += ws[i] * dy * dy;
  }
  return vx && vy ? cov / Math.sqrt(vx * vy) : NaN;
}

// ---------- 2022 ----------

/**
 * Soma 2022 por município: { mun: {validos, votos: {n: qtd}} } para um cargo/turno.
 */
export function municipios2022(hist, cargo, turno = "t1") {
  const b = hist && hist.cargos && hist.cargos[cargo] && hist.cargos[cargo][turno];
  if (!b) return null;
  const out = {};
  for (const [mun, zonas] of Object.entries(b.mun)) {
    const m = (out[mun] = { validos: 0, votos: {}, zonas: {} });
    for (const [z, votos] of Object.entries(zonas)) {
      let vz = 0;
      for (const [n, q] of Object.entries(votos)) {
        m.votos[n] = (m.votos[n] || 0) + q;
        m.validos += q;
        vz += q;
      }
      m.zonas[z] = { validos: vz, votos };
    }
  }
  return { cand: b.cand, mun: out };
}

// Partidos de 2022 que mudaram de nome ou se fundiram até 2026. O número sozinho
// não basta: o 14 do PTB, por exemplo, hoje é do MISSÃO, que não o sucede.
const SUCESSOR = { PMN: "MOBILIZA", PMB: "DEMOCRATA", PSC: "PODE", PTB: "PRD", PATRIOTA: "PRD", PROS: "SOLIDARIEDADE" };

/**
 * Escolhe a referência de 2022 para um candidato de 2026, sempre do mesmo
 * partido: o mesmo número no mesmo cargo (nos majoritários, o do partido) ou o
 * candidato do partido com mais votos; só sem nenhum dos dois, o partido que
 * ele sucedeu (com o mesmo número ou o mais votado).
 */
export function referencia2022(cand, base) {
  if (!base) return null;
  const tot = (n) => Object.values(base.mun).reduce((s, m) => s + (m.votos[n] || 0), 0);
  const escolher = (filtro, regra) => {
    const igual = base.cand[cand.n];
    if (igual && filtro(igual[1])) return { n: cand.n, nome: titulo(igual[0]), partido: igual[1], criterio: regra(igual[1], "mesmo número") };
    const lista = Object.entries(base.cand).filter(([, [, sg]]) => filtro(sg)).sort((a, b) => tot(b[0]) - tot(a[0]));
    if (!lista.length) return null;
    const [n, [nome, partido]] = lista[0];
    return { n, nome: titulo(nome), partido, criterio: regra(partido, "mesmo partido") };
  };
  return escolher((sg) => sg === cand.partido, (_, r) => r) ||
    escolher((sg) => SUCESSOR[sg] === cand.partido, (sg) => `${cand.partido} sucede o ${sg}`);
}

/**
 * Compara a votação por município com a referência de 2022.
 * Devolve { ref, pct22, pct26, delta, correlacao, ganhos: [...], perdas: [...], porMun: {mun: delta} }
 */
export function comparar(linhas, base, ref, { fator = 1 } = {}) {
  if (!base || !ref) return null;
  const xs = [], ys = [], ws = [];
  const itens = [];
  let v22 = 0, val22 = 0, v26 = 0, val26 = 0;
  for (const l of linhas) {
    const m = base.mun[l.cd];
    if (!m || !m.validos || !l.validos) continue;
    const p22 = (m.votos[ref.n] || 0) / m.validos * 100;
    // `fator`: vagas de 2026 por vaga de 2022 (Senado: 2), para comparar a
    // fatia do eleitorado e não votos que valem metade
    const p26 = l.votos / l.validos * 100 * fator;
    xs.push(p22); ys.push(p26); ws.push(l.validos);
    v22 += m.votos[ref.n] || 0; val22 += m.validos;
    v26 += l.votos * fator; val26 += l.validos;
    itens.push({ ...l, p22, p26, delta: p26 - p22, impacto: (p26 - p22) / 100 * l.validos });
  }
  if (!itens.length) return null;
  const porImpacto = itens.slice().sort((a, b) => b.impacto - a.impacto);
  return {
    ref,
    pct22: val22 ? v22 / val22 * 100 : NaN,
    pct26: val26 ? v26 / val26 * 100 : NaN,
    delta: (val26 ? v26 / val26 * 100 : 0) - (val22 ? v22 / val22 * 100 : 0),
    correlacao: pearson(xs, ys, ws),
    ganhos: porImpacto.filter((i) => i.delta > 0).slice(0, 6),
    perdas: porImpacto.filter((i) => i.delta < 0).reverse().slice(0, 6),
    porMun: Object.fromEntries(itens.map((i) => [i.cd, i.delta])),
    municipios: itens.length
  };
}

// ---------- leitura estratégica ----------

export function leitura({ cand, perfil: p, comp, andamento, segundoTurno = false, senado = false, unidade = "municípios" }) {
  const out = [];
  const sing = unidade === "estados" ? "estado" : "município";
  if (!p || !p.municipios) return out;
  if (!p.votos) {
    out.push({ titulo: "Sem votos", texto: `Ainda não tem votos nos ${unidade} apurados deste recorte.`, tom: "neutro" });
    return out;
  }
  const parcial = andamento < 100;

  out.push({
    titulo: "Tamanho e alcance",
    texto: `${pctTxt(p.media)} dos votos válidos no recorte. Lidera em ${fmt.format(p.lidera)} de ${fmt.format(p.municipios)} ${unidade}, que somam ${pctTxt(p.eleitoradoLideraPct)} do eleitorado.`,
    tom: p.lidera / p.municipios > 0.5 ? "pos" : "neutro"
  });

  const concentrado = p.top10Pct > 50 || p.para50 <= Math.max(3, p.municipios * 0.03);
  out.push({
    titulo: concentrado ? "Base concentrada" : "Base espalhada",
    texto: `Metade dos votos vem de ${fmt.format(p.para50)} ${p.para50 > 1 ? unidade : sing}; os 10 maiores respondem por ${pctTxt(p.top10Pct)} da votação.` +
      (p.capital ? ` A capital, ${p.capital.nome}, pesa ${pctTxt(p.capital.peso)} do total, com ${pctTxt(p.capital.pct)} dos válidos lá.` : ""),
    tom: "neutro"
  });

  const pequenos = p.faixas[0], grandes = p.faixas[p.faixas.length - 1];
  if (unidade !== "estados" && Number.isFinite(pequenos.pct) && Number.isFinite(grandes.pct)) {
    const dif = pequenos.pct - grandes.pct;
    if (Math.abs(dif) >= 3) {
      out.push({
        titulo: dif > 0 ? "Perfil de interior" : "Perfil urbano",
        texto: `Faz ${pctTxt(pequenos.pct)} nos municípios até 10 mil eleitores e ${pctTxt(grandes.pct)} nos acima de 200 mil (${Math.abs(dif).toFixed(1).replace(".", ",")} p.p. a favor dos ${dif > 0 ? "pequenos" : "grandes"}).`,
        tom: "neutro"
      });
    }
  }

  if (p.fracos.length) {
    const nomes = p.fracos.slice(0, 3).map((l) => `${l.nome} (${pctTxt(l.pct)})`).join(", ");
    out.push({
      titulo: "Onde perde terreno",
      texto: `Entre os maiores colégios, fica abaixo da própria média em ${nomes}.`,
      tom: "neg"
    });
  }

  if (p.oportunidades.length) {
    const tot = p.oportunidades.reduce((s, l) => s + l.potencial, 0);
    out.push({
      titulo: "Voto a conquistar",
      texto: `Se igualasse a própria média em ${p.oportunidades.slice(0, 3).map((l) => l.nome).join(", ")} e outros ${unidade} de abstenção alta onde está abaixo dela, somaria cerca de ${fmt.format(Math.round(tot))} votos.`,
      tom: "pos"
    });
  }

  if (comp) {
    const herda = comp.correlacao;
    const rotuloHeranca = herda >= 0.8 ? "herdou quase integralmente o mapa" : herda >= 0.5 ? "herdou boa parte do mapa" : herda >= 0.2 ? "herdou pouco do mapa" : "não segue o mapa";
    out.push({
      titulo: "Comparação com 2022",
      texto: `Contra ${comp.ref.nome} (${comp.ref.partido}, ${comp.ref.criterio}): ${pctTxt(comp.pct26)} agora contra ${pctTxt(comp.pct22)} em 2022 nos mesmos ${unidade} (${pp(comp.delta)}). ` +
        (senado ? "Como 2026 elege dois senadores e 2022 elegeu um, o percentual de agora é sobre metade dos válidos, a fatia do eleitorado. " : "") +
        `Correlação geográfica de ${Number.isFinite(herda) ? herda.toFixed(2).replace(".", ",") : "—"}: ${rotuloHeranca} de 2022.`,
      tom: comp.delta >= 0 ? "pos" : "neg"
    });
    if (comp.ganhos.length) {
      out.push({
        titulo: "Maiores avanços",
        texto: comp.ganhos.slice(0, 3).map((g) => `${g.nome} ${pp(g.delta)}`).join(" · "),
        tom: "pos"
      });
    }
    if (comp.perdas.length) {
      out.push({
        titulo: "Maiores recuos",
        texto: comp.perdas.slice(0, 3).map((g) => `${g.nome} ${pp(g.delta)}`).join(" · "),
        tom: "neg"
      });
    }
  }

  // só no nível da disputa (Brasil para Presidente, estado para Governador),
  // no 1º turno, e quando ninguém passou de 50% dos válidos
  if (segundoTurno && cand && cand.pos <= 2) {
    out.push({
      titulo: "Segundo turno",
      texto: cand.pos === 1
        ? `Com ${pctTxt(cand.pct, 2)} dos válidos, lidera mas não passa de 50%: a disputa vai ao 2º turno.`
        : `Com ${pctTxt(cand.pct, 2)} dos válidos, fica em 2º e vai ao 2º turno.`,
      tom: "neutro"
    });
  }

  if (parcial) {
    out.push({
      titulo: "Apuração parcial",
      texto: `Leitura feita com ${pctTxt(andamento)} das seções totalizadas no recorte; percentuais são estáveis antes das contagens absolutas.`,
      tom: "neutro"
    });
  }
  return out;
}

export { pctTxt, pp };
