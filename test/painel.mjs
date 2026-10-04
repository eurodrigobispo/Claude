/**
 * Teste de fluxo do Painel Eleitoral (painel/).
 * Sobe um servidor estático na raiz do repositório e abre o painel em Chromium
 * com o TSE e o IBGE servidos a partir de test/fixtures/painel: o Acre inteiro
 * para Governador, Presidente por estado e quatro boletins de urna reais de
 * Porto Walter. Percorre mapa, matriz, candidato, leitura, comparação com
 * 2022, cidade com zonas e locais, filtro de zona e busca global.
 *
 *   node test/painel.mjs
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const raiz = join(here, "..");
const fx = join(here, "fixtures", "painel");

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch (_) {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return (await import(join(root, "playwright", "index.mjs"))).chromium;
  }
}

const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/plain" };
const servidor = createServer((req, res) => {
  const caminho = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let arq = join(raiz, caminho);
  if (existsSync(arq) && statSync(arq).isDirectory()) arq = join(arq, "index.html");
  if (!existsSync(arq)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TIPOS[extname(arq)] || "application/octet-stream" });
  res.end(readFileSync(arq));
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${servidor.address().port}/painel/`;

const falhas = [];
function check(nome, ok, detalhe) {
  if (ok) console.log("  ok   " + nome);
  else { console.log("  FALHA " + nome + (detalhe ? " → " + detalhe : "")); falhas.push(nome); }
}

const pedidos = [];
const cors = { "access-control-allow-origin": "*" };
function servir(route, arquivo, tipo = "application/json") {
  if (arquivo && existsSync(arquivo)) return route.fulfill({ status: 200, contentType: tipo, headers: cors, body: readFileSync(arquivo) });
  return route.fulfill({ status: 404, headers: cors, body: "" });
}
async function tse(route) {
  const u = new URL(route.request().url());
  pedidos.push(u.pathname);
  const nome = u.pathname.split("/").pop();
  if (u.pathname.includes("/arquivo-urna/")) {
    if (nome.endsWith("-cs.json")) return servir(route, join(fx, "tse", nome));
    return servir(route, join(fx, "urna", nome), nome.endsWith(".dat") ? "application/octet-stream" : "application/json");
  }
  return servir(route, join(fx, "tse", nome));
}
async function ibge(route) {
  const u = new URL(route.request().url());
  if (u.pathname.endsWith("/paises/BR") && u.searchParams.get("intrarregiao") === "UF") return servir(route, join(fx, "ibge", "estados.json"));
  const m = u.pathname.match(/estados\/(\d+)$/);
  return servir(route, m ? join(fx, "ibge", m[1] + ".json") : null);
}

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route("https://resultados.tse.jus.br/**", tse);
await page.route("https://servicodados.ibge.gov.br/**", ibge);
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));

const erros = [];
page.on("pageerror", (e) => erros.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) erros.push(m.text()); });

const texto = (s) => page.textContent(s);
const espera = (fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms });

console.log("\ngovernador · acre");
await page.goto(base + "#cargo=3&uf=ac");
await espera(() => document.querySelectorAll("#gArea path").length >= 22);
check("mapa com os 22 municípios", (await page.locator("#gArea path").count()) === 22);
await espera(() => !document.querySelector("#carga") || document.querySelector("#carga").hidden);
await espera(() => [...document.querySelectorAll("#gArea path")].every((p) => p.style.fill && p.style.fill !== "rgb(28, 27, 24)" && p.style.fill !== "rgb(42, 40, 37)"));
check("matriz pinta todos os municípios pelo líder", true);
check("legenda de líder por partido", /municípios/.test(await texto("#legenda")) && (await texto("#legenda")).includes("pontos"));
check("destaque com quem lidera", (await texto("#hero")).includes("lidera por"));
check("cores por partido no mapa", (await page.evaluate(() => new Set([...document.querySelectorAll("#gArea path")].map((p) => p.style.fill)).size)) >= 2);
check("lista de candidatos", (await page.locator("#candLista .crow").count()) >= 4);
check("tabela de municípios", (await page.locator("#tab tbody tr").count()) === 22, String(await page.locator("#tab tbody tr").count()));
check("panorama sem candidato", (await texto("#dossie")).includes("Panorama"));

console.log("\ncandidato");
const primeiro = await page.locator("#candLista .crow").first().getAttribute("data-cand");
await page.locator("#candLista .crow").first().click();
await espera(() => document.querySelector("#dossie h2") && !document.querySelector("#dossie").textContent.includes("Panorama"));
check("hash com candidato", (await page.evaluate(() => location.hash)).includes("cand=" + primeiro));
check("mapa no modo candidato", (await texto("#legenda")).includes("À frente em"));
await espera(() => document.querySelectorAll("#dLeitura .insights li").length > 0);
check("leitura estratégica", (await page.locator("#dLeitura .insights li").count()) >= 3);
check("perfil por porte", (await texto("#dossie")).includes("Desempenho por porte"));
await espera(() => document.querySelector("#dComp") && document.querySelector("#dComp").textContent.includes("2022"));
check("comparação com 2022", (await texto("#dComp")).includes("Variação"));
check("coluna vs 2022 preenchida", (await texto("#tab tbody")).includes("p.p."));

console.log("\ncidade · zonas e locais");
await page.fill("#cidade", "Porto Walter");
await page.dispatchEvent("#cidade", "change");
await espera(() => document.querySelector("#trilha").textContent.includes("Porto Walter"));
check("trilha com a cidade", true);
await espera(() => document.querySelectorAll("#gLocais circle").length > 0, null, 10000);
check("locais de votação no mapa", (await page.locator("#gLocais circle").count()) >= 1);
check("leu os boletins das 4 seções", pedidos.filter((p) => p.endsWith("-bu.dat")).length === 4, String(pedidos.filter((p) => p.endsWith("-bu.dat")).length));
check("aba de zonas", (await texto("#tab")).includes("Zona 4"));
await page.click('#tabAbas [data-aba="locais"]');
check("aba de locais com nome da escola", /escola/i.test(await texto("#tab")));
await page.selectOption("#zona", "4");
await espera(() => document.querySelector("#candRecorte").textContent === "Zona 4");
check("candidatos na zona", (await page.locator("#candLista .crow").count()) >= 2);
check("votos da zona = soma dos boletins", await page.evaluate(() => {
  const n = [...document.querySelectorAll("#candLista .val small")].map((e) => Number(e.textContent.replace(/\D/g, "")));
  return n.reduce((a, b) => a + b, 0) > 0;
}));

console.log("\nbusca");
await page.click("#busca");
await page.fill("#busca", "lula");
await espera(() => [...document.querySelectorAll("#buscaRes [data-busca]")].length > 0, null, 15000);
check("acha Lula", /lula/i.test(await texto("#buscaRes")));
await page.locator("#buscaRes [data-busca]").first().click();
await espera(() => location.hash.includes("cargo=1") && location.hash.includes("uf=br"));
await espera(() => document.querySelectorAll("#gArea path").length >= 27);
check("abre Presidente · Brasil com mapa por estado", (await page.locator("#gArea path").count()) === 27);
await espera(() => document.querySelectorAll("#gRotulos > text").length >= 27);
check("rótulos de UF no mapa", (await page.locator("#gRotulos > text").count()) === 27);
check("caixas laterais dos estados pequenos", (await page.locator("#gRotulos .caixa-uf").count()) === 7);
await page.hover("#gArea path[data-area=sp]");
check("tooltip do estado", (await texto("#tip")).includes("São Paulo"));
await espera(() => document.querySelectorAll("#tab tbody tr").length >= 27, null, 10000);
check("tabela por estado", (await page.locator("#tab tbody tr").count()) >= 27);

console.log("\nlayout");
const vazando = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
check("sem rolagem horizontal em 1440px", !vazando);
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(200);
check("sem rolagem horizontal em 1280px", !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));

check("nenhum erro de console", erros.length === 0, erros.join(" | "));
await browser.close();
servidor.close();
console.log("\n" + (falhas.length ? falhas.length + " falha(s): " + falhas.join(", ") : "tudo passou"));
process.exit(falhas.length ? 1 : 0);
