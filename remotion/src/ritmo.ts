/**
 * Grade rítmica medida em ANDREIA_CASTRO_55670_2.mp3.
 *
 * Método: envoltória de onset com hop de 128 (5,8 ms) e autocorrelação. O pico
 * fundamental caiu em 0,40596 s e todos os outros picos são múltiplos inteiros
 * dele (×2, ×3, ×4), o que confirma o período. Nos pontos dessa grade a energia
 * de onset é 1,60× a média da faixa.
 */
export const BPM = 147.8;
export const BATIDA = 0.40596; // segundos por batida
export const COMPASSO = BATIDA * 4; // 1,624 s — a faixa é 4/4
export const MEIO_TEMPO = BATIDA * 2; // 0,812 s — a pulsação mais forte da faixa

/** Na música, o primeiro tempo forte cai aqui. Serve pra alinhar o clipe na edição. */
export const PRIMEIRO_TEMPO_FORTE = 0.928;

/** Converte uma posição em batidas para segundos. */
export const emBatidas = (n: number) => n * BATIDA;

/**
 * Pulso de batida: ataque seco e queda macia, com energia concentrada no
 * começo do ciclo. `periodo` em segundos — use MEIO_TEMPO ou COMPASSO, nunca
 * BATIDA para tudo ao mesmo tempo, senão a cena inteira treme junto.
 */
export const pulso = (segundos: number, periodo: number = MEIO_TEMPO) => {
  const t = ((segundos % periodo) + periodo) % periodo / periodo;
  return Math.exp(-4.2 * t) * Math.cos(t * Math.PI * 1.1);
};

/**
 * Acento de chegada: assim que a peça assenta, dá um estica-e-encolhe curto.
 * É o "efeito de saída" da entrada — a peça não deixa a tela, só carimba.
 */
export const acento = (desde: number, duracao = 0.43) => {
  if (desde < 0 || desde > duracao) return {sx: 1, sy: 1, brilho: 1};
  const t = desde / duracao;
  const onda = Math.sin(t * Math.PI * 2) * Math.exp(-3.4 * t);
  return {
    sx: 1 + onda * 0.16,
    sy: 1 - onda * 0.16,
    brilho: 1 + Math.max(0, onda) * 0.3,
  };
};

/** Cores da campanha, tiradas dos próprios cards. */
export const CORES = {
  amarelo: '#F7C624',
  roxo: '#6B1DE8',
  rosa: '#F3248F',
  branco: '#E4F1FB',
};

/**
 * Paletas que se revezam. Cada uma mantém contraste alto entre fundo e número —
 * a troca é de esquema inteiro, não de um elemento solto.
 */
export const PALETAS = [
  {fundo: CORES.amarelo, tinta: CORES.roxo, apoio: CORES.rosa},
  {fundo: CORES.roxo, tinta: CORES.branco, apoio: CORES.amarelo},
  {fundo: CORES.rosa, tinta: CORES.branco, apoio: CORES.amarelo},
  {fundo: CORES.branco, tinta: CORES.roxo, apoio: CORES.rosa},
];

/**
 * Quantos compassos cada paleta dura. Dois compassos = 3,25 s = 0,31 Hz de
 * troca. O limiar de risco para epilepsia fotossensível começa em 3 Hz, então
 * isso fica quase dez vezes abaixo — e ainda por cima com transição suave,
 * nunca corte seco de tela cheia.
 */
export const COMPASSOS_POR_PALETA = 2;
const DURACAO_PALETA = COMPASSO * COMPASSOS_POR_PALETA;
/** Fração do compasso usada para dissolver de uma paleta para a próxima. */
const DISSOLVE = 0.55;

/**
 * Devolve a paleta no tempo `t`, já interpolada. `mistura` vai de 0 a 1 durante
 * a transição, pra quem quiser fazer crossfade de duas camadas em vez de trocar
 * a cor de uma vez.
 */
export const paletaEm = (t: number) => {
  const pos = t / DURACAO_PALETA;
  const i = Math.floor(pos);
  const resto = (pos - i) * DURACAO_PALETA;
  const inicioDissolve = DURACAO_PALETA - DISSOLVE;
  const mistura =
    resto <= inicioDissolve
      ? 0
      : suave((resto - inicioDissolve) / DISSOLVE);
  return {
    indice: i,
    de: PALETAS[((i % PALETAS.length) + PALETAS.length) % PALETAS.length],
    para: PALETAS[(((i + 1) % PALETAS.length) + PALETAS.length) % PALETAS.length],
    mistura,
  };
};

/** Curva suave (smoothstep): evita o degrau que faria a troca "piscar". */
export const suave = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

const hexParaRgb = (h: string) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Interpola duas cores hex. É o que faz a troca de paleta dissolver em vez de piscar. */
export const misturaCor = (a: string, b: string, k: number) => {
  const [r1, g1, b1] = hexParaRgb(a);
  const [r2, g2, b2] = hexParaRgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `rgb(${m(r1, r2)}, ${m(g1, g2)}, ${m(b1, b2)})`;
};

/** Cor de fundo e cor de tinta já resolvidas no tempo `t`. */
export const coresEm = (t: number) => {
  const {de, para, mistura} = paletaEm(t);
  return {
    fundo: misturaCor(de.fundo, para.fundo, mistura),
    tinta: misturaCor(de.tinta, para.tinta, mistura),
    apoio: misturaCor(de.apoio, para.apoio, mistura),
  };
};
