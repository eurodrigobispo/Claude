/**
 * Exporta uma tela em alfa para remontagem no After Effects.
 *
 * Gera a tela inteira transparente e cada elemento no seu próprio arquivo, em
 * ProRes 4444 (.mov) — o codec com canal alfa que o After Effects lê nativo.
 *
 * Por padrão cada elemento sai **recortado na sua caixa útil**, não em
 * 1920×1080. A caixa foi medida percorrendo o clipe inteiro e pegando a união
 * de todas as posições que o elemento ocupa, mais 16 px de folga — o balanço
 * mexe as peças, então a caixa de um quadro só não serviria. Em quadro cheio
 * o conjunto usa 8× mais pixels, quase todos transparentes.
 *
 * Como o recorte tira a peça do lugar, o script escreve um `posicoes.txt` com
 * o valor de Position que cada arquivo precisa receber numa composição de
 * 1920×1080. Com `--cheio` os arquivos saem em 1920×1080 e caem sozinhos no
 * lugar, sem manifesto, ao custo do peso.
 *
 * Uso:
 *   npm run alpha                       tela padrão, recortado
 *   npm run alpha -- --cheio            em 1920×1080
 *   npm run alpha -- --segundos=3       amostra dos primeiros 3 s
 *   npm run alpha -- --so=eu,foto       só os elementos citados
 *   npm run alpha -- --dividir=2        cada elemento em 2 clipes seguidos
 *   npm run alpha -- --tudo-video       força vídeo até no que é imagem parada
 */
import {spawnSync} from 'node:child_process';
import {mkdirSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const LARGURA = 1920;
const ALTURA = 1080;

/**
 * Caixa útil de cada elemento, medida sobre o clipe inteiro. Na ordem de
 * empilhamento do card, de baixo para cima.
 */
/**
 * Elementos que são imagem parada: só entram e balançam de leve, sem animação
 * interna. Exportar 15 s de ProRes para eles custava 556 MB dos 750 MB do
 * pacote — como PNG somam 5,8 MB. Vão como imagem, e o manifesto descreve o
 * movimento para o editor refazer no AE, que é onde ele vai querer ajustar a
 * posição de qualquer forma.
 */
const ESTATICOS = {EuToFechadao: ['coracao', 'foto']};

/** Entrada de cada peça, em segundos (batida da faixa = 0,40596 s). */
const ENTRADAS = {
  EuToFechadao: {
    coracao: 0.20, foto: 0.41, eu: 0.81, to: 1.22, fechadao: 1.62,
    com: 2.03, andrea: 2.23, castro: 2.64, tag: 3.25,
  },
};

const MOVIMENTO = {
  coracao: 'entra com pop (escala 0,12 -> 1, giro -36deg -> 0) em ~0,5 s; depois gira 22deg ao longo dos 15 s e balanca +-13 px',
  foto: 'entra subindo 215 px (escala 0,62 -> 1) em ~0,5 s; depois balanca +-7 px, bem de leve',
};

const TELAS = {
  EuToFechadao: [
    {id: 'coracao', x: 238, y: 204, w: 748, h: 702},
    {id: 'foto', x: 178, y: 214, w: 818, h: 866},
    {id: 'eu', x: 634, y: 314, w: 712, h: 296},
    {id: 'to', x: 1258, y: 188, w: 232, h: 302},
    {id: 'fechadao', x: 1288, y: 414, w: 632, h: 206},
    {id: 'com', x: 1024, y: 578, w: 182, h: 148},
    {id: 'andrea', x: 1004, y: 498, w: 816, h: 372},
    {id: 'castro', x: 1014, y: 698, w: 552, h: 382},
    {id: 'tag', x: 1114, y: 864, w: 476, h: 142},
  ],
};

const args = process.argv.slice(2);
const opt = (n, p) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split('=').slice(1).join('=') : p;
};
const flag = (n) => args.includes(`--${n}`);

const tela = opt('tela', 'EuToFechadao');
const segundos = Number(opt('segundos', '0'));
const filtro = opt('so', '');
const cheio = flag('cheio');

if (!TELAS[tela]) {
  console.error(`Tela "${tela}" ainda não tem caixas medidas aqui.`);
  console.error(`Disponíveis: ${Object.keys(TELAS).join(', ')}`);
  process.exit(1);
}

let elementos = TELAS[tela];
if (filtro) {
  const pedidos = filtro.split(',').map((s) => s.trim());
  const fora = pedidos.filter((p) => !elementos.some((e) => e.id === p));
  if (fora.length) {
    console.error(`Elemento desconhecido: ${fora.join(', ')}`);
    console.error(`Desta tela: ${elementos.map((e) => e.id).join(', ')}`);
    process.exit(1);
  }
  elementos = elementos.filter((e) => pedidos.includes(e.id));
}

const destino = join('out', 'alpha', tela);
mkdirSync(destino, {recursive: true});

const COMUNS = [
  '--codec=prores',
  '--prores-profile=4444',
  // sem isto o quadro sai em JPEG e o alfa se perde no caminho
  '--image-format=png',
  '--pixel-format=yuva444p10le',
  '--concurrency=4',
];
const recorteFrames = segundos > 0 ? [`--frames=0-${Math.round(segundos * 30) - 1}`] : [];
/**
 * Divide cada elemento em N clipes seguidos. Serve quando o destino tem limite
 * de tamanho por arquivo — o editor põe as partes em sequência na mesma
 * camada, com a mesma Position, e o resultado é idêntico ao arquivo inteiro.
 */
const partes = Math.max(1, Number(opt('dividir', '1')));
const TOTAL_FRAMES = 450;
const fatias =
  partes === 1
    ? [{sufixo: '', frames: recorteFrames}]
    : Array.from({length: partes}, (_, k) => {
        const ini = Math.round((k * TOTAL_FRAMES) / partes);
        const fim = Math.round(((k + 1) * TOTAL_FRAMES) / partes) - 1;
        return {
          sufixo: `_parte${String.fromCharCode(65 + k)}`,
          frames: [`--frames=${ini}-${fim}`],
          inicio: ini / 30,
        };
      });

const renderizar = (arquivo, props, frames = recorteFrames) =>
  spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'remotion',
      'render',
      tela,
      arquivo,
      ...COMUNS,
      ...frames,
      `--props=${JSON.stringify(props)}`,
    ],
    {stdio: 'inherit'},
  ).status === 0;

console.log(`Tela: ${tela}`);
console.log(`Saída: ${destino}`);
console.log(cheio ? 'Quadro cheio 1920×1080' : 'Recortado na caixa útil de cada elemento');
if (segundos > 0) console.log(`Amostra dos primeiros ${segundos} s`);
console.log(`${elementos.length + 1} arquivos\n`);

const falhas = [];

/**
 * A chapa de fundo. Em modo sereno o halo não pulsa e o fundo não se move,
 * então ele é uma imagem parada — 0,3 MB de PNG no lugar de centenas de MB de
 * vídeo. Sem ela o editor perde o halo e o fundo fica chapado.
 */
console.log('[0] chapa de fundo');
const fundoOk =
  spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'remotion',
      'still',
      tela,
      join(destino, 'fundo.png'),
      '--image-format=png',
      `--props=${JSON.stringify({transparente: false, somente: '__nenhum__'})}`,
    ],
    {stdio: 'inherit'},
  ).status === 0;
if (!fundoOk) falhas.push('fundo');

// referência só para conferir a remontagem — em H.264, que pesa uma fração
console.log('\n[1] tela inteira (referência, H.264)');
const refOk =
  spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'remotion',
      'render',
      tela,
      join(destino, `00_${tela}_referencia.mp4`),
      '--crf=20',
      '--concurrency=4',
      ...recorteFrames,
    ],
    {stdio: 'inherit'},
  ).status === 0;
if (!refOk) falhas.push('referencia');

const estaticos = flag('tudo-video') ? [] : ESTATICOS[tela] ?? [];

elementos.forEach((el, i) => {
  const parado = estaticos.includes(el.id);
  console.log(`\n[${i + 2}] ${el.id}${parado ? ' (imagem parada)' : ''}`);
  const caixa = cheio ? null : {x: el.x, y: el.y, w: el.w, h: el.h};

  if (parado) {
    // um PNG na posição de repouso, no lugar de 15 s de vídeo
    const ok =
      spawnSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        [
          'remotion',
          'still',
          tela,
          join(destino, `${String(i + 1).padStart(2, '0')}_${el.id}.png`),
          '--image-format=png',
          `--props=${JSON.stringify({transparente: true, somente: el.id, recorte: caixa, congelado: true})}`,
        ],
        {stdio: 'inherit'},
      ).status === 0;
    if (!ok) falhas.push(el.id);
    return;
  }

  for (const fatia of fatias) {
    const nome = `${String(i + 1).padStart(2, '0')}_${el.id}${fatia.sufixo}.mov`;
    if (
      !renderizar(join(destino, nome), {transparente: true, somente: el.id, recorte: caixa}, fatia.frames)
    ) {
      falhas.push(el.id + fatia.sufixo);
    }
  }
});

// manifesto de posições — sem ele o editor não sabe onde recolocar o recorte
if (!cheio) {
  const linhas = [
    `Remontagem de ${tela} no After Effects`,
    ``,
    `Composição: ${LARGURA}x${ALTURA}, 30 fps, 15 s`,
    `Importe os .mov, empilhe na ordem dos números (00 é a tela inteira, só`,
    `para conferência) e dê a cada camada o Position abaixo. Com esses valores`,
    `a tela fica idêntica ao render original.`,
    ``,
    `Ordem da pilha, de baixo para cima:`,
    `  fundo.png  (chapa de fundo, imagem parada — o halo nao pulsa)`,
    `  depois os .mov na ordem numerica`,
    ``,
    `arquivo                        tamanho        Position (x, y)     entra em`,
    `------------------------------ -------------- ------------------ --------`,
  ];
  elementos.forEach((el, i) => {
    const parado = estaticos.includes(el.id);
    const nome = `${String(i + 1).padStart(2, '0')}_${el.id}.${parado ? 'png' : 'mov'}`;
    const px = (el.x + el.w / 2).toFixed(1);
    const py = (el.y + el.h / 2).toFixed(1);
    const entra = (ENTRADAS[tela] ?? {})[el.id];
    linhas.push(
      `${nome.padEnd(30)} ${`${el.w}x${el.h}`.padEnd(14)} ${`${px}, ${py}`.padEnd(18)} ${
        entra !== undefined ? `${entra.toFixed(2)}s` : ''
      }`,
    );
  });
  linhas.push(``, `O anchor point de cada camada fica no centro dela, que é o padrão do AE.`);
  if (partes > 1) {
    linhas.push(
      ``,
      `ARQUIVOS DIVIDIDOS`,
      `Cada elemento saiu em ${partes} clipes (_parteA, _parteB...). Ponha um`,
      `depois do outro na mesma camada, com a mesma Position. Os cortes caem em:`,
      fatias.map((f) => `  ${f.sufixo.replace('_', '')}: ${f.inicio.toFixed(2)}s`).join('\n'),
    );
  }
  if (estaticos.length) {
    linhas.push(
      ``,
      `IMAGENS PARADAS`,
      `Os arquivos .png sao imagem, nao video: essas pecas so entram e balancam`,
      `de leve, sem animacao interna. Em video pesavam 556 MB dos 750 MB do`,
      `pacote. O movimento a refazer no AE:`,
      ``,
    );
    estaticos.forEach((id) => {
      if (MOVIMENTO[id]) linhas.push(`  ${id}: ${MOVIMENTO[id]}`);
    });
    linhas.push(
      ``,
      `Nenhum dos dois pulsa, pisca ou achata — so desloca e gira, bem de leve.`,
    );
  }
  writeFileSync(join(destino, 'posicoes.txt'), linhas.join('\n') + '\n');
  writeFileSync(
    join(destino, 'posicoes.json'),
    JSON.stringify({composicao: {largura: LARGURA, altura: ALTURA, fps: 30}, elementos}, null, 2) + '\n',
  );
  console.log('\nManifesto: posicoes.txt e posicoes.json');
}

console.log();
let total = 0;
for (const f of readdirSync(destino).filter((f) => /\.(mov|mp4|png)$/.test(f)).sort()) {
  const mb = statSync(join(destino, f)).size / 1048576;
  total += mb;
  console.log(`  ${f.padEnd(34)} ${mb.toFixed(1)} MB`);
}
console.log(`  ${''.padEnd(34)} ${total.toFixed(1)} MB no total`);

if (falhas.length) {
  console.log(`\nFalharam: ${falhas.join(', ')}`);
  process.exit(1);
}
