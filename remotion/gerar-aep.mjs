/**
 * Gera um script ExtendScript (.jsx) que monta a tela dentro do After Effects,
 * como projeto editável, a partir dos PNGs originais.
 *
 * É a alternativa ao pacote em ProRes: em vez de ~200 MB de vídeo, saem ~6 MB
 * de imagem mais um script de texto. O editor roda em File > Scripts > Run
 * Script File e recebe a composição montada, com camadas separadas, keyframes
 * de entrada e o balanço como expressão — tudo editável, nada "assado" em
 * pixel.
 *
 * O que vira o quê:
 *   - a câmera (aproximação, deriva, giro) → um null "CAMERA" com expressões,
 *     pai de todas as camadas
 *   - a entrada de cada peça (mola) → keyframes assados quadro a quadro, porque
 *     mola não tem equivalente direto em curva do AE
 *   - o balanço contínuo → expressão somada ao `value` do keyframe, então dá
 *     para editar a entrada sem perder o balanço
 *
 * Uso: node gerar-aep.mjs   (escreve em out/aep/)
 */
import {spring} from 'remotion';
import {mkdirSync, copyFileSync, writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const cena = JSON.parse(readFileSync('public/11/cena.json', 'utf8'));

const FPS = 30;
const SEGUNDOS = 15;
const BATIDA = 0.40596;
const ENQUADRAMENTO = 0.84;
const PASSO_LETRA = BATIDA / 8;

const ROTEIRO = {
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

const lerp = (e, a, b) => a + (b - a) * e;

/** Mesmas fórmulas de `forma()` em src/palco.tsx. */
const formaDe = (estilo, e, i) => {
  switch (estilo) {
    case 'esquerda':
      return {tx: lerp(e, -500, 0), ty: 0, escala: lerp(e, 0.72, 1), giro: lerp(e, -13, 0)};
    case 'direita':
      return {tx: lerp(e, 540, 0), ty: 0, escala: lerp(e, 0.72, 1), giro: lerp(e, 12, 0)};
    case 'sobe':
      return {tx: 0, ty: lerp(e, 215, 0), escala: lerp(e, 0.62, 1), giro: lerp(e, 9, 0)};
    case 'desce':
      return {tx: 0, ty: lerp(e, -215, 0), escala: lerp(e, 0.62, 1), giro: lerp(e, -9, 0)};
    case 'carimbo':
      return {tx: 0, ty: 0, escala: lerp(e, 2.0, 1), giro: lerp(e, i % 2 ? 8 : -8, 0)};
    case 'reveal':
      return {tx: 0, ty: 0, escala: 1, giro: 0};
    default:
      return {tx: 0, ty: 0, escala: lerp(e, 0.12, 1), giro: lerp(e, -36, 0)};
  }
};

const DEST = 'out/aep';
mkdirSync(DEST, {recursive: true});

// --- assets: os PNGs originais, sem passar por render ---
const camadas = cena.camadas;
const arquivoDe = {};
for (const c of camadas) {
  const destino = `${c.id}.png`;
  copyFileSync(join('public/11', c.arquivo), join(DEST, destino));
  arquivoDe[c.id] = destino;
}
for (const L of cena.tag.letras) {
  copyFileSync(join('public/11', L.arquivo), join(DEST, `letra_${String(L.i).padStart(2, '0')}.png`));
}
copyFileSync('out/alpha/EuToFechadao/fundo.png', join(DEST, 'fundo.png'));

// --- keyframes de entrada, assados da mola ---
const keyframesDe = (id) => {
  const m = ROTEIRO[id];
  const i = Math.max(0, ORDEM.indexOf(id));
  const entrada = m.batida * BATIDA;
  const quadroEntrada = Math.round(entrada * FPS);
  // a mola assenta em ~1,2 s; passado isso o valor não muda mais
  const ate = Math.min(Math.round(SEGUNDOS * FPS) - 1, quadroEntrada + 40);
  const ks = [];
  for (let f = Math.max(0, quadroEntrada - 1); f <= ate; f++) {
    const e = m.estilo === 'reveal' ? 1 : spring({
      frame: f - quadroEntrada,
      fps: FPS,
      config: {damping: 11, mass: 0.55, stiffness: 125},
    });
    const local = f / FPS - entrada;
    const vis = m.estilo === 'reveal' ? 1 : Math.min(1, Math.max(0, local / 0.15));
    ks.push({t: f / FPS, ...formaDe(m.estilo, e, i), opacidade: vis * 100});
  }
  return {entrada, ks};
};

/** Expressão do balanço, somada ao valor do keyframe. */
const exprBalanco = (id, eixo) => {
  const m = ROTEIRO[id];
  const entrada = (m.batida * BATIDA).toFixed(4);
  const amp = (m.balanco ?? 1).toFixed(3);
  const fase = m.fase.toFixed(3);
  const assentou = `var L=time-${entrada}; var A=Math.min(1,Math.max(0,(L-0.33)/0.67))*${amp};`;
  if (eixo === 'pos') {
    return `${assentou}
var sx=(Math.cos(time*1.45+${fase}*1.3)*7+Math.cos(time*2.8+${fase})*2.5)*A;
var sy=(Math.sin(time*2.0+${fase})*10+Math.sin(time*3.5+${fase}*2)*3.5)*A;
value+[sx,sy]`;
  }
  const cont = m.giro ? ` + ${m.giro}*(L/${SEGUNDOS})` : '';
  return `${assentou}
var g=(Math.sin(time*1.6+${fase}*0.7)*2.4+Math.sin(time*3.0+${fase}*1.9)*1.0)*A;
value+g${cont}`;
};

// --- montagem do .jsx ---
const L = [];
const p = (s) => L.push(s);
const num = (v) => Number(v.toFixed(3));

p(`// Monta "eu tô fechadão com Andréa Castro" no After Effects.`);
p(`// Gerado a partir do projeto Remotion — nao editar a mao, rode e edite no AE.`);
p(`// Coloque este arquivo na MESMA pasta dos .png e rode em:`);
p(`//   File > Scripts > Run Script File...`);
p(``);
p(`(function () {`);
p(`  var pasta = File($.fileName).parent;`);
p(`  app.beginUndoGroup("Montar EuToFechadao");`);
p(`  var proj = app.project;`);
p(`  if (!proj) proj = app.newProject();`);
p(``);
p(`  function importar(nome) {`);
p(`    var f = new File(pasta.fsName + "/" + nome);`);
p(`    if (!f.exists) { throw new Error("Falta o arquivo: " + nome); }`);
p(`    return proj.importFile(new ImportOptions(f));`);
p(`  }`);
p(``);
p(`  var comp = proj.items.addComp("EuToFechadao", 1920, 1080, 1, ${SEGUNDOS}, ${FPS});`);
p(`  comp.openInViewer();`);
p(``);
p(`  // --- camera: aproximacao lenta, deriva e giro. Tudo pendura aqui. ---`);
p(`  var cam = comp.layers.addNull();`);
p(`  cam.name = "CAMERA";`);
p(`  cam.property("Transform").property("Anchor Point").setValue([960, 1080]);`);
p(`  cam.property("Transform").property("Position").expression =`);
p(`    "var x=Math.sin(time*0.4)*24+Math.sin(time*1.05)*5;\\n" +`);
p(`    "var y=Math.cos(time*0.31)*15;\\n" +`);
p(`    "[960+x, 1080+y]";`);
p(`  cam.property("Transform").property("Rotation").expression = "Math.sin(time*0.26)*0.5";`);
p(`  cam.property("Transform").property("Scale").expression =`);
p(`    "var z=(1.0+(1.025-1.0)*(time/${SEGUNDOS}))*${ENQUADRAMENTO}; [z*100, z*100]";`);
p(``);
p(`  var camada, T;`);

// fundo, atrás de tudo e fora da câmera
p(``);
p(`  // --- chapa de fundo: nao pendura na camera, ela e o pano de fundo ---`);
p(`  var fundo = comp.layers.add(importar("fundo.png"));`);
p(`  fundo.name = "fundo";`);
p(`  fundo.moveToEnd();`);

// elementos, de baixo para cima → adiciona na ordem inversa para empilhar certo
for (let k = ORDEM.length - 1; k >= 0; k--) {
  const id = ORDEM[k];
  const cam = camadas.find((c) => c.id === id);
  const m = ROTEIRO[id];

  if (id === 'tag') {
    // a tag e um grupo: um null com o balanco, e as 16 letras penduradas nele
    const {entrada, ks} = keyframesDe('tag');
    const cx = cena.tag.x + 960;
    const cy = cena.tag.y + cena.tag.h / 2;
    p(``);
    p(`  // --- tag DEPUTADA ESTADUAL: grupo com as letras aparecendo uma a uma ---`);
    p(`  var tagNull = comp.layers.addNull();`);
    p(`  tagNull.name = "TAG (grupo)";`);
    p(`  tagNull.parent = cam;`);
    p(`  tagNull.property("Transform").property("Anchor Point").setValue([50, 50]);`);
    p(`  tagNull.property("Transform").property("Position").setValue([${num(cx - 960)}, ${num(cy - 1080)}]);`);
    p(`  tagNull.property("Transform").property("Position").expression = ${JSON.stringify(exprBalanco('tag', 'pos'))};`);
    p(`  tagNull.property("Transform").property("Rotation").expression = ${JSON.stringify(exprBalanco('tag', 'rot'))};`);
    for (const Le of cena.tag.letras) {
      const lx = cena.tag.x + Le.dx + Le.w / 2;
      const ly = cena.tag.y + cena.tag.h / 2;
      const surge = (entrada + Le.i * PASSO_LETRA).toFixed(4);
      const expOp = `var s=Math.min(1,Math.max(0,(time-${surge})/0.15)); s=s*s*(3-2*s); s*100`;
      const expPos = `var s=Math.min(1,Math.max(0,(time-${surge})/0.15)); s=s*s*(3-2*s);
var v=Math.min(1,Math.max(0,(time-${surge}-0.25)/0.5)); v=v*v*(3-2*v);
var oy=Math.sin(time*2.3+${Le.i}*0.9)*5*v;
value+[0,(1-s)*26+oy]`;
      const expRot = `var v=Math.min(1,Math.max(0,(time-${surge}-0.25)/0.5)); v=v*v*(3-2*v);
value+Math.sin(time*1.8+${Le.i}*0.7)*1.2*v`;
      const expEsc = `var s=Math.min(1,Math.max(0,(time-${surge})/0.15)); s=s*s*(3-2*s);
var e=(0.8+s*0.2)*100; [e,e]`;
      p(`  camada = comp.layers.add(importar("letra_${String(Le.i).padStart(2, '0')}.png"));`);
      p(`  camada.name = "tag ${Le.i + 1}";`);
      p(`  camada.parent = tagNull;`);
      p(`  T = camada.property("Transform");`);
      p(`  T.property("Position").setValue([${num(lx - cx)}, ${num(ly - cy)}]);`);
      p(`  T.property("Position").expression = ${JSON.stringify(expPos)};`);
      p(`  T.property("Rotation").expression = ${JSON.stringify(expRot)};`);
      p(`  T.property("Scale").expression = ${JSON.stringify(expEsc)};`);
      p(`  T.property("Opacity").expression = ${JSON.stringify(expOp)};`);
    }
    continue;
  }

  const {ks} = keyframesDe(id);
  const cx = cam.x + cam.w / 2;
  const cy = cam.y + cam.h / 2;
  p(``);
  p(`  // --- ${id} ---`);
  p(`  camada = comp.layers.add(importar("${arquivoDe[id]}"));`);
  p(`  camada.name = "${id}";`);
  p(`  camada.parent = cam;`);
  p(`  T = camada.property("Transform");`);
  // keyframes assados da entrada
  const tempos = ks.map((k) => num(k.t));
  p(`  T.property("Position").setValuesAtTimes(`);
  p(`    [${tempos.join(',')}],`);
  p(`    [${ks.map((k) => `[${num(cx - 960 + k.tx)},${num(cy - 1080 + k.ty)}]`).join(',')}]);`);
  p(`  T.property("Scale").setValuesAtTimes(`);
  p(`    [${tempos.join(',')}],`);
  p(`    [${ks.map((k) => `[${num(k.escala * 100)},${num(k.escala * 100)}]`).join(',')}]);`);
  p(`  T.property("Rotation").setValuesAtTimes(`);
  p(`    [${tempos.join(',')}],`);
  p(`    [${ks.map((k) => num(k.giro)).join(',')}]);`);
  p(`  T.property("Opacity").setValuesAtTimes(`);
  p(`    [${tempos.join(',')}],`);
  p(`    [${ks.map((k) => num(k.opacidade)).join(',')}]);`);
  // balanço por cima dos keyframes
  p(`  T.property("Position").expression = ${JSON.stringify(exprBalanco(id, 'pos'))};`);
  p(`  T.property("Rotation").expression = ${JSON.stringify(exprBalanco(id, 'rot'))};`);
}

p(``);
p(`  app.endUndoGroup();`);
p(`  alert("Composicao EuToFechadao montada.\\n\\n" +`);
p(`        "A entrada de cada peca esta em keyframes; o balanco continuo esta\\n" +`);
p(`        "como expressao somada ao keyframe, entao da para editar um sem\\n" +`);
p(`        "perder o outro. A camera e o null CAMERA.");`);
p(`})();`);

writeFileSync(join(DEST, 'MontarEuToFechadao.jsx'), L.join('\n') + '\n');

const bytes = readFileSync(join(DEST, 'MontarEuToFechadao.jsx')).length;
console.log(`Escrito em ${DEST}/`);
console.log(`  MontarEuToFechadao.jsx  ${(bytes / 1024).toFixed(0)} KB`);
console.log(`  ${camadas.length} elementos + ${cena.tag.letras.length} letras + fundo`);
