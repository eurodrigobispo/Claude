import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import cena from '../public/02/cena.json';
import {COMPASSO, MEIO_TEMPO, acento, emBatidas, pulso} from './ritmo';

export const SEGUNDOS = 15;
export const FPS = 30;
export const DURACAO = Math.round(FPS * SEGUNDOS);

/**
 * A bandeira é uma foto única — não há camadas para entrar em sequência. Em
 * vez de só empurrar a imagem inteira, ela é cortada em faixas verticais e
 * cada faixa desliza no eixo Y seguindo uma onda que viaja do mastro para a
 * ponta. É o jeito clássico de fazer pano em 2D, e aqui funciona porque o
 * mastro está a 14% da borda esquerda do PNG: a amplitude sai de zero ali e
 * cresce até a ponta livre, então o mastro fica firme e só o tecido ondula.
 */
const FAIXAS = 56;
/** Onde o mastro está, em fração da largura do PNG. */
const MASTRO = 0.145;
const ENTRADA = emBatidas(0.5);

const Faixa: React.FC<{i: number; t: number; abriu: number}> = ({i, t, abriu}) => {
  const b = cena.bandeira;
  const larg = b.w / FAIXAS;
  const pos = i / (FAIXAS - 1);
  // distância ao mastro, normalizada: 0 no mastro, 1 na ponta
  const fx = Math.max(0, (pos - MASTRO) / (1 - MASTRO));
  const rampa = Math.pow(fx, 1.7) * abriu;

  // duas ondas de períodos diferentes: uma no meio tempo, outra no compasso
  const w1 = (Math.PI * 2) / MEIO_TEMPO;
  const w2 = (Math.PI * 2) / COMPASSO;
  const dy =
    (Math.sin(t * w1 - fx * 5.4) * 26 + Math.sin(t * w2 - fx * 2.7 + 1.1) * 11) * rampa;
  // o pano também encolhe de leve onde a onda está mais inclinada
  const encolhe = 1 - Math.abs(Math.cos(t * w1 - fx * 5.4)) * 0.012 * rampa;

  return (
    <div
      style={{
        position: 'absolute',
        left: i * larg,
        top: 0,
        width: larg + 1,
        height: b.h,
        overflow: 'hidden',
        transform: `translateY(${dy}px) scaleY(${encolhe})`,
        willChange: 'transform',
      }}
    >
      <Img
        src={staticFile('02/bandeira.png')}
        style={{position: 'absolute', left: -i * larg, top: 0, width: b.w, height: b.h}}
      />
    </div>
  );
};

export const Bandeira: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const local = t - ENTRADA;

  const e = spring({
    frame: frame - ENTRADA * fps,
    fps,
    config: {damping: 13, mass: 0.7, stiffness: 110},
  });
  const a = acento(local - 0.5);
  const visivel = interpolate(local, [0, 0.2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // a ondulação só ganha corpo depois que a bandeira assentou
  const abriu = interpolate(local, [0.2, 1.2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const entra = interpolate(e, [0, 1], [0.55, 1]);
  const giroEntrada = interpolate(e, [0, 1], [-7, 0]);
  const respira = 1 + pulso(t, MEIO_TEMPO) * 0.02 * abriu;
  const flutua = Math.sin(t * 0.9) * 10 * abriu;

  // câmera: aproximação lenta com deriva larga, o quadro nunca fica parado
  const zoom = interpolate(t, [0, SEGUNDOS], [1.02, 1.09]) + pulso(t, COMPASSO) * 0.008;
  const camX = Math.sin(t * 0.34) * 30;
  const camY = Math.cos(t * 0.27) * 18;
  const camGiro = Math.sin(t * 0.21) * 0.6;

  return (
    <AbsoluteFill style={{backgroundColor: cena.fundo, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 62% 58% at 52% 46%, rgba(255,255,255,${
            0.3 + Math.max(0, pulso(t, COMPASSO)) * 0.22
          }) 0%, rgba(255,255,255,0) 72%)`,
        }}
      />
      <AbsoluteFill
        style={{
          transform: `translate(${camX}px, ${camY}px) rotate(${camGiro}deg) scale(${zoom})`,
          willChange: 'transform',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: cena.bandeira.x,
            top: cena.bandeira.y,
            width: cena.bandeira.w,
            height: cena.bandeira.h,
            opacity: visivel,
            transform: `translateY(${flutua}px) rotate(${giroEntrada}deg) scale(${
              entra * respira * a.sx
            }, ${entra * respira * a.sy})`,
            // gira em torno do pé do mastro, que é onde a bandeira se prende
            transformOrigin: `${cena.bandeira.w * MASTRO}px 100%`,
            filter: a.brilho > 1.001 ? `brightness(${a.brilho})` : undefined,
            willChange: 'transform',
          }}
        >
          {Array.from({length: FAIXAS}, (_, i) => (
            <Faixa key={i} i={i} t={t} abriu={abriu} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
