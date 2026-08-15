# Remotion — Mesa de Luz

Projeto de vídeo em React. Independente do `mesa-de-luz.html`, que segue sem
build e sem dependências.

## Instalar na sua máquina

Pré-requisito: **Node.js 18 ou mais novo** (https://nodejs.org, versão LTS).
Confira com `node -v`.

Depois, um comando só:

```
git clone https://github.com/eurodrigobispo/Claude.git
cd Claude
git checkout claude/remotion-install-run-8v20z7
cd remotion
```

E então, conforme o sistema:

| Sistema | Comando |
| --- | --- |
| macOS / Linux | `./setup.sh` |
| Windows | `setup.cmd` (ou duplo clique no arquivo) |

O script confere o Node, instala as dependências, valida os tipos e abre o
Studio. Depois da primeira vez, `npm run dev` basta.

Os assets já vêm no repositório (`public/`), então não é preciso reexportar
nada do Figma.

## Rodar

Studio — preview interativo em http://localhost:3000, com timeline, scrubber
quadro a quadro e editor de props. É onde se testam variações sem exportar:

```
npm run dev
```

Renderizar uma tela:

```
npm run render -- Card01 out/Card01.mp4
```

Renderizar todas as 13 de uma vez, em `out/`:

```
npm run todas
npm run todas -- --crf=22          # arquivos menores
npm run todas -- Card01 Bandeira   # só as citadas
```

Conferir os tipos sem exportar nada:

```
npm run check
```

## Chromium

Na primeira renderização o Remotion baixa o próprio Chrome Headless Shell de
`remotion.media`. **Numa máquina comum isso funciona sozinho e você não precisa
fazer nada.** Só onde esse host estiver bloqueado por política de rede — foi o
caso do container em que estas telas foram feitas — é preciso apontar para um
Chromium já instalado:

```
export REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
npm run build
```

O `remotion.config.ts` lê essa variável e só chama `setBrowserExecutable` quando
ela existe — sem ela, o comportamento padrão de download continua valendo.

## As telas

Treze telas da campanha, todas 1920×1080, 30 fps, 15 s, sem loop. Cobrem os 14
cards exportados do Figma — os cards 03 e 10 são pixel-idênticos, então
`DeixaComEla` serve para os dois.

| Composição | O que é |
| --- | --- |
| `Card01` | "eu tô fechadão com ela" |
| `DeixaComEla` | "deixa com ela!" (cards 03 e 10) |
| `ForcaDaMulher` | "é a força da mulher!" |
| `ToComAndrea` | "tô com Andréa porque ela representa" — caricatura |
| `EuToComAndrea` | a mesma frase com a foto |
| `EuToFechadao` | "eu tô fechadão com Andréa Castro" |
| `Numeros55670` | 55670 cadenciado, trocando de paleta |
| `Numeros55670Rosa` | 55670 no rosa, estampida rápida |
| `NumerosRolando` | fileiras de 55670 rolando em loop infinito |
| `Assinatura55670` | coração da marca, nome e número |
| `Bandeira` | a bandeira ondulando |
| `Coracao13` / `Coracao14` | o coração da marca, roxo e azul claro |

Também sobrou `MesaDeLuz`, a composição de teste da instalação — 5 s, sem
relação com a campanha.

## Onde mexer

O padrão de animação está todo em dois arquivos:

- **`src/ritmo.ts`** — a grade da faixa (147,8 BPM, compasso de 1,624 s), as
  paletas e o `acento` que fecha cada entrada.
- **`src/palco.tsx`** — os estilos de entrada (`forma`), o balanço contínuo, a
  onda de acentos e a câmera (`Cena`).

Cada tela é um arquivo curto que declara só o seu roteiro, em batidas. Para
mudar quando uma palavra entra, mexa no `ROTEIRO` dela; para mudar *como* toda
peça entra, mexa em `palco.tsx`.

## Licença

O Remotion é gratuito para indivíduos e organizações de até 3 pessoas; acima
disso exige licença de empresa. Ver https://remotion.dev/license
