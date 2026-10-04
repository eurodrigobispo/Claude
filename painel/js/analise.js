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

/**
 * Escolhe a referência de 2022 para um candidato de 2026: o mesmo número no
 * mesmo cargo (para majoritários o número é o do partido) ou, se não houver,
 * o candidato de 2022 do mesmo partido com mais votos.
 */
export function referencia2022(cand, base) {
  if (!base) return null;
  if (base.cand[cand.n]) return { n: cand.n, nome: titulo(base.cand[cand.n][0]), partido: base.cand[cand.n][1], criterio: "mesmo número" };
  const doPartido = Object.entries(base.cand).filter(([n, [, sg]]) => sg === cand.partido || n.slice(0, 2) === String(cand.npartido || cand.n).slice(0, 2));
  if (!doPartido.length) return null;
  const tot = (n) => Object.values(base.mun).reduce((s, m) => s + (m.votos[n] || 0), 0);
  doPartido.sort((a, b) => tot(b[0]) - tot(a[0]));
  const [n, [nome, partido]] = doPartido[0];
  return { n, nome: titulo(nome), partido, criterio: "mesmo partido" };
}

/**
 * Compara a votação por município com a referência de 2022.
 * Devolve { ref, pct22, pct26, delta, correlacao, ganhos: [...], perdas: [...], porMun: {mun: delta} }
 */
export function comparar(linhas, base, ref) {
  if (!base || !ref) return null;
  const xs = [], ys = [], ws = [];
  const itens = [];
  let v22 = 0, val22 = 0, v26 = 0, val26 = 0;
  for (const l of linhas) {
    const m = base.mun[l.cd];
    if (!m || !m.validos || !l.validos) continue;
    const p22 = (m.votos[ref.n] || 0) / m.validos * 100;
    const p26 = l.votos / l.validos * 100;
    xs.push(p22); ys.push(p26); ws.push(l.validos);
    v22 += m.votos[ref.n] || 0; val22 += m.validos;
    v26 += l.votos; val26 += l.validos;
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

export function leitura({ cand, perfil: p, comp, andamento, cargoMaj, unidade = "municípios" }) {
  const out = [];
  const sing = unidade === "estados" ? "estado" : "município";
  if (!p || !p.municipios) return out;
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
        texto: `Faz ${pctTxt(pequenos.pct)} nos municípios até 10 mil eleitores e ${pctTxt(grandes.pct)} nos acima de 200 mil (${pp(dif)} a favor dos ${dif > 0 ? "pequenos" : "grandes"}).`,
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

  if (cargoMaj && cand && cand.pos <= 2 && cand.pct < 50) {
    out.push({
      titulo: "Segundo turno",
      texto: `Com ${pctTxt(cand.pct, 2)} dos válidos, ${cand.pos === 1 ? "lidera mas" : "está em 2º e"} não alcança os 50% necessários para vencer no 1º turno.`,
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
