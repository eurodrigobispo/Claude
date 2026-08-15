import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import cena from '../public/03/cena.json';
import {emBatidas} from './ritmo';
import {Camada, Cena, Marca, montar} from './palco';

export const SEGUNDOS = 15;
export const FPS = 30;
export const DURACAO = Math.round(FPS * SEGUNDOS);

/**
 * "deixa com ela!" — aqui a estrela e a caricatura vieram separadas do Figma,
 * então a estrela gira sozinha atrás dela, como no card 01.
 */
const ROTEIRO: Record<string, Marca> = {
  estrela: {batida: 1, estilo: 'gira', fase: 2.4, giro: 540},
  caricatura: {batida: 1.5, estilo: 'carimbo', fase: 3.1, balanco: 0.75},
  deixa: {batida: 4, estilo: 'esquerda', fase: 0.0, balanco: 1.1},
  com: {batida: 5, estilo: 'sobe', fase: 1.1, balanco: 1.35},
  ela: {batida: 6, estilo: 'carimbo', fase: 0.4, balanco: 1.15},
  selo: {batida: 6.5, estilo: 'pop', fase: 4.2, balanco: 1.5},
  coracao: {batida: 7, estilo: 'pop', fase: 1.7, balanco: 1.45},
};

const ORDEM = ['estrela', 'caricatura', 'deixa', 'com', 'ela', 'selo', 'coracao'];
const FIM = emBatidas(7) + 0.8;

export const DeixaComEla: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  return (
    <Cena fundo={cena.fundo} t={t} segundos={SEGUNDOS} halo={0.16}>
      {montar('03', cena.camadas as Camada[], ROTEIRO, ORDEM, {
        t,
        frame,
        fps,
        fimDasEntradas: FIM,
        segundos: SEGUNDOS,
      })}
    </Cena>
  );
};
