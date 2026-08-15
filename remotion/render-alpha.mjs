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

const renderizar = (arquivo, props) =>
  spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'remotion',
      'render',
      tela,
      arquivo,
      ...COMUNS,
      ...recorteFrames,
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

elementos.forEach((el, i) => {
  console.log(`\n[${i + 2}] ${el.id}`);
  const nome = `${String(i + 1).padStart(2, '0')}_${el.id}.mov`;
  const props = cheio
    ? {transparente: true, somente: el.id, recorte: null}
    : {transparente: true, somente: el.id, recorte: {x: el.x, y: el.y, w: el.w, h: el.h}};
  if (!renderizar(join(destino, nome), props)) falhas.push(el.id);
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
    `arquivo                        tamanho        Position (x, y)`,
    `------------------------------ -------------- ----------------`,
  ];
  elementos.forEach((el, i) => {
    const nome = `${String(i + 1).padStart(2, '0')}_${el.id}.mov`;
    const px = (el.x + el.w / 2).toFixed(1);
    const py = (el.y + el.h / 2).toFixed(1);
    linhas.push(`${nome.padEnd(30)} ${`${el.w}x${el.h}`.padEnd(14)} ${px}, ${py}`);
  });
  linhas.push(``, `O anchor point de cada camada fica no centro dela, que é o padrão do AE.`);
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
