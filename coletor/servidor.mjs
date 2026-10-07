// Servidor do painel com o feed do coletor e o contador de pessoas online.
//
//   node coletor/servidor.mjs --porta 8080 --coletar
//
// Serve o painel em /painel/, a pasta do feed em /feed/ e a rota /api/vivo,
// que conta quantas pessoas estão com o painel aberto agora. Com --coletar, roda o coletor no mesmo processo.
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

// No contêiner o processo nasce como root só para acertar o dono da pasta do
// feed (que uma versão anterior pode ter gravado como root) e logo passa para
// o usuário de --usuario.
const usuario = opcao("usuario", "");
if (usuario && process.getuid && process.getuid() === 0) {
  const { execFileSync } = await import("node:child_process");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(FEED, { recursive: true });
  try { execFileSync("chown", ["-R", `${usuario}:${usuario}`, FEED]); } catch (e) { console.error(`chown ${FEED}: ${e.message}`); }
  process.setgid(usuario);
  process.setuid(usuario);
}

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon"
};
const COMPRIMIR = new Set([".html", ".js", ".mjs", ".css", ".json", ".md", ".svg"]);

// ---------- pessoas online ----------

// A limpeza roda num relógio, não a cada pedido: com dezenas de milhares de
// abas abertas, varrer o mapa em cada sinal ocupava o mesmo processo do
// coletor. O mapa tem teto, e cada endereço registra no máximo NOVOS_POR_IP
// abas novas por minuto (o bastante para um escritório atrás de um IP só).
const vistos = new Map(); // id -> último sinal
const MAX_VISTOS = 200_000;
const NOVOS_POR_IP = 300;
const novosPorIp = new Map();
setInterval(() => {
  const limite = Date.now() - JANELA_VIVO;
  for (const [id, t] of vistos) if (t < limite) vistos.delete(id);
}, 5e3).unref();
setInterval(() => novosPorIp.clear(), 60e3).unref();
function registrarVivo(id, ip) {
  if (!vistos.has(id)) {
    const n = novosPorIp.get(ip) || 0;
    if (vistos.size >= MAX_VISTOS || n >= NOVOS_POR_IP) return;
    novosPorIp.set(ip, n + 1);
  }
  vistos.set(id, Date.now());
}
const contarVivos = () => vistos.size;

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
        // atrás do Caddy, o endereço de quem pediu vem em X-Forwarded-For
        const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
        if (/^[A-Za-z0-9_-]{8,32}$/.test(id)) registrarVivo(id, ip);
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
        // o código de resposta segue o placar; zonas e municípios vão como
        // informação, para um monitor externo ver uma leitura parada
        const paradas = Object.entries(e.zonas || {})
          .filter(([, z]) => z.lidas < z.recebidas && z.avancou && Date.now() - Date.parse(z.avancou) > 600e3)
          .map(([k, z]) => `${k} ${z.lidas}/${z.recebidas}`);
        corpo = {
          ok: atraso < 120, atrasoSegundos: atraso, ultimaLeitura: e.ultimaLeitura, ciclos: e.ciclos, falhas: e.falhas, ultimoErro: e.ultimoErro,
          municipiosPendentes: e.municipiosPendentes ?? null, zonasParadas: paradas
        };
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
    // fora do feed e da API, só o painel é público
    if (u.pathname === "/painel") { res.writeHead(301, { location: "/painel/" }); res.end(); return; }
    const arq = u.pathname.startsWith("/painel/") ? caminhoSeguro(join(RAIZ, "painel"), decodeURIComponent(u.pathname.slice("/painel/".length))) : null;
    if (!arq || /[/\\]\./.test(arq.slice(RAIZ.length))) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("não encontrado"); return; }
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
