import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import cena from '../public/11/cena.json';
import {BATIDA, emBatidas} from './ritmo';
import {Camada, Cena, Marca, montar} from './palco';

export const LARGURA = 1920;
export const ALTURA = 1080;
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

/** Elementos exportáveis isoladamente, na ordem de empilhamento do card. */
export const ELEMENTOS = ORDEM;

export type Recorte = {x: number; y: number; w: number; h: number};

export const EuToFechadao: React.FC<{
  /** sem fundo, para exportar em ProRes 4444 com alfa */
  transparente?: boolean;
  /** exporta só este elemento */
  somente?: string;
  /**
   * Reduz o quadro à caixa útil do elemento. Sem isto cada peça sai em
   * 1920×1080 com quase tudo transparente — medido, o recorte usa 12% do peso
   * de pixels. O `x/y` é devolvido no manifesto para o editor reposicionar.
   */
  recorte?: Recorte | null;
  /** posição de repouso, sem entrada nem balanço — para exportar como imagem */
  congelado?: boolean;
}> = ({transparente = false, somente = '', recorte = null, congelado = false}) => {
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

  const tela = (
    <Cena
      fundo={transparente ? null : cena.fundo}
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
        somente,
        congelado,
      })}
    </Cena>
  );

  if (!recorte) return tela;

  // o quadro vira do tamanho da caixa útil e a cena inteira desliza para dentro
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          left: -recorte.x,
          top: -recorte.y,
          width: LARGURA,
          height: ALTURA,
        }}
      >
        {tela}
      </div>
    </AbsoluteFill>
  );
};

/** Quando vem `recorte`, o quadro deixa de ser 1920×1080 e passa a ser a caixa. */
export const metadadosEuToFechadao = ({props}: {props: {recorte?: Recorte | null}}) =>
  props.recorte
    ? {width: props.recorte.w, height: props.recorte.h}
    : {width: LARGURA, height: ALTURA};
