import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import dados from '../public/01/layers.corrigido.json';
import {MEIO_TEMPO} from './ritmo';

export const LARGURA = 1920;
export const ALTURA = 1080;
/** Trocar aqui se a gravação for em 24, 25 ou 60 — o resto se ajusta sozinho. */
export const FPS = 30;
export const SEGUNDOS = 15;
export const DURACAO = Math.round(FPS * SEGUNDOS);
const FUNDO = '#E4F1FB';

type Camada = {
  z: number;
  id: string;
  arquivo: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacidade: number;
};

type Estilo = 'pop' | 'sobe' | 'esquerda' | 'direita' | 'carimbo' | 'gira';

type Marca = {
  entrada: number; // segundo em que a camada entra
  estilo: Estilo;
  fase: number; // desencontra o balanço de cada peça
  balanco?: number; // amplitude do balanço (1 = padrão)
};

/**
 * Ordem de leitura da frase: eu / tô / [estrela + caricatura] / fechadão / com / ela!
 * Cada peça entra sozinha, como manda um lyric video.
 */
const ROTEIRO: Record<string, Marca> = {
  eu: {entrada: 0.2, estilo: 'esquerda', fase: 0.0, balanco: 1.15},
  coracao: {entrada: 0.67, estilo: 'pop', fase: 1.7, balanco: 1.4},
  to: {entrada: 0.93, estilo: 'sobe', fase: 0.9, balanco: 1.2},
  estrela: {entrada: 1.4, estilo: 'gira', fase: 2.4},
  caricatura: {entrada: 1.73, estilo: 'carimbo', fase: 3.1, balanco: 0.7},
  fechadao: {entrada: 2.6, estilo: 'direita', fase: 1.2, balanco: 1.0},
  com: {entrada: 3.27, estilo: 'sobe', fase: 2.8, balanco: 1.3},
  ela: {entrada: 3.67, estilo: 'carimbo', fase: 0.4, balanco: 1.1},
  badge: {entrada: 4.2, estilo: 'pop', fase: 4.2, balanco: 1.6},
};

/** Segundo em que a última peça termina de assentar. */
const FIM_DAS_ENTRADAS = 4.8;

/** Ordem de chegada — também define o escalonamento dos acentos que se repetem. */
const ORDEM = [
  'eu',
  'coracao',
  'to',
  'estrela',
  'caricatura',
  'fechadao',
  'com',
  'ela',
  'badge',
];

/** De quantos em quantos segundos a onda de acentos volta a percorrer a cena. */
const CICLO_ACENTO = 1.8;
/**
 * Pulsação: meio tempo da faixa (0,812 s). Esta composição foi feita antes de
 * eu ter o MP3 e pulsava a 0,8 s, um valor chutado — a diferença era de 12 ms,
 * mas ao longo de 15 s acumulava quase um quadro e meio de defasagem contra as
 * outras telas. Agora as quatro dividem a mesma grade.
 */
const BATIDA = MEIO_TEMPO;

/** Pulso da batida: sobe seco e desce macio. Serve de eixo rítmico pra cena toda. */
const batida = (segundos: number, periodo = BATIDA) => {
  const t = (segundos % periodo) / periodo;
  return Math.exp(-4.2 * t) * Math.cos(t * Math.PI * 1.1);
};

/**
 * O acento que fecha cada entrada: assim que a peça assenta, ela dá um
 * estica-e-encolhe rápido. É o "efeito de saída" da animação de entrada —
 * a peça não deixa a tela, só carimba a chegada.
 */
const acento = (desde: number, duracao = 0.43) => {
  if (desde < 0 || desde > duracao) return {sx: 1, sy: 1, brilho: 1};
  const t = desde / duracao;
  const onda = Math.sin(t * Math.PI * 2) * Math.exp(-3.4 * t);
  return {
    sx: 1 + onda * 0.16,
    sy: 1 - onda * 0.16,
    brilho: 1 + Math.max(0, onda) * 0.35,
  };
};

const Camada: React.FC<{camada: Camada; frame: number; fps: number}> = ({
  camada,
  frame,
  fps,
}) => {
  const marca = ROTEIRO[camada.id];
  const t = frame / fps; // tempo absoluto, em segundos
  const local = t - marca.entrada; // tempo desde a entrada desta peça

  // mola da entrada — solta, pra estourar e voltar
  const e = spring({
    frame: frame - marca.entrada * fps,
    fps,
    config: {damping: 11, mass: 0.55, stiffness: 120},
  });
  // quando a mola assenta, dispara o acento
  const a = acento(local - 0.47);

  let tx = 0;
  let ty = 0;
  let escala = 1;
  let giro = 0;

  switch (marca.estilo) {
    case 'esquerda':
      tx = interpolate(e, [0, 1], [-520, 0]);
      giro = interpolate(e, [0, 1], [-14, 0]);
      escala = interpolate(e, [0, 1], [0.7, 1]);
      break;
    case 'direita':
      tx = interpolate(e, [0, 1], [560, 0]);
      giro = interpolate(e, [0, 1], [12, 0]);
      escala = interpolate(e, [0, 1], [0.7, 1]);
      break;
    case 'sobe':
      ty = interpolate(e, [0, 1], [230, 0]);
      giro = interpolate(e, [0, 1], [10, 0]);
      escala = interpolate(e, [0, 1], [0.6, 1]);
      break;
    case 'carimbo':
      escala = interpolate(e, [0, 1], [2.1, 1]);
      giro = interpolate(e, [0, 1], [-9, 0]);
      break;
    case 'gira':
      escala = interpolate(e, [0, 1], [0.15, 1]);
      break;
    case 'pop':
    default:
      escala = interpolate(e, [0, 1], [0.1, 1]);
      giro = interpolate(e, [0, 1], [-40, 0]);
      break;
  }

  const visivel = interpolate(local, [0, 0.17], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // --- vida depois que entrou: nada fica parado até o fim dos 15s ---
  const amp = marca.balanco ?? 1;
  const assentou = interpolate(local, [0.33, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // duas senoides de períodos diferentes por eixo: o movimento não fecha ciclo
  // óbvio, então a cena nunca parece um GIF em loop
  const balancoY =
    (Math.sin(t * 2.1 + marca.fase) * 11 + Math.sin(t * 3.7 + marca.fase * 2) * 4) *
    amp *
    assentou;
  const balancoX =
    (Math.cos(t * 1.5 + marca.fase * 1.3) * 8 + Math.cos(t * 2.9 + marca.fase) * 3) *
    amp *
    assentou;
  const balancoGiro =
    (Math.sin(t * 1.7 + marca.fase * 0.7) * 2.6 +
      Math.sin(t * 3.1 + marca.fase * 1.9) * 1.1) *
    amp *
    assentou;
  const pulso = 1 + batida(t + marca.fase * 0.13) * 0.055 * amp * assentou;

  // Depois que tudo entrou, uma onda de acentos volta a percorrer a cena em
  // cascata, na mesma ordem da letra. É o que segura os 10s finais de pé.
  const indice = Math.max(0, ORDEM.indexOf(camada.id));
  const inicioOnda = FIM_DAS_ENTRADAS + indice * 0.17;
  const r =
    t >= inicioOnda
      ? acento((t - inicioOnda) % CICLO_ACENTO)
      : {sx: 1, sy: 1, brilho: 1};

  // a estrela entra num pop e não para mais de girar: 1,5 volta em 15s
  const giroContinuo =
    camada.id === 'estrela' ? interpolate(local, [0, SEGUNDOS], [0, 540]) : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: camada.x,
        top: camada.y,
        width: camada.w,
        height: camada.h,
        opacity: visivel * camada.opacidade,
        transform: `translate(${tx + balancoX}px, ${ty + balancoY}px) rotate(${
          giro + balancoGiro + giroContinuo
        }deg) scale(${escala * pulso * a.sx * r.sx}, ${
          escala * pulso * a.sy * r.sy
        })`,
        filter:
          a.brilho * r.brilho > 1.001
            ? `brightness(${a.brilho * r.brilho})`
            : undefined,
        willChange: 'transform',
      }}
    >
      <Img
        src={staticFile(`01/${camada.arquivo}`)}
        style={{width: '100%', height: '100%'}}
      />
    </div>
  );
};

export const Card01: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const camadas = dados.camadas as Camada[];

  // --- câmera: aproxima devagar, deriva e respira na batida ---
  const t = frame / fps;
  const zoom = interpolate(t, [0, SEGUNDOS], [1.015, 1.075]);
  const respiro = batida(t) * 0.012;
  const camX = Math.sin(t * 0.42) * 26 + Math.sin(t * 1.1) * 6;
  const camY = Math.cos(t * 0.33) * 16 + Math.cos(t * 0.9) * 4;
  const camGiro = Math.sin(t * 0.28) * 0.55;

  // brilho de fundo que pulsa junto, pra cena nunca ficar chapada
  const halo = 0.35 + Math.max(0, batida(t)) * 0.3;

  return (
    <AbsoluteFill style={{backgroundColor: FUNDO, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 60% 55% at 50% 48%, rgba(255,255,255,${halo}) 0%, rgba(255,255,255,0) 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          transform: `translate(${camX}px, ${camY}px) rotate(${camGiro}deg) scale(${
            zoom + respiro
          })`,
          willChange: 'transform',
        }}
      >
        {camadas.map((c) => (
          <Camada key={c.z} camada={c} frame={frame} fps={fps} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export {FIM_DAS_ENTRADAS};
