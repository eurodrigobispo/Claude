// Cores por partido e rampas do mapa, misturadas no espaço OKLab a partir da
// cor da terra (#1C1B18) até a cor do partido.

export const TERRA = "#1C1B18";
export const AGUARDANDO = "#2A2825";
export const SEM_PARTIDO = "#8C8577";

// cor de preenchimento por sigla do TSE; federações usam a do primeiro partido
const PARTIDOS = {
  PT: "#EE2D35", PL: "#4162E2", PSD: "#84C65C", MDB: "#01813A", REPUBLICANOS: "#4181AD",
  PP: "#90E7FF", "UNIÃO": "#26C4FF", PSDB: "#3994FF", PSB: "#FFC961", PSOL: "#FAF45A",
  NOVO: "#F87025", PDT: "#DC4C92", "MISSÃO": "#CEA608", PSTU: "#F38C8E", REDE: "#3FC3AE",
  PODE: "#AB6BD6", PCB: "#B7535D", CIDADANIA: "#F0289B", PRD: "#14938D", DC: "#BC8C30",
  PRTB: "#28A650", PCO: "#DE6F6A", MOBILIZA: "#B24D8B", DEMOCRATA: "#8FE3BA", AGIR: "#A2A5E0",
  PV: "#719259", "PC do B": "#CE3E57", PCDOB: "#CE3E57", AVANTE: "#04A9B7", SOLIDARIEDADE: "#F78C08", UP: "#B4B0AC"
};

// versão para texto quando a cor cheia não tem contraste suficiente sobre o cartão
const TEXTO = { PT: "#F14242", PL: "#5D7EE9", MDB: "#429458", REPUBLICANOS: "#4F89B3", PCB: "#C36B72", MOBILIZA: "#BE669A", "PC do B": "#D75B6B", PCDOB: "#D75B6B" };

const norm = (sg) => String(sg || "").trim().toUpperCase().replace("PC DO B", "PCDOB");

export function corPartido(sg) {
  const k = norm(sg);
  return PARTIDOS[k] || PARTIDOS[sg] || SEM_PARTIDO;
}
export function corTexto(sg) {
  const k = norm(sg);
  return TEXTO[k] || TEXTO[sg] || corPartido(sg);
}

// ---------- OKLab ----------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function paraOklab(h) {
  const [r, g, b] = hex(h).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function deOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
  return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, gam(c))) * 255).toString(16).padStart(2, "0")).join("");
}

const memo = new Map();
export function misturar(de, para, t) {
  const k = `${de}${para}${t}`;
  if (!memo.has(k)) {
    const a = paraOklab(de), b = paraOklab(para);
    memo.set(k, deOklab(a.map((v, i) => v + (b[i] - v) * t)));
  }
  return memo.get(k);
}

// líder por margem sobre o 2º: até 10, até 25, até 45 e mais de 45 pontos,
// como diz a legenda
const TONS_MARGEM = [0.4, 0.62, 0.82, 1];
export function corMargem(sg, margem) {
  const i = margem <= 10 ? 0 : margem <= 25 ? 1 : margem <= 45 ? 2 : 3;
  return misturar(TERRA, corPartido(sg), TONS_MARGEM[i]);
}
export const rampaMargem = (sg) => TONS_MARGEM.map((t) => misturar(TERRA, corPartido(sg), t));

// mapa do candidato: 6 tons com quebras relativas à média S do candidato
const TONS_CAND = [0.28, 0.42, 0.56, 0.7, 0.85, 1];
export const rampaCandidato = (sg) => TONS_CAND.map((t) => misturar(TERRA, corPartido(sg), t));
export function quebrasCandidato(S) {
  const s = S / 100;
  return [0.4 * s, 0.7 * s, s, Math.min(1.4 * s, s + 0.3 * (1 - s)), Math.min(2 * s, s + 0.6 * (1 - s))].map((v) => v * 100);
}
export function classeCandidato(pct, quebras) {
  // sem votos é o tom mais claro, mesmo quando a média do candidato é zero
  if (!(pct > 0)) return 0;
  let i = 0;
  while (i < quebras.length && pct >= quebras[i]) i++;
  return i;
}
