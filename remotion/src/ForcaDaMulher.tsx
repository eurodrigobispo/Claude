import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import cena from '../public/04/cena.json';
import {emBatidas} from './ritmo';
import {Camada, Cena, Marca, montar} from './palco';

export const SEGUNDOS = 15;
export const FPS = 30;
export const DURACAO = Math.round(FPS * SEGUNDOS);

/**
 * "é a força da mulher!" — a frase entra palavra por palavra e a foto dentro da
 * estrela chega no primeiro tempo do segundo compasso, junto com "força".
 *
 * Aqui a estrela NÃO gira: neste card a foto vem recortada dentro da forma da
 * estrela, num PNG só, e girar o conjunto viraria a foto de cabeça para baixo.
 * O grupo ganha um balanço mais largo em troca.
 */
const ROTEIRO: Record<string, Marca> = {
  unha: {batida: 0.5, estilo: 'esquerda', fase: 4.0, balanco: 1.5},
  e: {batida: 1, estilo: 'carimbo', fase: 0.0, balanco: 1.1},
  a: {batida: 2, estilo: 'pop', fase: 1.4, balanco: 1.45},
  forca: {batida: 3, estilo: 'esquerda', fase: 2.2, balanco: 1.0},
  fotoEstrela: {batida: 4, estilo: 'pop', fase: 3.1, balanco: 0.85},
  mulher: {batida: 5, estilo: 'sobe', fase: 0.8, balanco: 1.05},
};

const ORDEM = ['unha', 'e', 'a', 'forca', 'fotoEstrela', 'mulher'];
const FIM = emBatidas(5) + 0.9;

export const ForcaDaMulher: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  return (
    <Cena fundo={cena.fundo} t={t} segundos={SEGUNDOS} halo={0.3}>
      {montar('04', cena.camadas as Camada[], ROTEIRO, ORDEM, {
        t,
        frame,
        fps,
        fimDasEntradas: FIM,
        segundos: SEGUNDOS,
      })}
    </Cena>
  );
};
