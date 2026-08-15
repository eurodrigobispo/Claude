import React from 'react';
import {Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import cena13 from '../public/13/cena.json';
import cena14 from '../public/14/cena.json';
import {MEIO_TEMPO, acento, emBatidas, pulso} from './ritmo';
import {Cena} from './palco';

export const SEGUNDOS = 15;
export const FPS = 30;
export const DURACAO = Math.round(FPS * SEGUNDOS);

const ENTRADA = emBatidas(0.5);

/**
 * Os cards 13 e 14 são o mesmo coração da marca em dois fundos, roxo e azul
 * claro. Uma composição só, com o fundo e o sentido do giro como parâmetro:
 * são peças de passagem, feitas para entrar num corte curto entre duas telas
 * de letra. O coração chega girando e não para mais de respirar.
 */
const Coracao: React.FC<{pasta: string; fundo: string; sentido: 1 | -1}> = ({
  pasta,
  fundo,
  sentido,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const local = t - ENTRADA;

  const cfg = pasta === '13' ? cena13.coracao : cena14.coracao;

  const e = spring({
    frame: frame - ENTRADA * fps,
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

  const entra = interpolate(e, [0, 1], [0.1, 1]);
  const giroEntrada = interpolate(e, [0, 1], [sentido * 210, 0]);
  /**
   * É um elemento só numa tela vazia, então ele precisa se mexer bem mais que
   * uma peça de uma tela cheia — com a amplitude das outras telas, aqui a
   * imagem lia como parada. Quarto de volta ao longo dos 15 s, balanço largo e
   * deriva em duas frequências por eixo.
   */
  const giroLento = interpolate(local, [0, SEGUNDOS], [0, sentido * 90]);
  const balanco = (Math.sin(t * 1.5) * 5.5 + Math.sin(t * 2.6 + 0.8) * 2.2) * assentou;
  const flutuaY = (Math.sin(t * 1.7) * 30 + Math.sin(t * 2.9 + 1.3) * 11) * assentou;
  const flutuaX = (Math.cos(t * 1.2) * 22 + Math.cos(t * 2.3 + 0.5) * 8) * assentou;
  const respira = 1 + pulso(t, MEIO_TEMPO) * 0.09 * assentou;

  return (
    <Cena fundo={fundo} t={t} segundos={SEGUNDOS} halo={fundo === '#6B1DE8' ? 0.16 : 0.3}>
      <div
        style={{
          position: 'absolute',
          left: cfg.x,
          top: cfg.y,
          width: cfg.w,
          height: cfg.h,
          opacity: visivel,
          transform: `translate(${flutuaX}px, ${flutuaY}px) rotate(${
            giroEntrada + giroLento + balanco
          }deg) scale(${entra * respira * a.sx}, ${entra * respira * a.sy})`,
          filter: a.brilho > 1.001 ? `brightness(${a.brilho})` : undefined,
          willChange: 'transform',
        }}
      >
        <Img src={staticFile(`${pasta}/${cfg.arquivo}`)} style={{width: '100%', height: '100%'}} />
      </div>
    </Cena>
  );
};

export const Coracao13: React.FC = () => <Coracao pasta="13" fundo={cena13.fundo} sentido={-1} />;
export const Coracao14: React.FC = () => <Coracao pasta="14" fundo={cena14.fundo} sentido={1} />;
