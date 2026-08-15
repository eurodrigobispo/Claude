# Contexto do projeto

Duas coisas independentes moram aqui.

**`mesa-de-luz.html`** — ferramenta de arquivo único, sem build e sem
dependências, que transforma imagens de referência em prompts. Não tem relação
com o resto. Teste: `node test/smoke.mjs`.

**`remotion/`** — projeto de vídeo em React com as telas animadas da campanha
**Andréa Castro 55670** (deputada estadual). É onde o trabalho está.

---

# remotion/ — o que precisa saber antes de mexer

Treze telas, 1920×1080, 30 fps, 15 s cada, sem loop. São para rodar num
**telão de LED atrás de dançarinos**, num lyric video sendo gravado. Isso
governa quase toda decisão: as peças entram em sequência como letra de música,
nada fica parado, e nada encosta na borda.

## O ritmo é medido, não estimado

A faixa é `ANDREIA_CASTRO_55670_2.mp3` (não versionada — o usuário tem).
Tudo em `src/ritmo.ts` saiu de medição:

- **147,8 BPM**, batida de **0,40596 s**, compasso 4/4 de **1,624 s**
- primeiro tempo forte da música em **0,928 s**
- a pulsação mais forte da faixa é o **meio tempo** (0,812 s)

Método: envoltória de onset com hop de 128 (5,8 ms) e autocorrelação. O pico
fundamental é 0,40596 s e todos os outros picos são múltiplos inteiros dele.
Nos pontos dessa grade a energia é 1,60× a média da faixa.

Uma primeira estimativa deu 143,55 BPM e **estava errada** — os intervalos
vinham bimodais em 0,395 s e 0,418 s, exatamente um quadro de análise de
diferença, artefato de resolução. A média dos dois modos é o valor real.

O trecho cantado vai de ~1,65 s a ~3,56 s, e o ataque mais forte de toda a
faixa cai em **3,245 s = batida 8** — é onde "representa" entra nas telas que
têm essa frase.

**Todos os tempos de entrada são declarados em batidas, nunca em segundos
soltos.** Trocar `FPS` reajusta a animação inteira sozinha.

## Regras que não podem ser quebradas

**Nada de piscar.** Trocas de paleta duram dois compassos (0,31 Hz). O limiar
de risco para epilepsia fotossensível começa em 3 Hz. Pedido explícito do
usuário, com ênfase. Também não misture cores em RGB para transicionar: roxo
com amarelo dá bege, que não é cor da campanha — use varredura, que mantém as
duas cores puras (ver `Numeros55670.tsx`).

**Margem de borda.** Na fase de sustentação nenhuma peça pode encostar na
borda; o alvo é 200 px de folga em 1920×1080. Exceções por projeto do card:
as fileiras de `NumerosRolando` e a foto de `EuToFechadao` sangram de
propósito.

**Nada pode ficar parado até os 15 s.** Medir com RMSE entre quadros
consecutivos; o terço final tem que ficar no mesmo patamar do inicial.

## Posicionamento das camadas: a "regra B"

Os PNGs vieram do Figma com `layers.json` declarando `x/y/w/h`. Em 4 das 42
camadas do card 01 **o tamanho do PNG não bate com a caixa declarada**.
Medindo as três hipóteses contra os previews, a que reproduz o original é:

> desenhar o PNG **no tamanho natural**, **centrado na caixa declarada**.

Esticar até a caixa (o que o `Card.tsx` de exemplo do pacote fazia) incha a
estrela em ~35%. Os `cena.json` / `layers.corrigido.json` em `public/` já
guardam os retângulos corrigidos — use-os, não o `layers.json` cru.

Não reaplique `rotacaoGraus`: a rotação já vem no PNG. Testado nos dois
sentidos, piora.

## Camadas fundidas — o que foi separado e como

Vários cards vieram com peças coladas num PNG só. O que foi feito:

| Card | Problema | Solução |
| --- | --- | --- |
| 01 | — | já vinha separado |
| 03 | texto num bloco só | fatiado em `deixa/com/ela/selo` |
| 04 | foto recortada **dentro** da estrela | inseparável — a estrela **não gira** nesse card |
| 05, 09, 11 | frase num bloco só | fatiada em palavras |
| 06, 07, 08, 12 | "55670" num PNG só | fatiado em 5 algarismos |
| 09 | caricatura + estrela azul fundidas | estrela e caricatura retomadas do card 01 e reescaladas (1,158×), estrela pintada por máscara no azul `#00A8FF` |
| 12 | caricatura + estrela fundidas | idem, escala 1,85 (a de projeto, 2,34, tapava os números) |

O fatiamento é por **componentes conexos do canal alfa**, agrupados em
palavras por região lida da diagramação, e recortados **com máscara, não com
retângulo** — as caixas de "força" e do coração se tocam, e corte retangular
levaria pedaço do vizinho.

Arte de cor sólida (números, a estrela) vira **máscara CSS** pintada por
`backgroundColor`, o que permite recolorir sem perder qualidade.

**Os cards 03 e 10 são pixel-idênticos.** `DeixaComEla` serve para os dois.

## Sempre validar antes de animar

Antes de animar um card novo, **remonte-o das fatias e compare com o
`preview.png`** por RMSE. Foi assim que apareceu que a peça rotulada "tô" no
card 11 era na verdade a letra "u" do "eu" — a tela sairia com "eu fechadão".
RMSE abaixo de ~10 é bom; acima de 20, investigue.

## Onde mexer

- **`src/ritmo.ts`** — grade da faixa, paletas, `acento`, `pulso`
- **`src/palco.tsx`** — estilos de entrada (`forma`), balanço contínuo, onda de
  acentos, câmera (`Cena`), revelação peça a peça
- **`src/<Tela>.tsx`** — cada tela declara só o seu `ROTEIRO`, em batidas

O padrão de cada peça: entrada cinética → acento de estica-e-encolhe ao
assentar → balanço contínuo com duas senoides de períodos diferentes por eixo
(para não fechar ciclo óbvio) → onda de acentos recorrente a cada dois
compassos. Câmera respira no **compasso**, nunca na batida (na batida fica
trepidante).

## Ambiente

Numa máquina comum não é preciso configurar nada — o Remotion baixa o Chrome
dele sozinho na primeira exportação. A variável `REMOTION_BROWSER` em
`remotion.config.ts` existe só porque o container onde isto foi feito tinha
`remotion.media` fora da allowlist.

## Convenções

- Comentários e mensagens de commit em **português**
- Comentário explica **por quê**, não o quê
- Tempos em batidas; durações internas em segundos, nunca em quadros

---

# Em aberto

1. **FPS.** Está em 30 porque não foi especificado. Se a gravação for 24, 25 ou
   60, trocar `FPS` em cada tela. Vale conferir a taxa de atualização do painel
   para não bater com o obturador da câmera.
2. **Alinhamento com a música.** Cada clipe começa a grade no próprio quadro
   zero. Sabendo onde cada um entra na faixa, dá para travar a fase nos tempos
   fortes e cortar em número inteiro de compassos, para as emendas caírem no
   downbeat.
3. **Contraste do amarelo** nas fileiras de `NumerosRolando` sobre fundo azul
   claro é fraco. Pode lavar no telão. Trocar o fundo para roxo resolve.
4. **Variações de animação** — era o próximo assunto. O projeto ainda não usa
   `Easing` (só molas e senoides), nem `@remotion/motion-blur`, `@remotion/noise`,
   `@remotion/transitions`. Ver `remotion/DECISOES.md`.

Registro detalhado das decisões: **`remotion/DECISOES.md`**.
