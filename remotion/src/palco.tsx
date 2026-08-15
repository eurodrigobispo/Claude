import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile} from 'remotion';
import {BATIDA, COMPASSO, MEIO_TEMPO, acento, emBatidas, pulso} from './ritmo';

/**
 * O padrão que as quatro primeiras telas firmaram, agora num lugar só:
 * entrada cinética marcada em batidas, acento de chegada ao assentar, balanço
 * contínuo com duas senoides por eixo, respiro no meio tempo e uma onda de
 * acentos que volta a percorrer a cena depois que tudo entrou. Cada card novo
 * declara só o seu roteiro.
 */

export type Estilo =
  | 'pop'
  | 'sobe'
  | 'desce'
  | 'esquerda'
  | 'direita'
  | 'carimbo'
  | 'gira'
  | 'reveal';

export type Marca = {
  /** posição de entrada, em batidas da faixa */
  batida: number;
  estilo: Estilo;
  /** desencontra o balanço desta peça das vizinhas */
  fase: number;
  /** amplitude do balanço (1 = padrão) */
  balanco?: number;
  /** graus de giro contínuo ao longo do clipe (a estrela usa 540) */
  giro?: number;
};

export type Camada = {
  id: string;
  arquivo?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** peças reveladas uma a uma dentro desta camada (letras ou algarismos) */
  partes?: {i: number; arquivo: string; dx: number; w: number}[];
  /** pinta a peça pela máscara em vez de desenhar o PNG */
  cor?: string;
};

const forma = (estilo: Estilo, e: number, i: number) => {
  switch (estilo) {
    case 'esquerda':
      return {tx: interpolate(e, [0, 1], [-500, 0]), ty: 0, escala: interpolate(e, [0, 1], [0.72, 1]), giro: interpolate(e, [0, 1], [-13, 0])};
    case 'direita':
      return {tx: interpolate(e, [0, 1], [540, 0]), ty: 0, escala: interpolate(e, [0, 1], [0.72, 1]), giro: interpolate(e, [0, 1], [12, 0])};
    case 'sobe':
      return {tx: 0, ty: interpolate(e, [0, 1], [215, 0]), escala: interpolate(e, [0, 1], [0.62, 1]), giro: interpolate(e, [0, 1], [9, 0])};
    case 'desce':
      return {tx: 0, ty: interpolate(e, [0, 1], [-215, 0]), escala: interpolate(e, [0, 1], [0.62, 1]), giro: interpolate(e, [0, 1], [-9, 0])};
    case 'carimbo':
      return {tx: 0, ty: 0, escala: interpolate(e, [0, 1], [2.0, 1]), giro: interpolate(e, [0, 1], [i % 2 ? 8 : -8, 0])};
    case 'gira':
      return {tx: 0, ty: 0, escala: interpolate(e, [0, 1], [0.15, 1]), giro: 0};
    case 'reveal':
      return {tx: 0, ty: 0, escala: 1, giro: 0};
    default:
      return {tx: 0, ty: 0, escala: interpolate(e, [0, 1], [0.12, 1]), giro: interpolate(e, [0, 1], [-36, 0])};
  }
};

/** Curva curta e seca usada nas revelações peça a peça. */
const suaviza = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

export const Peca: React.FC<{
  pasta: string;
  camada: Camada;
  marca: Marca;
  t: number;
  frame: number;
  fps: number;
  /** posição na ordem de chegada — escalona a onda de acentos */
  indice: number;
  fimDasEntradas: number;
  segundos: number;
  /** intervalo entre as peças de uma revelação, em segundos */
  passoReveal?: number;
  /** direção da revelação */
  revelaDaEsquerda?: boolean;
  /** só balanço: sem acento, sem clarão, sem pulso na batida */
  sereno?: boolean;
  /** peça parada na posição de repouso — para exportar como imagem */
  congelado?: boolean;
}> = ({
  pasta,
  camada,
  marca,
  t,
  frame,
  fps,
  indice,
  fimDasEntradas,
  segundos,
  passoReveal = BATIDA / 8,
  revelaDaEsquerda = true,
  sereno = false,
  congelado = false,
}) => {
  const entrada = emBatidas(marca.batida);
  // congelado: a peça já entrou há muito e o balanço é zerado, então o quadro
  // sai na posição de repouso — é assim que ela vira uma imagem entregável
  const local = congelado ? 999 : t - entrada;
  const e = congelado
    ? 1
    : spring({
        frame: frame - entrada * fps,
        fps,
        config: {damping: 11, mass: 0.55, stiffness: 125},
      });
  /**
   * No modo sereno a peça entra e depois só balança: sem o acento de
   * estica-e-encolhe ao assentar (que achata), sem o clarão que ele carrega
   * (que pisca) e sem o respiro na batida (que pulsa). Sobra o deslocamento —
   * que e o unico movimento que o usuario quis nessas telas.
   */
  const NEUTRO = {sx: 1, sy: 1, brilho: 1};
  const a = sereno ? NEUTRO : acento(local - 0.45);
  const {tx, ty, escala, giro} = forma(marca.estilo, e, indice);

  const ehReveal = marca.estilo === 'reveal';
  const visivel = ehReveal
    ? 1
    : interpolate(local, [0, 0.15], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  // numa revelação o balanço só entra depois que a última peça assentou
  const fimReveal = ehReveal && camada.partes ? camada.partes.length * passoReveal + 0.2 : 0.33;
  const assentou = interpolate(local, [fimReveal, fimReveal + 0.7], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const amp = congelado ? 0 : marca.balanco ?? 1;
  const balancoY =
    (Math.sin(t * 2.0 + marca.fase) * 10 + Math.sin(t * 3.5 + marca.fase * 2) * 3.5) * amp * assentou;
  const balancoX =
    (Math.cos(t * 1.45 + marca.fase * 1.3) * 7 + Math.cos(t * 2.8 + marca.fase) * 2.5) * amp * assentou;
  const balancoGiro =
    (Math.sin(t * 1.6 + marca.fase * 0.7) * 2.4 + Math.sin(t * 3.0 + marca.fase * 1.9) * 1.0) * amp * assentou;
  const respira = sereno
    ? 1
    : 1 + pulso(t + marca.fase * 0.09, MEIO_TEMPO) * 0.045 * amp * assentou;

  const inicioOnda = fimDasEntradas + indice * (BATIDA / 2);
  const r =
    sereno || t < inicioOnda ? NEUTRO : acento((t - inicioOnda) % (COMPASSO * 2));

  const giroContinuo = marca.giro ? interpolate(local, [0, segundos], [0, marca.giro]) : 0;
  const brilho = a.brilho * r.brilho;

  return (
    <div
      style={{
        position: 'absolute',
        left: camada.x,
        top: camada.y,
        width: camada.w,
        height: camada.h,
        opacity: visivel,
        transform: `translate(${tx + balancoX}px, ${ty + balancoY}px) rotate(${
          giro + balancoGiro + giroContinuo
        }deg) scale(${escala * respira * a.sx * r.sx}, ${escala * respira * a.sy * r.sy})`,
        filter: brilho > 1.001 ? `brightness(${brilho})` : undefined,
        willChange: 'transform',
      }}
    >
      {camada.partes
        ? camada.partes.map((p) => {
            const ordem = revelaDaEsquerda ? p.i : camada.partes!.length - 1 - p.i;
            const surge = local - ordem * passoReveal;
            const s = suaviza(surge / 0.15);
            // Depois de aparecer, cada peça ganha vida própria dentro do grupo:
            // sem isso um número ou uma tag viram um bloco parado assim que a
            // revelação acaba, e a tela morre no meio do clipe.
            const viva = suaviza((surge - 0.25) / 0.5);
            const ondaY = Math.sin(t * 2.3 + p.i * 0.9) * 5 * viva;
            const ondaGiro = Math.sin(t * 1.8 + p.i * 0.7) * 1.2 * viva;
            const pulsa = sereno ? 1 : 1 + pulso(t + p.i * 0.06, MEIO_TEMPO) * 0.035 * viva;
            const comum: React.CSSProperties = {
              position: 'absolute',
              left: p.dx,
              top: 0,
              width: p.w,
              height: camada.h,
              opacity: s,
              transform: `translateY(${(1 - s) * 26 + ondaY}px) rotate(${ondaGiro}deg) scale(${
                (0.8 + s * 0.2) * pulsa
              })`,
            };
            return camada.cor ? (
              <div
                key={p.i}
                style={{
                  ...comum,
                  backgroundColor: camada.cor,
                  WebkitMaskImage: `url(${staticFile(`${pasta}/${p.arquivo}`)})`,
                  maskImage: `url(${staticFile(`${pasta}/${p.arquivo}`)})`,
                  WebkitMaskSize: '100% 100%',
                  maskSize: '100% 100%',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                }}
              />
            ) : (
              <Img key={p.i} src={staticFile(`${pasta}/${p.arquivo}`)} style={comum} />
            );
          })
        : camada.arquivo && (
            <Img
              src={staticFile(`${pasta}/${camada.arquivo}`)}
              style={{width: '100%', height: '100%'}}
            />
          )}
    </div>
  );
};

/**
 * Fundo, halo que respira no compasso e a câmera: aproximação lenta, deriva e
 * um respiro por compasso. No compasso, e não na batida — na batida o
 * movimento de câmera fica trepidante.
 */
export const Cena: React.FC<{
  /** `null` deixa o fundo transparente, para exportar em alfa */
  fundo: string | null;
  t: number;
  segundos: number;
  halo?: number;
  /** sem respiro no zoom e sem halo pulsando */
  sereno?: boolean;
  /**
   * Fator de enquadramento. Abaixo de 1 comprime a arte para o centro e sobra
   * mais borda dos lados — útil quando o card foi diagramado até quase a
   * margem e o vídeo precisa ficar mais centralizado.
   */
  enquadramento?: number;
  /**
   * Ponto em torno do qual a compressão acontece. O padrão é o centro; quem
   * tem peça sangrando no rodapé deve usar `50% 100%`, senão a compressão
   * descola a peça da borda de baixo e abre uma faixa de fundo.
   */
  origem?: string;
  children: React.ReactNode;
}> = ({
  fundo,
  t,
  segundos,
  halo = 0.3,
  sereno = false,
  enquadramento = 1,
  origem,
  children,
}) => {
  const deriva = sereno ? 1.0 : 1.015;
  const alcance = sereno ? 1.025 : 1.07;
  const zoom =
    (interpolate(t, [0, segundos], [deriva, alcance]) +
      (sereno ? 0 : pulso(t, COMPASSO) * 0.009)) *
    enquadramento;
  const camX = Math.sin(t * 0.4) * 24 + Math.sin(t * 1.05) * 5;
  const camY = Math.cos(t * 0.31) * 15;
  const camGiro = Math.sin(t * 0.26) * 0.5;
  const brilhoHalo = sereno ? halo : halo + Math.max(0, pulso(t, COMPASSO)) * halo * 0.8;

  return (
    <AbsoluteFill
      style={{backgroundColor: fundo ?? undefined, overflow: 'hidden'}}
    >
      {/* o halo é luz sobre o fundo; numa exportação em alfa ele viraria um
          véu branco por cima do recorte, então sai junto com o fundo */}
      {fundo === null ? null : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 60% 55% at 50% 48%, rgba(255,255,255,${brilhoHalo}) 0%, rgba(255,255,255,0) 70%)`,
          }}
        />
      )}
      <AbsoluteFill
        style={{
          transform: `translate(${camX}px, ${camY}px) rotate(${camGiro}deg) scale(${zoom})`,
          transformOrigin: origem,
          willChange: 'transform',
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Monta a tela a partir do roteiro, na ordem de chegada. */
export const montar = (
  pasta: string,
  camadas: Camada[],
  roteiro: Record<string, Marca>,
  ordem: string[],
  ctx: {
    t: number;
    frame: number;
    fps: number;
    fimDasEntradas: number;
    segundos: number;
    sereno?: boolean;
    congelado?: boolean;
    /**
     * Renderiza só a peça de id igual a este. Serve para exportar cada
     * elemento no seu próprio arquivo em alfa, mantendo a tela inteira de
     * 1920×1080 — assim o editor empilha tudo no After Effects e cai no lugar,
     * sem precisar reposicionar nada antes de começar.
     */
    somente?: string;
  },
  extras?: Record<string, {passoReveal?: number; revelaDaEsquerda?: boolean}>,
) => {
  const {somente, ...resto} = ctx;
  return camadas
    .filter((c) => roteiro[c.id])
    .filter((c) => !somente || c.id === somente)
    .map((c) => (
      <Peca
        key={c.id}
        pasta={pasta}
        camada={c}
        marca={roteiro[c.id]}
        indice={Math.max(0, ordem.indexOf(c.id))}
        {...resto}
        {...(extras?.[c.id] ?? {})}
      />
    ));
};
