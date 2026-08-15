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
import dados from '../public/09/layers.corrigido.json';
import {BATIDA, COMPASSO, MEIO_TEMPO, acento, emBatidas, pulso} from './ritmo';

export const LARGURA = 1920;
export const ALTURA = 1080;
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

type Estilo = 'pop' | 'sobe' | 'esquerda' | 'direita' | 'carimbo';

/**
 * A frase entra na cadência em que se fala: "tô / com / Andréa" numa levada de
 * batidas seguidas, respiro de um compasso, e então "porque / ela / representa".
 * Os tempos estão em batidas da faixa (0,40596 s cada), não em segundos soltos.
 */
const ROTEIRO: Record<string, {batida: number; estilo: Estilo; fase: number; balanco?: number}> = {
  to: {batida: 2, estilo: 'esquerda', fase: 0.0, balanco: 1.2},
  com: {batida: 3, estilo: 'sobe', fase: 1.1, balanco: 1.35},
  andrea: {batida: 4, estilo: 'carimbo', fase: 2.0, balanco: 1.0},
  deputada: {batida: 6, estilo: 'sobe', fase: 3.3, balanco: 0.8},
  rosto: {batida: 8, estilo: 'pop', fase: 2.6, balanco: 0.75},
  porque: {batida: 12, estilo: 'direita', fase: 0.7, balanco: 1.25},
  ela: {batida: 13, estilo: 'pop', fase: 4.1, balanco: 1.4},
  representa: {batida: 14, estilo: 'carimbo', fase: 1.6, balanco: 1.1},
  badge: {batida: 15, estilo: 'pop', fase: 5.2, balanco: 1.6},
};

const ORDEM = [
  'to',
  'com',
  'andrea',
  'deputada',
  'rosto',
  'porque',
  'ela',
  'representa',
  'badge',
];

const FIM_DAS_ENTRADAS = emBatidas(15) + 0.6;
const CICLO_ACENTO = COMPASSO * 2;

const Peca: React.FC<{c: Camada; t: number; frame: number; fps: number}> = ({
  c,
  t,
  frame,
  fps,
}) => {
  const m = ROTEIRO[c.id];
  if (!m) return null;
  const entrada = emBatidas(m.batida);
  const local = t - entrada;

  const e = spring({
    frame: frame - entrada * fps,
    fps,
    config: {damping: 11, mass: 0.55, stiffness: 125},
  });
  const a = acento(local - 0.45);

  let tx = 0;
  let ty = 0;
  let escala = 1;
  let giro = 0;
  switch (m.estilo) {
    case 'esquerda':
      tx = interpolate(e, [0, 1], [-480, 0]);
      giro = interpolate(e, [0, 1], [-12, 0]);
      escala = interpolate(e, [0, 1], [0.72, 1]);
      break;
    case 'direita':
      tx = interpolate(e, [0, 1], [520, 0]);
      giro = interpolate(e, [0, 1], [11, 0]);
      escala = interpolate(e, [0, 1], [0.72, 1]);
      break;
    case 'sobe':
      ty = interpolate(e, [0, 1], [200, 0]);
      giro = interpolate(e, [0, 1], [9, 0]);
      escala = interpolate(e, [0, 1], [0.62, 1]);
      break;
    case 'carimbo':
      escala = interpolate(e, [0, 1], [1.95, 1]);
      giro = interpolate(e, [0, 1], [-8, 0]);
      break;
    default:
      escala = interpolate(e, [0, 1], [0.12, 1]);
      giro = interpolate(e, [0, 1], [-34, 0]);
      break;
  }

  const visivel = interpolate(local, [0, 0.15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const assentou = interpolate(local, [0.33, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const amp = m.balanco ?? 1;
  const balancoY =
    (Math.sin(t * 2.0 + m.fase) * 10 + Math.sin(t * 3.5 + m.fase * 2) * 3.5) * amp * assentou;
  const balancoX =
    (Math.cos(t * 1.45 + m.fase * 1.3) * 7 + Math.cos(t * 2.8 + m.fase) * 2.5) * amp * assentou;
  const balancoGiro =
    (Math.sin(t * 1.6 + m.fase * 0.7) * 2.4 + Math.sin(t * 3.0 + m.fase * 1.9) * 1.0) *
    amp *
    assentou;
  // respiro no meio tempo, defasado por peça
  const respira = 1 + pulso(t + m.fase * 0.09, MEIO_TEMPO) * 0.045 * amp * assentou;

  // onda de acentos que volta a cada dois compassos, na ordem da frase
  const i = Math.max(0, ORDEM.indexOf(c.id));
  const inicioOnda = FIM_DAS_ENTRADAS + i * (BATIDA / 2);
  const r = t >= inicioOnda ? acento((t - inicioOnda) % CICLO_ACENTO) : {sx: 1, sy: 1, brilho: 1};

  // a caricatura vem com a estrela azul no mesmo PNG, então o conjunto gira
  // devagar em vez de girar só a estrela
  const giroLento = c.id === 'rosto' ? Math.sin(t * 0.5) * 3.5 * assentou : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: c.x,
        top: c.y,
        width: c.w,
        height: c.h,
        opacity: visivel * c.opacidade,
        transform: `translate(${tx + balancoX}px, ${ty + balancoY}px) rotate(${
          giro + balancoGiro + giroLento
        }deg) scale(${escala * respira * a.sx * r.sx}, ${escala * respira * a.sy * r.sy})`,
        filter: a.brilho * r.brilho > 1.001 ? `brightness(${a.brilho * r.brilho})` : undefined,
        willChange: 'transform',
      }}
    >
      <Img src={staticFile(`09/${c.arquivo}`)} style={{width: '100%', height: '100%'}} />
    </div>
  );
};

export const ToComAndrea: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const camadas = dados.camadas as Camada[];

  const zoom = interpolate(t, [0, SEGUNDOS], [1.015, 1.07]) + pulso(t, COMPASSO) * 0.009;
  const camX = Math.sin(t * 0.4) * 24 + Math.sin(t * 1.05) * 5;
  const camY = Math.cos(t * 0.31) * 15;
  const camGiro = Math.sin(t * 0.26) * 0.5;

  return (
    <AbsoluteFill style={{backgroundColor: FUNDO, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 60% 55% at 50% 48%, rgba(255,255,255,${
            0.3 + Math.max(0, pulso(t, COMPASSO)) * 0.25
          }) 0%, rgba(255,255,255,0) 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          transform: `translate(${camX}px, ${camY}px) rotate(${camGiro}deg) scale(${zoom})`,
          willChange: 'transform',
        }}
      >
        {camadas.map((c) => (
          <Peca key={`${c.z}-${c.id}`} c={c} t={t} frame={frame} fps={fps} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
