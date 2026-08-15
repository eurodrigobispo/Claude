/**
 * Renderiza todas as telas da campanha, uma a uma, em out/.
 * Uso:  npm run todas
 *       npm run todas -- --crf=22        (arquivos menores)
 *       npm run todas -- Card01 Bandeira (só as citadas)
 */
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';

const TELAS = [
  'Card01',
  'DeixaComEla',
  'ForcaDaMulher',
  'ToComAndrea',
  'EuToComAndrea',
  'EuToFechadao',
  'Numeros55670',
  'Numeros55670Rosa',
  'NumerosRolando',
  'Assinatura55670',
  'Bandeira',
  'Coracao13',
  'Coracao14',
];

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('-'));
const pedidas = args.filter((a) => !a.startsWith('-'));
const alvo = pedidas.length ? pedidas : TELAS;

const desconhecidas = alvo.filter((n) => !TELAS.includes(n));
if (desconhecidas.length) {
  console.error(`Tela desconhecida: ${desconhecidas.join(', ')}`);
  console.error(`Disponíveis: ${TELAS.join(', ')}`);
  process.exit(1);
}

mkdirSync('out', {recursive: true});
console.log(`Renderizando ${alvo.length} tela(s). A primeira baixa o Chrome (~100 MB).\n`);

const falhas = [];
alvo.forEach((nome, i) => {
  console.log(`[${i + 1}/${alvo.length}] ${nome}`);
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['remotion', 'render', nome, `out/${nome}.mp4`, ...flags],
    {stdio: 'inherit'},
  );
  if (r.status !== 0) falhas.push(nome);
});

console.log();
if (falhas.length) {
  console.log(`Falharam: ${falhas.join(', ')}`);
  process.exit(1);
}
console.log(`Prontas em out/ — ${alvo.length} tela(s).`);
