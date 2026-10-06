// Confere o feed do coletor contra os arquivos brutos do TSE, lidos aqui sem o
// parser do painel:
//   A. placar de cada disputa (seções, eleitorado, votos, situação, partidos,
//      percentuais e as identidades entre comparecimento, válidos e total);
//   B. matriz por município: a soma dos municípios é o total da UF;
//   C. zonas das capitais: a soma dos boletins é o total da cidade no TSE.
// Uso: NODE_USE_ENV_PROXY=1 node scripts/auditar-feed.mjs <pasta do feed> [<pasta com cópias do TSE>]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const tse = await import("../painel/js/tse.js");
const { nulosTecnicos } = await import("../painel/js/bu.js");
const [feedDir, tseDir] = process.argv.slice(2);
const ler = (rel) => JSON.parse(readFileSync(join(feedDir, rel), "utf8"));
await tse.configurar({});
const UFS = tse.UFS.map(([uf]) => uf);
const int = (x) => Number(String(x ?? "0").replace(/\./g, "")) || 0;

const falhas = [];
let conferidos = 0;
const igual = (onde, oque, a, b) => {
  conferidos++;
  if (a !== b) falhas.push(`${onde}: ${oque} ${a} ≠ ${b}`);
};

// arquivo bruto do TSE: cópia local quando houver, senão a rede
const brutos = new Map();
async function bruto(cargo, uf, mun = "") {
  const u = tse.url.resultado(cargo, uf, mun);
  const nome = u.slice(u.lastIndexOf("/") + 1);
  if (brutos.has(nome)) return brutos.get(nome);
  let j;
  if (tseDir && existsSync(join(tseDir, nome))) j = JSON.parse(readFileSync(join(tseDir, nome), "utf8"));
  else {
    for (let t = 0; t < 4 && !j; t++) {
      try { const r = await fetch(u); if (r.ok) j = await r.json(); } catch (_) { await new Promise((ok) => setTimeout(ok, 800)); }
    }
  }
  if (!j) throw new Error(`sem ${u}`);
  brutos.set(nome, j);
  return j;
}
// leitura independente dos campos brutos
function campos(j) {
  const cands = j.carg[0].agr.flatMap((a) => a.par.flatMap((p) => p.cand.map((c) => ({ n: c.n, nome: c.nmu, partido: p.sg, votos: int(c.vap), st: c.st || "", pct: Number(String(c.pvapn || "0").replace(",", ".")) }))));
  return {
    vagas: int(j.carg[0].nv), secoes: int(j.s.ts), totalizadas: int(j.s.st), eleitorado: int(j.e.te), naoInstaladas: int(j.e.esni), comparecimento: int(j.e.c), abstencao: int(j.e.a),
    total: int(j.v.tv), validos: int(j.v.vvc) || int(j.v.vv), brancos: int(j.v.vb), nulos: int(j.v.tvn), cands,
    numeros: new Set([...cands.map((c) => c.n), ...j.carg[0].agr.flatMap((a) => a.par.map((p) => `L${p.n}`))])
  };
}

// ---------- A. placar (agora.json) contra o TSE ----------
const agora = ler("agora.json");
const candFeed = ler("candidatos.json").candidatos;
const disputas = [["1", "br"], ["1", "zz"], ...UFS.flatMap((uf) => [["1", uf], ["3", uf], ["5", uf]])];
const oficial = new Map();
await tse.fila(disputas, async ([cargo, uf]) => { oficial.set(`${cargo}-${uf}`, campos(await bruto(cargo, uf))); }, { n: 8 });
for (const [cargo, uf] of disputas) {
  const o = oficial.get(`${cargo}-${uf}`), f = agora.corridas[cargo] && agora.corridas[cargo][uf];
  const onde = `placar ${cargo}-${uf}`;
  if (!f) { falhas.push(`${onde}: ausente no feed`); continue; }
  for (const k of ["secoes", "totalizadas", "eleitorado", "comparecimento", "abstencao", "validos", "brancos", "nulos"]) igual(onde, k, f[k], o[k]);
  for (const c of o.cands) igual(onde, `votos de ${c.nome}`, f.votos[c.n] || 0, c.votos);
  for (const c of o.cands) if (c.st) igual(onde, `situação de ${c.nome}`, (f.situacao || {})[c.n] || "", c.st);
  // nomes e partidos
  const nomes = new Map((candFeed[`${cargo}-${uf}`] || []).map((c) => [c.n, c]));
  for (const c of o.cands) igual(onde, `partido de ${c.nome}`, nomes.get(c.n) && nomes.get(c.n).partido, c.partido);
  // identidades
  // eleitores de seções não instaladas (no exterior, 41 seções) não comparecem nem se abstêm
  igual(onde, "comparecimento + abstenção = eleitorado das seções instaladas", o.comparecimento + o.abstencao, o.eleitorado - o.naoInstaladas);
  igual(onde, "válidos + brancos + nulos = total de votos", o.validos + o.brancos + o.nulos, o.total);
  igual(onde, "total de votos = comparecimento × vagas no Senado", o.total, o.comparecimento * (cargo === "5" ? o.vagas : 1));
  // percentual que o painel calcula (votos/válidos) bate com o do TSE
  for (const c of o.cands) if (o.validos && Math.abs(c.votos / o.validos * 100 - c.pct) > 0.0005) falhas.push(`${onde}: % de ${c.nome} ${(c.votos / o.validos * 100).toFixed(4)} ≠ TSE ${c.pct}`);
}
// Brasil = estados + exterior
{
  const br = oficial.get("1-br");
  const soma = (k) => [...UFS, "zz"].reduce((s, uf) => s + oficial.get(`1-${uf}`)[k], 0);
  for (const k of ["secoes", "comparecimento", "validos", "brancos", "nulos"]) igual("Brasil", `${k} = soma das UFs e exterior`, soma(k), br[k]);
}
console.log(`A. placar: ${disputas.length} disputas`);

// ---------- B. matriz por município = total da UF ----------
let matrizes = 0;
const municipais = agora.municipais || ["1", "3", "5"];
const tarefasB = [];
for (const cargo of municipais) for (const uf of cargo === "1" ? [...UFS, "zz"] : UFS) tarefasB.push([cargo, uf]);
await tse.fila(tarefasB, async ([cargo, uf]) => {
  const rel = `uf/${uf}-c${cargo}.json`;
  if (!existsSync(join(feedDir, rel))) { falhas.push(`matriz ${rel}: ausente`); return; }
  const d = ler(rel);
  const o = campos(await bruto(cargo, uf));
  const onde = `matriz ${cargo}-${uf}`;
  const soma = (k) => d[k].reduce((s, x) => s + x, 0);
  igual(onde, "municípios", d.mun.length, (await tse.municipios())[uf] ? (await tse.municipios())[uf].length : d.mun.length);
  for (const k of ["secoes", "totalizadas", "eleitorado", "comparecimento", "abstencao", "validos", "brancos", "nulos"]) igual(onde, `soma de ${k}`, soma(k), o[k]);
  let difs = 0;
  for (const c of o.cands) {
    const s = (d.votos[c.n] || []).reduce((a, b) => a + b, 0);
    conferidos++;
    if (s !== c.votos) { difs++; if (difs <= 3) falhas.push(`${onde}: soma de ${c.nome} ${s} ≠ ${c.votos}`); }
  }
  if (difs > 3) falhas.push(`${onde}: mais ${difs - 3} candidatos com soma diferente`);
  matrizes++;
}, { n: 6 });
console.log(`B. matrizes: ${matrizes} de ${tarefasB.length}`);

// ---------- C. zonas dos boletins = total da cidade no TSE ----------
const muns = await tse.municipios();
const capitais = UFS.flatMap((uf) => (muns[uf] || []).filter((m) => m.capital).map((m) => ({ uf, mun: m.cd, nome: m.nome })));
const resumoZonas = [];
for (const { uf, mun, nome } of capitais) {
  const rel = `zonas/${uf}-${mun}.json`;
  if (!existsSync(join(feedDir, rel))) { falhas.push(`zonas ${uf}-${mun}: ausente`); continue; }
  const z = ler(rel);
  const cargos = { ...z.cargos };
  for (const c of z.proporcionais || []) {
    const p = join(feedDir, `zonas/${uf}-${mun}-c${c}.json`);
    if (existsSync(p)) { const d = JSON.parse(readFileSync(p, "utf8")); cargos[c] = { zonas: d.zonas, locais: d.locais }; }
    else falhas.push(`zonas ${uf}-${mun}-c${c}: ausente`);
  }
  for (const [cod, g] of Object.entries(cargos)) {
    const cargo = cod === "8" ? "7" : cod;
    const onde = `zonas ${uf}-${mun} (${nome}) cargo ${cod}`;
    const sZ = (k) => g.zonas.reduce((s, x) => s + x[k], 0), sL = (k) => g.locais.reduce((s, x) => s + x[k], 0);
    for (const k of ["secoes", "comparecimento", "validos"]) igual(onde, `zonas = locais em ${k}`, sZ(k), sL(k));
    igual(onde, "seções somadas = boletins lidos", sZ("secoes"), z.lidas);
    const o = campos(await bruto(cargo, uf, mun));
    // a mesma correção do painel: nulos técnicos fora dos válidos
    const zonasAj = nulosTecnicos(g.zonas, o.numeros);
    const sV = zonasAj.reduce((s, x) => s + x.validos, 0);
    const votos = {};
    for (const x of zonasAj) for (const [n, v] of Object.entries(x.votos)) votos[n] = (votos[n] || 0) + v;
    let difCand = 0, maxDif = 0;
    for (const c of o.cands) { const d = (votos[c.n] || 0) - c.votos; if (d) { difCand++; maxDif = Math.max(maxDif, Math.abs(d)); } }
    resumoZonas.push({
      onde, lidas: z.lidas, total: z.total, tseSecoes: o.secoes,
      comparec: [sZ("comparecimento"), o.comparecimento], validos: [sV, o.validos],
      brancos: [votos.branco || 0, o.brancos], nulos: [votos.nulo || 0, o.nulos], difCand, maxDif
    });
  }
}
console.log(`C. zonas: ${resumoZonas.length} cidades × cargos`);
const exatas = resumoZonas.filter((r) => r.comparec[0] === r.comparec[1] && r.validos[0] === r.validos[1] && !r.difCand);
console.log(`   batem exatamente com o TSE: ${exatas.length}`);
for (const r of resumoZonas.filter((x) => !exatas.includes(x))) {
  console.log(`   ${r.onde}: boletins ${r.lidas}/${r.total} (TSE ${r.tseSecoes} seções) · comparec. ${r.comparec[0]} vs ${r.comparec[1]} · válidos ${r.validos[0]} vs ${r.validos[1]} · brancos ${r.brancos.join(" vs ")} · nulos ${r.nulos.join(" vs ")} · ${r.difCand} candidatos diferentes (máx. ${r.maxDif})`);
}

console.log(`\nconferências: ${conferidos}, divergências: ${falhas.length}`);
for (const f of falhas.slice(0, 80)) console.log("  ✗", f);
process.exitCode = falhas.length ? 1 : 0;
