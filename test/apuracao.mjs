/**
 * Teste de fluxo da Apuração 2026.
 * Abre o HTML em Chromium com as respostas do TSE servidas a partir de
 * test/fixtures (recortes reais da divulgação), e percorre cargos, locais,
 * busca, tabela por estado, link compartilhado e falha de rede.
 *
 * Requer playwright. Se não estiver no projeto, cai para a instalação global.
 *   node test/apuracao.mjs
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const page_url = "file://" + join(here, "..", "apuracao-2026.html");
const fixtures = join(here, "fixtures");

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch (_) {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return (await import(join(root, "playwright", "index.mjs"))).chromium;
  }
}

const falhas = [];
function check(nome, ok, detalhe) {
  if (ok) {
    console.log("  ok   " + nome);
  } else {
    console.log("  FALHA " + nome + (detalhe ? " → " + detalhe : ""));
    falhas.push(nome);
  }
}

// Responde como o TSE: arquivo de dados por nome; outros estados e municípios
// reaproveitam o recorte de SP; fotos e o resto viram 404.
let redeFora = false;
const pedidos = [];
async function tse(route) {
  const url = new URL(route.request().url());
  pedidos.push(url.pathname);
  if (redeFora) return route.abort("internetdisconnected");
  const cors = { "access-control-allow-origin": "*" };
  const nome = url.pathname.split("/").pop();
  let arquivo = join(fixtures, nome);
  if (!existsSync(arquivo)) {
    const m = nome.match(/^([a-z]{2})(\d{5})?-(c\d{4}-e\d{6}-u\.json)$/);
    if (m && m[1] !== "df") arquivo = join(fixtures, "sp-" + m[3]);
  }
  if (nome.endsWith(".json") && existsSync(arquivo)) {
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: readFileSync(arquivo) });
  }
  return route.fulfill({ status: 404, headers: cors, body: "not found" });
}

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.route("https://resultados.tse.jus.br/**", tse);

const erros = [];
page.on("pageerror", (e) => erros.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) erros.push(m.text());
});

const texto = (sel) => page.textContent(sel);
const linhas = () => page.locator("#cands li").count();
const espera = (ms = 250) => page.waitForTimeout(ms);

await page.goto(page_url);
await page.waitForSelector("#cands li");

console.log("\npresidente · brasil");
check("título", (await texto("#resTitulo")) === "Presidente · Brasil");
check("percentual de seções", (await texto("#pctSec")).endsWith("%") && (await texto("#pctSec")) !== "—");
check("trilha ao vivo", (await texto("#liveText")).startsWith("Ao vivo"), await texto("#liveText"));
check("estatísticas de comparecimento", (await texto("#stats")).includes("Comparecimento"));
const votos = await page.$$eval("#cands .num span", (els) => els.map((e) => Number(e.textContent.replace(/\D/g, ""))));
check("ordenado por votos", votos.length > 1 && votos.every((v, i) => i === 0 || votos[i - 1] >= v));
check("marca dos 50%", (await page.locator("#cands .m50").count()) === (await linhas()));
check("só o líder em destaque", (await page.locator("#cands .destaque").count()) === 1);
check("vice na linha de detalhe", (await texto("#cands li .det")).includes("Vice:"));
await espera(400);
check("foto ausente vira iniciais", (await page.locator("#cands span.foto").count()) > 0);
check("Exterior só aparece para presidente", (await page.locator('#uf option[value="zz"]').count()) === 1);

console.log("\npor estado");
check("tabela aparece em Brasil", await page.locator("#porUfBox").isVisible());
await page.click("#btnPorUf");
await page.waitForSelector("#porUf tr");
check("27 estados mais exterior", (await page.locator("#porUf tr").count()) === 28);
await page.click('#porUf tr[data-uf="sp"]');
await page.waitForFunction(() => document.querySelector("#resTitulo").textContent === "Presidente · São Paulo");
check("clicar no estado grava no link", (await page.evaluate(() => location.hash)).includes("uf=sp"));
check("tabela some fora de Brasil", !(await page.locator("#porUfBox").isVisible()));

console.log("\ngovernador e senador");
await page.click('[data-cargo="3"]');
await page.waitForFunction(() => document.querySelector("#resTitulo").textContent === "Governador · São Paulo");
await page.waitForSelector("#cands li");
check("Brasil some da lista de locais", (await page.locator('#uf option[value="br"]').count()) === 0);
check("governador avisa dos 50%", (await texto("#resNota")).includes("50%"));
await page.click('[data-cargo="5"]');
await page.waitForFunction(() => document.querySelector("#resTitulo").textContent === "Senador · São Paulo");
await page.waitForSelector("#cands li");
check("senador mostra vagas", (await texto("#resNota")) === "2 vagas", await texto("#resNota"));
check("dois em destaque", (await page.locator("#cands .destaque").count()) === 2);
check("suplentes no detalhe", (await texto("#cands li .det")).includes("Suplentes:"));
check("sem marca dos 50% no senado", (await page.locator("#cands .m50").count()) === 0);

console.log("\ndeputado federal");
await page.click('[data-cargo="6"]');
await page.waitForFunction(() => document.querySelector("#resTitulo").textContent.startsWith("Dep. Federal"));
await page.waitForSelector("#cands li");
check("busca aparece em lista longa", await page.locator("#filtroBox").isVisible());
check("primeira página com 40", (await linhas()) === 40, String(await linhas()));
check("botão mostrar mais", await page.locator("#maisBox").isVisible());
await page.click("#btnMais");
check("mostrar mais carrega o resto", (await linhas()) === 80, String(await linhas()));
const primeiro = (await texto("#cands li .nome")).trim().split(/\s+/)[0];
await page.fill("#busca", primeiro.toLowerCase());
await espera(150);
const achados = await linhas();
check("busca filtra", achados >= 1 && achados < 80, String(achados));
check("posição real é mantida na busca", (await texto("#cands li .pos")) === "1");
check("legenda nas estatísticas", (await texto("#stats")).includes("Legenda"));
await page.fill("#busca", "zzzz-ninguém");
await espera(150);
check("busca vazia avisa", (await texto("#vazio")).includes("Nenhum"));

console.log("\nmunicípio");
await page.waitForFunction(() => document.querySelectorAll("#mun option").length > 1, null, { timeout: 5000 });
await page.selectOption("#mun", "62910");
await page.waitForFunction(() => document.querySelector("#resTitulo").textContent.includes("(SP)"));
check("título com município", (await texto("#resTitulo")) === "Dep. Federal · Campinas (SP)", await texto("#resTitulo"));
check("pediu arquivo do município", pedidos.some((p) => p.endsWith("/sp62910-c0006-e006259-u.json")));
check("busca zera ao trocar local", (await page.inputValue("#busca")) === "");

console.log("\ndistrito federal");
await page.click('[data-cargo="7"]');
await page.selectOption("#uf", "df");
await page.waitForFunction(() => document.querySelector("#resTitulo").textContent.startsWith("Dep. Distrital"));
await espera(300);
check("estadual vira distrital no DF", pedidos.some((p) => p.endsWith("/df-c0008-e006259-u.json")));
check("botão renomeado", (await texto('[data-cargo="7"]')) === "Dep. Distrital");
check("sem dados avisa", (await texto("#vazio")).includes("ainda não divulgou"));

console.log("\nlink compartilhado");
const page2 = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page2.route("https://resultados.tse.jus.br/**", tse);
page2.on("pageerror", (e) => erros.push(e.message));
await page2.goto(page_url + "#cargo=3&uf=sp&mun=71072");
await page2.waitForFunction(() => document.querySelector("#resTitulo").textContent === "Governador · São Paulo (SP)", null, { timeout: 5000 });
check("abre direto no município do link", (await page2.inputValue("#mun")) === "71072");
check("cargo do link marcado", (await page2.getAttribute('[data-cargo="3"]', "aria-pressed")) === "true");

console.log("\nfalha de rede");
redeFora = true;
await page2.click("#btnRefresh");
await page2.waitForFunction(() => document.querySelector("#live").dataset.st === "erro", null, { timeout: 5000 });
check("trilha avisa a falha", (await page2.textContent("#liveText")).includes("Sem resposta"));
check("mantém o último resultado", (await page2.locator("#cands li").count()) > 0);
redeFora = false;
await page2.close();

console.log("\nlayout");
await page.click('[data-cargo="1"]');
await page.selectOption("#uf", "br");
await page.waitForSelector("#cands li");
await page.setViewportSize({ width: 390, height: 900 });
await espera(200);
const vazando = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth
);
check("sem rolagem horizontal em 390px", !vazando);

check("nenhum erro de console", erros.length === 0, erros.join(" | "));

await browser.close();

console.log("\n" + (falhas.length ? falhas.length + " falha(s): " + falhas.join(", ") : "tudo passou"));
process.exit(falhas.length ? 1 : 0);
