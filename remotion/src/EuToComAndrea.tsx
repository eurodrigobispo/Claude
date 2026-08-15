import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import cena from '../public/05/cena.json';
import {emBatidas} from './ritmo';
import {Camada, Cena, Marca, montar} from './palco';

export const SEGUNDOS = 15;
export const FPS = 30;
export const DURACAO = Math.round(FPS * SEGUNDOS);

/**
 * Mesma frase da tela "tô com Andréa", agora com a foto no lugar da
 * caricatura — então vale a mesma grade que eu medi no canto: "representa"
 * entra na batida 8 (3,25 s), que é onde cai o ataque mais forte da faixa, e
 * "porque" e "ela" vêm coladas nas duas batidas anteriores. As duas telas
 * podem ser trocadas uma pela outra no corte sem mexer no tempo.
 */
const ROTEIRO: Record<string, Marca> = {
  foto: {batida: 0, estilo: 'esquerda', fase: 2.4, balanco: 0.45},
  eu: {batida: 1, estilo: 'carimbo', fase: 0.0, balanco: 1.15},
  tocom: {batida: 2, estilo: 'direita', fase: 1.1, balanco: 1.3},
  coracao: {batida: 2.5, estilo: 'pop', fase: 4.3, balanco: 1.5},
  andrea: {batida: 3, estilo: 'sobe', fase: 2.0, balanco: 1.0},
  porque: {batida: 6, estilo: 'esquerda', fase: 0.7, balanco: 1.25},
  ela: {batida: 7, estilo: 'pop', fase: 4.1, balanco: 1.4},
  representa: {batida: 8, estilo: 'carimbo', fase: 1.6, balanco: 1.05},
};

const ORDEM = ['foto', 'eu', 'tocom', 'coracao', 'andrea', 'porque', 'ela', 'representa'];
const FIM = emBatidas(8) + 0.9;

export const EuToComAndrea: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  return (
    <Cena fundo={cena.fundo} t={t} segundos={SEGUNDOS} halo={0.14}>
      {montar('05', cena.camadas as Camada[], ROTEIRO, ORDEM, {
        t,
        frame,
        fps,
        fimDasEntradas: FIM,
        segundos: SEGUNDOS,
      })}
    </Cena>
  );
};
