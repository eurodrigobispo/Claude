import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import cena from '../public/07/cena.json';
import {BATIDA, emBatidas} from './ritmo';
import {Camada, Cena, Marca, montar} from './palco';

export const SEGUNDOS = 15;
export const FPS = 30;
export const DURACAO = Math.round(FPS * SEGUNDOS);

/**
 * Tela de assinatura: o coração da marca, o nome e o número. É o fecho, então
 * a leitura é mais assentada que nas telas de letra — coração, nome, e só
 * depois os algarismos, um por batida.
 *
 * O 55670 aqui é branco e de cor sólida, então virou máscara e é pintado por
 * CSS, igual ao das outras telas de número.
 */
const ROTEIRO: Record<string, Marca> = {
  logo: {batida: 1, estilo: 'pop', fase: 1.7, balanco: 0.9},
  nome: {batida: 2.5, estilo: 'direita', fase: 0.6, balanco: 0.8},
  numero: {batida: 4, estilo: 'reveal', fase: 2.9, balanco: 1.0},
};

const ORDEM = ['logo', 'nome', 'numero'];
const FIM = emBatidas(4) + 5 * BATIDA + 0.4;

export const Assinatura55670: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  const camadas: Camada[] = [
    ...(cena.camadas as Camada[]),
    {
      id: 'numero',
      x: cena.numero.x,
      y: cena.numero.y,
      w: 1920,
      h: cena.numero.h,
      partes: cena.numero.digitos,
      cor: '#E4F1FB',
    },
  ];

  return (
    <Cena fundo={cena.fundo} t={t} segundos={SEGUNDOS} halo={0.16}>
      {montar(
        '07',
        camadas,
        ROTEIRO,
        ORDEM,
        {t, frame, fps, fimDasEntradas: FIM, segundos: SEGUNDOS},
        // um algarismo por batida: no fecho a leitura do número é o assunto
        {numero: {passoReveal: BATIDA}},
      )}
    </Cena>
  );
};
