// Servidor do painel com o feed do coletor e o contador de pessoas online.
//
//   node coletor/servidor.mjs --porta 8080 --coletar
//
// Serve a raiz do repositório (o painel fica em /painel/), a pasta do feed em
// /feed/ e a rota /api/vivo, que conta quantas pessoas estão com o painel
// aberto agora. Com --coletar, roda o coletor no mesmo processo.
// Atrás de uma CDN, só /api/vivo precisa chegar até aqui; /feed/ aguenta cache
// de poucos segundos.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { join, extname, normalize, resolve, sep } from "node:path";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = args.indexOf("--" + nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : padrao;
};

const RAIZ = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FEED = resolve(opcao("saida", join(RAIZ, "feed")));
const PORTA = Number(opcao("porta", process.env.PORT || 8080));
const JANELA_VIVO = 45e3;
const coletando = args.includes("--coletar");

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon"
};
const COMPRIMIR = new Set([".html", ".js", ".mjs", ".css", ".json", ".md", ".svg"]);

// ---------- pessoas online ----------

const vistos = new Map(); // id -> último sinal
function contarVivos() {
  const limite = Date.now() - JANELA_VIVO;
  for (const [id, t] of vistos) if (t < limite) vistos.delete(id);
  return vistos.size;
}

async function corpo(req, max = 256) {
  let dados = "";
  for await (const parte of req) {
    dados += parte;
    if (dados.length > max) break;
  }
  return dados;
}

// ---------- arquivos ----------

function caminhoSeguro(base, rel) {
  const alvo = resolve(base, "." + normalize("/" + rel));
  return alvo === base || alvo.startsWith(base + sep) ? alvo : null;
}

async function servirArquivo(req, res, arq, cache) {
  let info;
  try {
    info = await stat(arq);
    if (info.isDirectory()) {
      arq = join(arq, "index.html");
      info = await stat(arq);
    }
  } catch (_) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" });
    res.end("não encontrado");
    return;
  }
  const ext = extname(arq);
  const cab = {
    "content-type": TIPOS[ext] || "application/octet-stream",
    "cache-control": cache,
    "access-control-allow-origin": "*",
    "last-modified": info.mtime.toUTCString(),
    vary: "accept-encoding"
  };
  if (req.headers["if-modified-since"] && new Date(req.headers["if-modified-since"]) >= new Date(info.mtime.toUTCString())) {
    res.writeHead(304, cab);
    res.end();
    return;
  }
  const gzip = COMPRIMIR.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (gzip) cab["content-encoding"] = "gzip";
  else cab["content-length"] = info.size;
  res.writeHead(200, cab);
  if (req.method === "HEAD") { res.end(); return; }
  const fluxo = createReadStream(arq);
  (gzip ? fluxo.pipe(createGzip()) : fluxo).pipe(res);
}

const servidor = createServer(async (req, res) => {
  const u = new URL(req.url, "http://local");
  try {
    if (u.pathname === "/api/vivo") {
      const cab = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
      if (req.method === "OPTIONS") { res.writeHead(204, cab); res.end(); return; }
      if (req.method === "POST") {
        const id = (await corpo(req)).trim().slice(0, 32);
        if (/^[A-Za-z0-9_-]{8,32}$/.test(id)) vistos.set(id, Date.now());
      }
      res.writeHead(200, cab);
      res.end(JSON.stringify({ n: contarVivos() }));
      return;
    }
    // saúde: 200 se o coletor gravou o placar nos últimos 2 minutos
    if (u.pathname === "/api/saude") {
      let corpo = { ok: false, motivo: "sem estado do coletor" };
      try {
        const e = JSON.parse(await readFile(join(FEED, "estado.json"), "utf8"));
        const atraso = Math.round((Date.now() - Date.parse(e.ultimaLeitura)) / 1000);
        corpo = { ok: atraso < 120, atrasoSegundos: atraso, ultimaLeitura: e.ultimaLeitura, ciclos: e.ciclos, falhas: e.falhas, ultimoErro: e.ultimoErro };
      } catch (_) { /* coletor ainda não gravou nada */ }
      if (!coletando && !corpo.ok) corpo = { ok: true, motivo: "servidor sem coletor" };
      res.writeHead(corpo.ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(corpo));
      return;
    }
    if (u.pathname === "/") {
      res.writeHead(302, { location: "/painel/" });
      res.end();
      return;
    }
    if (u.pathname.startsWith("/feed/")) {
      const arq = caminhoSeguro(FEED, u.pathname.slice("/feed/".length));
      if (!arq) { res.writeHead(400); res.end(); return; }
      await servirArquivo(req, res, arq, "public, max-age=5, stale-while-revalidate=30");
      return;
    }
    const arq = caminhoSeguro(RAIZ, decodeURIComponent(u.pathname));
    if (!arq || /[/\\]\.(git|env)/.test(arq)) { res.writeHead(404); res.end(); return; }
    await servirArquivo(req, res, arq, "public, max-age=60");
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

servidor.listen(PORTA, () => {
  console.log(`painel em http://localhost:${servidor.address().port}/painel/ · feed em ${FEED}`);
});

if (args.includes("--coletar")) {
  if (!args.includes("--saida")) process.argv.push("--saida", FEED);
  const { iniciar } = await import("./coletor.mjs");
  iniciar();
}
