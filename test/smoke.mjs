/**
 * Teste de fluxo da Mesa de Luz.
 * Abre o HTML em Chromium e percorre o caminho inteiro: colar leitura,
 * compor nos quatro destinos, alternar campos por destino, salvar e limpar.
 *
 * Requer playwright. Se não estiver no projeto, cai para a instalação global.
 *   node test/smoke.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const page_url = "file://" + join(here, "..", "mesa-de-luz.html");

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch (_) {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return (await import(join(root, "playwright", "index.mjs"))).chromium;
  }
}

const LEITURA = JSON.stringify({
  assunto: "Frasco de perfume âmbar sobre mármore travertino",
  composicao: "Still de produto, close, câmera levemente acima",
  luz: "Lateral dura de janela, sombra longa e definida",
  paleta: "Âmbar, creme, sombra azulada",
  lente: "100mm macro, f/8",
  textura: "Vidro polido, poeira de pedra",
  mood: "Luxo silencioso",
  estilo: "Still life editorial de fragrância"
});

const falhas = [];
function check(nome, ok, detalhe) {
  if (ok) {
    console.log("  ok   " + nome);
  } else {
    console.log("  FALHA " + nome + (detalhe ? " → " + detalhe : ""));
    falhas.push(nome);
  }
}

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1080 } });

const erros = [];
page.on("pageerror", (e) => erros.push(e.message));
page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });

await page.goto(page_url);
await page.waitForTimeout(300);

console.log("\nmotor");
const modo = await page.textContent("#engineLabel");
check("trilha resolvida", modo !== "Motor: verificando", modo);

console.log("\nleitura");
await page.fill("#jsonIn", "Segue:\n" + LEITURA);
await page.click("#btnParse");
await page.waitForTimeout(200);
check("oito atributos preenchidos", (await page.textContent("#mFilled")) === "8/8");
check("assunto veio do JSON", (await page.inputValue("#f_assunto")).startsWith("Frasco de perfume"));

await page.fill("#jsonIn", "isto nao e json {");
await page.click("#btnParse");
await page.waitForTimeout(150);
check("JSON quebrado avisa em vez de quebrar", (await page.textContent("#toast")).includes("JSON"));

console.log("\ncomposição");
await page.fill("#f_neg", "texto, marca d'água");
await page.selectOption("#f_ar", "4:5");
await page.waitForTimeout(150);
let out = await page.textContent("#out");
check("midjourney traz --no", out.includes("--no texto"));
check("midjourney traz --ar escolhido", out.includes("--ar 4:5"));
check("midjourney traz --stylize", out.includes("--stylize"));

await page.click('[data-dest="video"]');
await page.fill("#f_move", "dolly lento à frente");
await page.waitForTimeout(150);
out = await page.textContent("#out");
check("vídeo rotula a cena", out.includes("CENA:"));
check("vídeo usa o movimento de câmera", out.includes("dolly lento"));
check("vídeo não vaza flags de midjourney", !out.includes("--ar"));

await page.click('[data-dest="flux"]');
await page.waitForTimeout(150);
out = await page.textContent("#out");
check("flux é prosa, sem flags", !out.includes("--") && out.includes("Iluminação:"));

await page.click('[data-dest="brief"]');
await page.waitForTimeout(150);
out = await page.textContent("#out");
check("briefing sai em markdown", out.includes("## Direção de arte"));

console.log("\ncampos por destino");
const visivel = async (sel) => !(await page.locator(sel).isHidden());
await page.click('[data-dest="mj"]');
await page.waitForTimeout(120);
check("midjourney mostra intensidade", await visivel("#wrapStylize"));
check("midjourney esconde câmera", !(await visivel("#wrapMove")));
await page.click('[data-dest="video"]');
await page.waitForTimeout(120);
check("vídeo mostra câmera e duração", (await visivel("#wrapMove")) && (await visivel("#wrapDur")));
check("vídeo esconde intensidade", !(await visivel("#wrapStylize")));

console.log("\nsalvar e limpar");
await page.click("#btnSave");
await page.waitForTimeout(150);
check("entrou na lista de salvos", (await page.textContent("#savedCount")) === "1");
await page.click("#btnReset");
await page.waitForTimeout(150);
check("limpar esvazia o prompt", (await page.locator("#out").getAttribute("class")).includes("empty"));

console.log("\nlayout");
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(200);
const vazando = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth
);
check("sem rolagem horizontal em 390px", !vazando);

check("nenhum erro de console", erros.length === 0, erros.join(" | "));

await browser.close();

console.log("\n" + (falhas.length ? falhas.length + " falha(s): " + falhas.join(", ") : "tudo passou"));
process.exit(falhas.length ? 1 : 0);
