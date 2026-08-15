import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import cena from '../public/08/cena.json';
import {BATIDA, emBatidas} from './ritmo';
import {Camada, Cena, Marca, montar} from './palco';

export const SEGUNDOS = 15;
export const FPS = 30;
export const DURACAO = Math.round(FPS * SEGUNDOS);

/**
 * O 55670 na variante rosa. A outra tela de número troca de paleta e revela um
 * algarismo por meio tempo; esta fica no esquema fixo do card e revela um por
 * batida — o dobro da velocidade. Serve de estampida curta no corte, enquanto
 * a outra serve de plano longo.
 */
const ROTEIRO: Record<string, Marca> = {
  numero: {batida: 1, estilo: 'reveal', fase: 0.0, balanco: 1.0},
};

const FIM = emBatidas(1) + 5 * BATIDA + 0.4;

export const Numeros55670Rosa: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  const camadas: Camada[] = [
    {
      id: 'numero',
      x: cena.numero.x,
      y: cena.numero.y,
      w: 1920,
      h: cena.numero.h,
      partes: cena.numero.digitos,
      cor: cena.tinta,
    },
  ];

  return (
    <Cena fundo={cena.fundo} t={t} segundos={SEGUNDOS} halo={0.12}>
      {montar(
        '08',
        camadas,
        ROTEIRO,
        ['numero'],
        {t, frame, fps, fimDasEntradas: FIM, segundos: SEGUNDOS},
        {numero: {passoReveal: BATIDA}},
      )}
    </Cena>
  );
};
