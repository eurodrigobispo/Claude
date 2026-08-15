import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import digitos from '../public/num/digitos.json';
import {BATIDA, COMPASSO, MEIO_TEMPO, acento, emBatidas, paletaEm, pulso} from './ritmo';

export const LARGURA = 1920;
export const ALTURA = 1080;
export const FPS = 30;
export const SEGUNDOS = 15;
export const DURACAO = Math.round(FPS * SEGUNDOS);

type Digito = {i: number; arquivo: string; x: number; y: number; w: number; h: number};

/**
 * Cadência dos números: um a cada meio tempo (0,812 s). É a pulsação mais forte
 * da faixa, então cada algarismo cai junto com a música sem atropelar o
 * anterior. Um por batida seria o dobro da velocidade e viraria rajada.
 */
const ENTRADA_PRIMEIRO = emBatidas(2);
const PASSO = MEIO_TEMPO;

/** Estado de animação de um algarismo — igual nas duas camadas de cor. */
const estadoDoDigito = (d: Digito, t: number, frame: number, fps: number) => {
  const entrada = ENTRADA_PRIMEIRO + d.i * PASSO;
  const local = t - entrada;
  const e = spring({
    frame: frame - entrada * fps,
    fps,
    config: {damping: 12, mass: 0.6, stiffness: 130},
  });
  const a = acento(local - 0.42);
  const assentou = interpolate(local, [0.3, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const respira = 1 + pulso(t + d.i * (BATIDA / 2.5), MEIO_TEMPO) * 0.05 * assentou;
  return {
    visivel: interpolate(local, [0, 0.14], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    escala: interpolate(e, [0, 1], [0.35, 1]),
    sobe: interpolate(e, [0, 1], [90, 0]),
    giro:
      interpolate(e, [0, 1], [d.i % 2 ? 9 : -9, 0]) +
      Math.sin(t * 1.4 + d.i * 0.6) * 1.6 * assentou,
    balancoY: Math.sin(t * 1.9 + d.i * 0.8) * 8 * assentou,
    respira,
    a,
  };
};

const Algarismo: React.FC<{d: Digito; t: number; frame: number; fps: number; cor: string}> = ({
  d,
  t,
  frame,
  fps,
  cor,
}) => {
  const s = estadoDoDigito(d, t, frame, fps);
  return (
    <div
      style={{
        position: 'absolute',
        left: d.x,
        top: d.y,
        width: d.w,
        height: d.h,
        opacity: s.visivel,
        transform: `translateY(${s.sobe + s.balancoY}px) rotate(${s.giro}deg) scale(${
          s.escala * s.respira * s.a.sx
        }, ${s.escala * s.respira * s.a.sy})`,
        backgroundColor: cor,
        WebkitMaskImage: `url(${staticFile(d.arquivo)})`,
        maskImage: `url(${staticFile(d.arquivo)})`,
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        filter: s.a.brilho > 1.001 ? `brightness(${s.a.brilho})` : undefined,
        willChange: 'transform',
      }}
    />
  );
};

/** Uma versão completa da cena numa única paleta. */
const Cena: React.FC<{
  fundo: string;
  tinta: string;
  t: number;
  frame: number;
  fps: number;
  recorte?: string;
}> = ({fundo, tinta, t, frame, fps, recorte}) => {
  const ds = digitos.digitos as Digito[];
  const zoom = interpolate(t, [0, SEGUNDOS], [1.02, 1.07]) + pulso(t, COMPASSO) * 0.008;
  const camX = Math.sin(t * 0.38) * 22;
  const camY = Math.cos(t * 0.29) * 14;
  const camGiro = Math.sin(t * 0.24) * 0.5;

  return (
    <AbsoluteFill style={{backgroundColor: fundo, clipPath: recorte}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 62% 58% at 50% 50%, rgba(255,255,255,${
            0.13 + Math.max(0, pulso(t, COMPASSO)) * 0.1
          }) 0%, rgba(255,255,255,0) 72%)`,
        }}
      />
      <AbsoluteFill
        style={{
          transform: `translate(${camX}px, ${camY}px) rotate(${camGiro}deg) scale(${zoom})`,
          willChange: 'transform',
        }}
      >
        {ds.map((d) => (
          <Algarismo key={d.i} d={d} t={t} frame={frame} fps={fps} cor={tinta} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Numeros55670: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  const {de, para, mistura, indice} = paletaEm(t);

  /**
   * A troca de esquema é uma varredura diagonal, não um crossfade. Misturar as
   * cores em RGB passaria por tons que não são da campanha (roxo + amarelo dá
   * bege). Na varredura as duas cores continuam puras: o que muda é onde está a
   * fronteira. A borda inclinada entra alternando de lado a cada troca.
   */
  const daEsquerda = indice % 2 === 0;
  const p = interpolate(mistura, [0, 1], [-14, 114]);
  const recorte = daEsquerda
    ? `polygon(${p - 9}% 0%, ${p}% 100%, -5% 100%, -5% 0%)`
    : `polygon(${100 - p}% 0%, ${105}% 0%, 105% 100%, ${100 - p + 9}% 100%)`;

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Cena fundo={de.fundo} tinta={de.tinta} t={t} frame={frame} fps={fps} />
      {mistura > 0 ? (
        <Cena
          fundo={para.fundo}
          tinta={para.tinta}
          t={t}
          frame={frame}
          fps={fps}
          recorte={recorte}
        />
      ) : null}
    </AbsoluteFill>
  );
};
