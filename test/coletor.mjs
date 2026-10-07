/**
 * Teste do coletor e do painel lendo o feed.
 *
 * 1. Roda o coletor contra um TSE simulado (test/fixtures/painel) em dois
 *    ciclos, com mudanças entre eles, e confere placar, eventos, histórico,
 *    matriz por UF, zonas somadas dos boletins e validação.
 * 2. Sobe coletor/servidor.mjs com esse feed e abre o painel em Chromium:
 *    tudo deve vir do feed, sem pedir arquivos municipais nem boletins ao TSE.
 *
 *   node test/coletor.mjs
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const raiz = join(here, "..");
const fx = join(here, "fixtures", "painel");
const saida = mkdtempSync(join(tmpdir(), "feed-"));

const falhas = [];
function check(nome, ok, detalhe) {
  if (ok) console.log("  ok   " + nome);
  else { console.log("  FALHA " + nome + (detalhe ? " → " + detalhe : "")); falhas.push(nome); }
}
const lerFeed = (rel) => JSON.parse(readFileSync(join(saida, rel), "utf8"));

// ---------- TSE simulado ----------

const sobrescrito = new Map();
const pedidosTse = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (entrada, opcoes) => {
  const u = String(entrada instanceof Request ? entrada.url : entrada);
  if (!u.startsWith("https://resultados.tse.jus.br/")) return fetchOriginal(entrada, opcoes);
  const nome = new URL(u).pathname.split("/").pop();
  pedidosTse.push(nome);
  if (sobrescrito.has(nome)) return new Response(JSON.stringify(sobrescrito.get(nome)), { status: 200 });
  const pasta = u.includes("/arquivo-urna/") && !nome.endsWith("-cs.json") ? "urna" : "tse";
  const arq = join(fx, pasta, nome);
  if (!existsSync(arq)) return new Response("", { status: 404 });
  return new Response(readFileSync(arq), { status: 200 });
};
const fixture = (nome) => JSON.parse(readFileSync(join(fx, "tse", nome), "utf8"));

// governador do Acre começa com 10 seções a menos, para a apuração andar no 2º ciclo
const fixture0 = (nome) => JSON.parse(readFileSync(join(fx, "tse", nome), "utf8"));
const parcial = fixture0("ac-c0003-e006259-u.json");
const pctDe = (st, ts) => (st / ts * 100).toFixed(2).replace(".", ",");
parcial.s.st = String(Number(parcial.s.ts) - 10);
parcial.s.pst = parcial.s.pstn = pctDe(Number(parcial.s.st), Number(parcial.s.ts));
sobrescrito.set("ac-c0003-e006259-u.json", parcial);

// Senado do Acre, duas vagas, montado a partir do arquivo de governador
const senado = fixture0("ac-c0003-e006259-u.json");
senado.carg[0].cd = "5";
senado.carg[0].nv = "2";
const candsSen = () => senado.carg[0].agr.flatMap((a) => a.par.flatMap((p) => p.cand)).sort((a, b) => b.vap - a.vap);
for (const c of candsSen()) c.st = "";
sobrescrito.set("ac-c0005-e006259-u.json", senado);

process.argv.push("--saida", saida, "--zonas", "ac:01066", "--zonas-cargos", "1,3,5,6,7", "--municipios", "3", "--paralelo", "8");
const coletor = await import("../coletor/coletor.mjs");

console.log("\nprimeiro ciclo");
await coletor.cicloPlacar();
const agora1 = lerFeed("agora.json");
check("placar de presidente no Brasil", !!agora1.corridas["1"] && !!agora1.corridas["1"].br);
check("presidente por UF e exterior", Object.keys(agora1.corridas["1"]).length === 29, String(Object.keys(agora1.corridas["1"]).length));
check("governador do Acre", !!agora1.corridas["3"].ac);
const somaUfs = Object.entries(agora1.corridas["1"]).filter(([uf]) => uf !== "br").reduce((s, [, c]) => s + c.totalizadas, 0);
check("Brasil é a soma dos estados quando o nacional atrasa", agora1.corridas["1"].br.totalizadas === somaUfs, `${agora1.corridas["1"].br.totalizadas} vs ${somaUfs}`);
check("candidatos com nome e partido", lerFeed("candidatos.json").candidatos["3-ac"].some((c) => c.nome && c.partido));
check("histórico começa", (lerFeed("historico.json").series["3-ac"] || []).length === 1);
check("arquivo do minuto", lerFeed("arquivo/t1/indice.json").minutos.length === 1);
check("feed identifica turno e pleito", agora1.turno === 1 && !!agora1.pleito);

console.log("\nmudanças entre ciclos");
const gov = fixture("ac-c0003-e006259-u.json");
const lider = gov.carg[0].agr.flatMap((a) => a.par.flatMap((p) => p.cand)).sort((a, b) => b.vap - a.vap)[0];
lider.st = "Eleito";
lider.e = "s";
gov.s.st = gov.s.ts;
gov.s.pst = gov.s.pstn = "100,00";
gov.hg = "23:59:59";
sobrescrito.set("ac-c0003-e006259-u.json", gov);

const presAc = fixture("ac-c0001-e006257-u.json");
const pc = presAc.carg[0].agr.flatMap((a) => a.par.flatMap((p) => p.cand)).sort((a, b) => b.vap - a.vap);
[pc[0].vap, pc[1].vap] = [pc[1].vap, String(Number(pc[0].vap) + 1)];
// o TSE repete a situação do Presidente no arquivo de cada estado
pc[0].st = pc[1].st = "2º turno";
presAc.hg = "23:59:59";
sobrescrito.set("ac-c0001-e006257-u.json", presAc);

const presSp = fixture("sp-c0001-e006257-u.json");
presSp.s.st = String(Math.min(Number(presSp.s.ts), Number(presSp.s.st) + 300));
presSp.hg = "23:59:59";
sobrescrito.set("sp-c0001-e006257-u.json", presSp);

// o 3º do Senado passa o 2º: muda quem fica com a segunda vaga
const [, s2, s3] = candsSen();
[s2.vap, s3.vap] = [s3.vap, String(Number(s2.vap) + 1)];
senado.hg = "23:59:59";
sobrescrito.set("ac-c0005-e006259-u.json", JSON.parse(JSON.stringify(senado)));

// arquivo incoerente: mais seções totalizadas que seções
const ruim = fixture("rr-c0001-e006257-u.json");
ruim.s.st = String(Number(ruim.s.ts) + 5);
ruim.hg = "23:59:59";
sobrescrito.set("rr-c0001-e006257-u.json", ruim);

await coletor.cicloPlacar();
const ev = lerFeed("eventos.json").eventos;
const tipos = ev.map((e) => e.tipo);
check("evento de eleito", ev.some((e) => e.tipo === "eleito" && e.uf === "ac" && e.texto.includes("vence a eleição para o governo do Acre")), JSON.stringify(ev.filter((e) => e.tipo === "eleito")));
check("evento de virada", ev.some((e) => e.tipo === "virada" && e.uf === "ac" && e.cargo === "1" && e.texto.includes("na disputa pela Presidência no Acre")));
check("evento de seções no placar nacional", ev.some((e) => e.tipo === "secoes" && e.secoes > 0 && /^\+[\d.]+ (seção|seções): .+%, .+%\.$/.test(e.texto) && (e.secoes === 1) === e.texto.includes(" seção:")), JSON.stringify(ev.filter((e) => e.tipo === "secoes").map((e) => e.texto)));
check("virada pela segunda vaga do Senado", ev.some((e) => e.tipo === "virada" && e.cargo === "5" && e.texto.includes("fica entre os dois mais votados na disputa pelo Senado pelo Acre")), JSON.stringify(ev.filter((e) => e.cargo === "5").map((e) => e.texto)));
check("situação do Presidente num estado não vira evento", !ev.some((e) => e.cargo === "1" && e.uf !== "br" && (e.tipo === "segundo-turno" || e.tipo === "eleito")));
check("histórico ganha ponto quando a apuração anda", lerFeed("historico.json").series["3-ac"].length === 2);
const agora2 = lerFeed("agora.json");
check("arquivo incoerente é descartado", agora2.corridas["1"].rr.totalizadas === agora1.corridas["1"].rr.totalizadas);
check("situação publicada no placar", Object.values(agora2.corridas["3"].ac.situacao).includes("Eleito"));

console.log("\nmatriz e zonas");
const m = await coletor.lerMunicipios();
check("municípios do Acre lidos", m.lidos === 22, String(m.lidos));
const uf = lerFeed("uf/ac-c3.json");
check("arquivo da UF em colunas", uf.mun.length === 22 && Object.values(uf.votos).every((col) => col.length === 22));
check("votos por município batem com o arquivo do TSE", (() => {
  const i = uf.mun.indexOf("01066");
  const tse = fixture("ac01066-c0003-e006259-u.json");
  return tse.carg[0].agr.flatMap((a) => a.par.flatMap((p) => p.cand)).every((c) => Number(c.vap) === (uf.votos[c.n] ? uf.votos[c.n][i] : 0));
})());
const antes = pedidosTse.filter((n) => /^ac\d{5}-/.test(n)).length;
await coletor.lerMunicipios();
check("segunda passada não baixa de novo o que não mudou", pedidosTse.filter((n) => /^ac\d{5}-/.test(n)).length === antes);
await coletor.lerZonas();
const zonas = lerFeed("zonas/ac-01066.json");
check("zonas de Porto Walter lidas dos boletins", zonas.lidas === 4 && zonas.cargos["3"].zonas.length === 1, JSON.stringify({ lidas: zonas.lidas }));
check("locais de votação somados", zonas.cargos["3"].locais.length >= 1 && zonas.cargos["3"].locais.every((l) => l.local));
const dep = existsSync(join(saida, "zonas/ac-01066-c6.json")) ? lerFeed("zonas/ac-01066-c6.json") : null;
check("deputados em arquivo próprio", !zonas.cargos["6"] && zonas.proporcionais.includes("6") && !!dep && dep.zonas.length === 1 && dep.lidas === 4, JSON.stringify(zonas.proporcionais));
// carimbo do TSE: aaaammdd hh:mm:ss
check("município refeito depois da meia-noite não volta para a fila", !coletor.precisaLer({ quando: "20261005 12:51:05" }, { hora: "04/10/2026 21:50:33" }));
check("município atrás do índice volta para a fila", coletor.precisaLer({ quando: "20261004 21:40:00" }, { hora: "04/10/2026 21:50:33" }));
// Amazonas, governador: índice às 05:04:52, arquivo totalizado às 04:59:33 e gerado às 06:08:31
check("arquivo gerado depois do índice não volta para a fila", !coletor.precisaLer({ quando: "20261005 06:08:31" }, { hora: "05/10/2026 05:04:52" }));
check("arquivo relido sem novidade espera antes de tentar de novo", !coletor.precisaLer({ quando: "20261004 21:40:00", espera: 2000 }, { hora: "04/10/2026 21:50:33" }, 1000));
// Senado em Roraima, 1º turno de 2026: o TSE calcula 22,68% sobre os válidos
// computados (vvc), que incluem 6.248 votos de candidatos sub judice
const { lerResultado } = await import("../painel/js/tse.js");
const rr = lerResultado({
  carg: [{ cd: "5", nv: "2", agr: [{ par: [{ sg: "PP", n: "11", cand: [{ n: "111", nmu: "NICOLETTI", vap: "138269", pvapn: "22,681438880", dvt: "Válido" }] }] }] }],
  s: { ts: "1519", st: "1519", pstn: "100" }, e: { te: "400603", c: "331959", a: "68644" },
  v: { tv: "663918", vvc: "609613", vv: "603365", vb: "21446", tvn: "32859", vansj: "6248" }
});
check("percentual sobre os válidos computados, como o TSE", Math.abs(rr.cands[0].votos / rr.votos.validos * 100 - rr.cands[0].pct) < 1e-6, String(rr.votos.validos));
check("válidos, brancos e nulos fecham com o total", rr.votos.validos + rr.votos.brancos + rr.votos.nulos === rr.votos.total);
// lote de boletins: seção que voltou 404 espera, e o lote avança para as outras
const { escolherPendentes } = await import("../painel/js/bu.js");
// seções recebidas às 18:00 (a 6 recebida há 30 s); agora = 18:10 em Brasília
const agoraTeste = Date.parse("2026-10-04T18:10:00-03:00");
const secoesTeste = Array.from({ length: 6 }, (_, i) => ({ zona: "1", ns: String(i + 1), recebida: i === 5 ? "04/10/2026 18:09:30" : `04/10/2026 18:0${5 - i}:00` }));
const k = (s) => `1/${s.ns}@${s.recebida}`;
const esperaTeste = new Map([[k(secoesTeste[0]), { n: 1, ate: agoraTeste + 60e3 }], [k(secoesTeste[1]), { n: 1, ate: agoraTeste + 60e3 }], [k(secoesTeste[2]), { n: 2, ate: agoraTeste - 1 }]]);
const lote = escolherPendentes(secoesTeste, new Map([["1/4", { recebida: secoesTeste[3].recebida }]]), esperaTeste, 2, agoraTeste).map((s) => s.ns);
check("lote pula boletins em espera, recém-chegados e começa pelos nunca tentados", lote.join(",") === "5,3", lote.join(","));

// limite do TSE: os pedidos se espalham pela janela de 1 s
const tseMod = await import("../painel/js/tse.js");
tseMod.limitarPedidos(20);
const t0Limite = Date.now();
await Promise.all(Array.from({ length: 40 }, () => tseMod.json(tseMod.url.resultado("3", "ac")).catch(() => null)));
const durou = Date.now() - t0Limite;
tseMod.limitarPedidos(60);
check("pedidos ao TSE respeitam o teto por segundo", durou >= 2000, `${durou} ms para 40 pedidos a 16/s`);
// três recusas seguidas: o IP foi bloqueado, e nada sai por 11 minutos
const recusa = globalThis.fetch;
globalThis.fetch = async (u, o) => (String(u).includes("/bloqueio/") ? new Response("", { status: 403 }) : recusa(u, o));
for (let i = 0; i < 3; i++) await tseMod.json("https://resultados.tse.jus.br/oficial/bloqueio/x.json").catch(() => null);
const pedidosAntes = pedidosTse.length;
const erroBloqueio = await tseMod.json(tseMod.url.resultado("3", "ac")).catch((e) => e);
check("bloqueio do TSE pausa os pedidos", tseMod.bloqueadoAte() > Date.now() + 600e3 && erroBloqueio.status === 429 && pedidosTse.length === pedidosAntes);
globalThis.fetch = recusa;
tseMod.liberarBloqueio();

// voto em candidatura cancelada depois da carga da urna: nulo técnico para o TSE
const { nulosTecnicos } = await import("../painel/js/bu.js");
const [nt] = nulosTecnicos([{ validos: 110, votos: { "13": 60, "99": 40, L13: 10, branco: 3, nulo: 2 } }], new Set(["13", "L13"]));
check("nulo técnico sai dos válidos", nt.validos === 70 && nt.votos.nulo === 42 && !("99" in nt.votos) && nt.votos.L13 === 10, JSON.stringify(nt));
check("validação aceita resultado coerente", coletor.valido({ cands: [{ votos: 5 }], secoes: { total: 2, totalizadas: 1 }, comparecimento: 10, votos: { total: 10, validos: 8, brancos: 1, nulos: 1, legenda: 0 } }));
check("validação recusa votos negativos", !coletor.valido({ cands: [], secoes: { total: 2, totalizadas: 1 }, comparecimento: -1, votos: { total: 10, validos: 8, brancos: 1, nulos: 1, legenda: 0 } }));

// ---------- painel lendo o feed ----------

console.log("\npainel com coletor");
const servidor = spawn(process.execPath, [join(raiz, "coletor", "servidor.mjs"), "--saida", saida, "--porta", "0"], { stdio: ["ignore", "pipe", "inherit"] });
const porta = await new Promise((ok, erro) => {
  servidor.stdout.on("data", (b) => { const m = String(b).match(/localhost:(\d+)/); if (m) ok(Number(m[1])); });
  setTimeout(() => erro(new Error("servidor não subiu")), 8000);
});

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch (_) {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return (await import(join(root, "playwright", "index.mjs"))).chromium;
  }
}
const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pedidosPainel = [];
await page.route("https://resultados.tse.jus.br/**", (route) => {
  const nome = new URL(route.request().url()).pathname.split("/").pop();
  pedidosPainel.push(nome);
  const pasta = route.request().url().includes("/arquivo-urna/") && !nome.endsWith("-cs.json") ? "urna" : "tse";
  const arq = join(fx, pasta, nome);
  return route.fulfill(existsSync(arq) ? { status: 200, body: readFileSync(arq), headers: { "access-control-allow-origin": "*" } } : { status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
});
await page.route("https://servicodados.ibge.gov.br/**", (route) => {
  const mm = new URL(route.request().url()).pathname.match(/estados\/(\d+)$/);
  const arq = mm ? join(fx, "ibge", mm[1] + ".json") : join(fx, "ibge", "estados.json");
  return route.fulfill({ status: 200, body: readFileSync(arq), headers: { "access-control-allow-origin": "*" } });
});
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
const erros = [];
page.on("pageerror", (e) => erros.push(e.message));
page.on("console", (msg) => { if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) erros.push(msg.text()); });

const espera = (fn, ms = 8000) => page.waitForFunction(fn, null, { timeout: ms });
await page.goto(`http://127.0.0.1:${porta}/painel/#cargo=3&uf=ac`);
await espera(() => document.querySelectorAll("#gArea path").length >= 22 && [...document.querySelectorAll("#gArea path")].every((p) => p.style.fill && p.style.fill !== "rgb(28, 27, 24)"));
check("matriz pintada a partir do feed", true);
check("nenhum arquivo municipal pedido ao TSE", !pedidosPainel.some((n) => /^ac\d{5}-c/.test(n)), pedidosPainel.filter((n) => /^ac\d{5}/.test(n)).slice(0, 3).join(","));
check("nenhum placar pedido ao TSE", !pedidosPainel.some((n) => /^ac-c0003/.test(n)));
await espera(() => document.querySelector("#live").title.includes("coletor"));
check("status indica o coletor", true);
await espera(() => !document.querySelector("#vivos").hidden);
check("contador de pessoas online", (await page.textContent("#vivosN")) === "1" && (await page.textContent("#vivosRot")) === "pessoa agora", await page.textContent("#vivos"));
await espera(() => document.querySelector("#dossie").textContent.includes("Ao longo da apuração"));
check("gráfico ao longo da apuração", (await page.locator("#dossie svg.evolucao path").count()) >= 1);
check("últimas atualizações com o eleito", (await page.textContent("#dossie")).includes("vence a eleição para o governo do Acre"));
check("situação no destaque", (await page.textContent("#candLista")).length > 0);

await page.fill("#cidade", "Porto Walter");
await page.dispatchEvent("#cidade", "change");
await espera(() => document.querySelector("#tab") && document.querySelector("#tab").textContent.includes("Zona 4"));
check("zonas vindas do feed", true);
check("nenhum boletim baixado pelo navegador", !pedidosPainel.some((n) => n.endsWith("-bu.dat")));
check("nota com boletins publicados", (await page.textContent("#tabNota")).includes("4 de 4"), await page.textContent("#tabNota"));
await espera(() => document.querySelectorAll("#gCelulas path.celula").length > 0);
check("áreas dos locais no mapa", true);

check("nenhum erro de console", erros.length === 0, erros.join(" | "));
await browser.close();
servidor.kill();
rmSync(saida, { recursive: true, force: true });
console.log("\n" + (falhas.length ? falhas.length + " falha(s): " + falhas.join(", ") : "tudo passou"));
process.exit(falhas.length ? 1 : 0);
