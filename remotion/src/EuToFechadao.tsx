import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import cena from '../public/11/cena.json';
import {BATIDA, emBatidas} from './ritmo';
import {Camada, Cena, Marca, montar} from './palco';

export const SEGUNDOS = 15;
export const FPS = 30;
export const DURACAO = Math.round(FPS * SEGUNDOS);

/**
 * "eu tô fechadão com Andréa Castro" — a foto e o coração da marca abrem a
 * cena e a frase entra palavra por palavra na cadência da faixa. A tag
 * DEPUTADA ESTADUAL não é cantada: fecha por último, letra por letra, como na
 * tela do "tô com Andréa".
 */
const ROTEIRO: Record<string, Marca> = {
  coracao: {batida: 0.5, estilo: 'pop', fase: 3.6, balanco: 0.9, giro: 22},
  foto: {batida: 1, estilo: 'sobe', fase: 2.4, balanco: 0.5},
  eu: {batida: 2, estilo: 'esquerda', fase: 0.0, balanco: 1.15},
  to: {batida: 3, estilo: 'desce', fase: 1.1, balanco: 1.4},
  fechadao: {batida: 4, estilo: 'direita', fase: 2.0, balanco: 1.05},
  com: {batida: 5, estilo: 'pop', fase: 4.3, balanco: 1.5},
  andrea: {batida: 5.5, estilo: 'carimbo', fase: 1.5, balanco: 1.0},
  castro: {batida: 6.5, estilo: 'sobe', fase: 0.7, balanco: 1.0},
  tag: {batida: 8, estilo: 'reveal', fase: 3.3, balanco: 0.8},
};

const ORDEM = ['coracao', 'foto', 'eu', 'to', 'fechadao', 'com', 'andrea', 'castro', 'tag'];
const FIM = emBatidas(8) + 16 * (BATIDA / 8) + 0.3;

export const EuToFechadao: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  const camadas: Camada[] = [
    ...(cena.camadas as Camada[]),
    {
      id: 'tag',
      x: cena.tag.x,
      y: cena.tag.y,
      w: 1920,
      h: cena.tag.h,
      partes: cena.tag.letras,
    },
  ];

  return (
    <Cena
      fundo={cena.fundo}
      t={t}
      segundos={SEGUNDOS}
      halo={0.3}
      sereno
      /**
       * O card foi diagramado quase até a margem: a arte ia de x=99 a x=1765,
       * e com o zoom da câmera sobrava pouco mais de 20 px de um lado. Comprime
       * para o centro e a borda lateral volta.
       */
      enquadramento={0.84}
      /** a foto sangra no rodapé por projeto, então a compressão parte de lá */
      origem="50% 100%"
    >
      {montar('11', camadas, ROTEIRO, ORDEM, {
        t,
        frame,
        fps,
        fimDasEntradas: FIM,
        segundos: SEGUNDOS,
        sereno: true,
      })}
    </Cena>
  );
};
