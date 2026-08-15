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
import cena from '../public/12/cena.json';
import {COMPASSO, CORES, MEIO_TEMPO, acento, emBatidas, pulso} from './ritmo';

export const LARGURA = 1920;
export const ALTURA = 1080;
export const FPS = 30;
export const SEGUNDOS = 15;
export const DURACAO = Math.round(FPS * SEGUNDOS);
const FUNDO = '#E4F1FB';

const ESPACO = cena.linha.espacamento; // 434 px entre fileiras
/**
 * A rolagem avança duas fileiras a cada três compassos. Como as cores alternam
 * de duas em duas, deslocar exatamente 2×ESPACO devolve a cena ao estado
 * inicial — o loop é infinito e invisível, sem salto.
 */
const CICLO_ROLAGEM = COMPASSO * 3;
const VELOCIDADE = (2 * ESPACO) / CICLO_ROLAGEM; // ≈ 178 px/s

/** Fileiras suficientes para cobrir a tela mais a folga do deslocamento. */
const N_FILEIRAS = Math.ceil((ALTURA + 2 * ESPACO) / ESPACO) + 2;
const Y_BASE = -2 * ESPACO - 60;

const ENTRADA_CARICATURA = emBatidas(4);

const Fileira: React.FC<{i: number; t: number}> = ({i, t}) => {
  // desloca no ciclo de duas fileiras: a cor de cada índice nunca muda
  const desloc = (t * VELOCIDADE) % (2 * ESPACO);
  const y = Y_BASE + i * ESPACO + desloc;
  // roxa, amarela, roxa, amarela… como pedido
  const cor = i % 2 === 0 ? CORES.roxo : CORES.amarelo;

  /**
   * A defasagem precisa depender só da paridade de `i`, nunca de `i` cheio.
   * No fechamento do ciclo cada posição de tela troca de índice em 2 unidades;
   * se a fase usasse `i`, ela pularia junto e a costura ficaria visível.
   * Com `i % 2` a fase é invariante ao ciclo e a rolagem fica contínua.
   */
  const par = i % 2;
  const respira = 1 + pulso(t + par * 0.16, COMPASSO) * 0.022;
  const desliza = Math.sin(t * 0.7 + par * Math.PI) * 14;

  return (
    <div
      style={{
        position: 'absolute',
        left: cena.linha.x,
        top: y,
        width: cena.linha.w,
        height: cena.linha.h,
        backgroundColor: cor,
        WebkitMaskImage: `url(${staticFile(cena.linha.arquivo)})`,
        maskImage: `url(${staticFile(cena.linha.arquivo)})`,
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        transform: `translateX(${desliza}px) scaleY(${respira})`,
        willChange: 'transform',
      }}
    />
  );
};

export const NumerosRolando: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  // --- primeiro plano: caricatura entra, estrela gira sem parar ---
  const local = t - ENTRADA_CARICATURA;
  const e = spring({
    frame: frame - ENTRADA_CARICATURA * fps,
    fps,
    config: {damping: 12, mass: 0.6, stiffness: 120},
  });
  const a = acento(local - 0.45);
  const visivel = interpolate(local, [0, 0.15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const assentou = interpolate(local, [0.33, 1.1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const entraEscala = interpolate(e, [0, 1], [0.25, 1]);
  const respira = 1 + pulso(t, MEIO_TEMPO) * 0.03 * assentou;
  const flutuaY = Math.sin(t * 1.6) * 12 * assentou;
  const flutuaX = Math.cos(t * 1.15) * 8 * assentou;
  const giroConjunto = Math.sin(t * 1.3) * 1.8 * assentou;

  // a estrela repete o giro contínuo do card 01: 1,5 volta nos 15 s
  const giroEstrela = interpolate(local, [0, SEGUNDOS], [0, 540]);

  const zoom = interpolate(t, [0, SEGUNDOS], [1.01, 1.055]) + pulso(t, COMPASSO) * 0.007;
  const camX = Math.sin(t * 0.36) * 18;
  const camGiro = Math.sin(t * 0.22) * 0.4;

  const est = cena.estrela;
  const car = cena.caricatura;

  return (
    <AbsoluteFill style={{backgroundColor: FUNDO, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          transform: `translateX(${camX}px) rotate(${camGiro}deg) scale(${zoom})`,
          willChange: 'transform',
        }}
      >
        {Array.from({length: N_FILEIRAS}, (_, i) => (
          <Fileira key={i} i={i} t={t} />
        ))}

        {/* estrela e caricatura vêm separadas do card 01, encaixadas na escala
            deste card — no PNG original deste card elas vêm fundidas e a
            estrela não poderia girar sozinha */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: LARGURA,
            height: ALTURA,
            opacity: visivel,
            transform: `translate(${flutuaX}px, ${flutuaY}px) rotate(${giroConjunto}deg) scale(${
              entraEscala * respira * a.sx
            }, ${entraEscala * respira * a.sy})`,
            transformOrigin: `${car.x + car.w / 2}px ${car.y + car.h / 2}px`,
            // A estrela é amarela e as fileiras ímpares também: sem uma sombra
            // que descole o primeiro plano, ela desaparece toda vez que passa
            // sobre uma fileira amarela.
            filter: `drop-shadow(0 16px 34px rgba(28, 10, 60, 0.30))${
              a.brilho > 1.001 ? ` brightness(${a.brilho})` : ''
            }`,
            willChange: 'transform',
          }}
        >
          <Img
            src={staticFile(est.arquivo)}
            style={{
              position: 'absolute',
              left: est.x,
              top: est.y,
              width: est.w,
              height: est.h,
              transform: `rotate(${giroEstrela}deg)`,
            }}
          />
          <Img
            src={staticFile(car.arquivo)}
            style={{
              position: 'absolute',
              left: car.x,
              top: car.y,
              width: car.w,
              height: car.h,
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
