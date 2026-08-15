# Registro de decisões

Por que cada tela ficou como ficou, o que foi medido e o que foi descartado.
O `CLAUDE.md` na raiz tem o resumo operacional; aqui está o detalhe.

---

## O material de origem

14 cards exportados do Figma (página Lyric, containers Exporta), 1920×1080,
PNGs em 2×. Vieram em quatro zips com `layers.json`, `preview.png` e as
camadas isoladas.

Inventário conferido: **42 camadas, 38 PNGs únicos, nenhum arquivo faltando.**
Onze dos catorze cards remontam com deslocamento 0 px e escala 1,000 contra o
preview.

Cinco cores de fundo, extraídas dos previews (o fundo não é camada):

| Cor | Onde |
| --- | --- |
| `#E4F1FB` azul claro | 01, 02, 04, 09, 11, 12, 14 |
| `#6B1DE8` roxo | 03, 05, 07, 10, 13 |
| `#F7C624` amarelo | 06 |
| `#F3248F` rosa | 08 |

---

## Medição do áudio

Detalhe do método em `CLAUDE.md`. O que vale registrar é a sequência de erros
até chegar no número:

1. `librosa.beat.beat_track` deu **143,55 BPM**. Errado.
2. Ajuste de grade por minimização de erro de fase deu **146,95** — métrica
   enviesada (o erro era multiplicado pelo período, favorecendo BPM alto).
3. Regressão linear sobre os índices deu **147,62**, com resíduo de 63 ms —
   alto demais para faixa programada.
4. O histograma dos intervalos revelou **bimodalidade em 0,395 s e 0,418 s**,
   exatamente um hop de diferença. Artefato de resolução.
5. Autocorrelação com hop de 128 (5,8 ms) e interpolação parabólica:
   **0,40596 s → 147,796 BPM**, com todos os demais picos em múltiplos
   inteiros (×2, ×3, ×4). Esse é o valor bom.

Lição: quando os intervalos de beat vierem bimodais separados por exatamente
um quadro de análise, é resolução, não rubato.

Energia por trecho de 10 s: sobe até ~40-50 s, cai um pouco em 60-70 s, volta
a subir em 70-90 s. Últimos 3 s em queda. Duração 103,15 s.

---

## Por tela

### Card01 — "eu tô fechadão com ela"
A primeira. Foi feita **antes** de eu ter o MP3 e pulsava a 0,8 s, valor
chutado. Depois realinhada para `MEIO_TEMPO` (0,812 s) — a diferença de 12 ms
acumulava quase um quadro e meio em 15 s contra as outras telas.

Primeira versão tinha o texto ilegível (escuro sobre fundo escuro, fora do
alcance do halo). Corrigido para tons claros.

### Numeros55670 — o de trocar de paleta
A troca de esquema começou como crossfade de cores e ficou ruim: interpolar
roxo com amarelo em RGB passa por um bege lavado. Trocado por **varredura
diagonal** com `clip-path`, renderizando a cena duas vezes (paleta velha
inteira, paleta nova recortada). As duas cores ficam puras e a borda inclinada
atravessa os dígitos, o que ficou melhor que o previsto.

Quatro paletas, dois compassos cada (3,25 s), alternando o lado de entrada da
varredura.

### ToComAndrea — card 09
Primeira versão tinha um respiro de compasso inteiro entre "Andréa" e
"porque", e o usuário apontou que arrastava. Refeita com "representa" na
batida 8 (3,245 s), que é o ataque mais forte da faixa, medido por fluxo
espectral na banda de voz (250–3500 Hz).

A tag DEPUTADA ESTADUAL saiu da sequência da frase — não é cantada. Fatiada
em 16 letras e entra por último, oito letras por batida.

A caricatura vinha fundida com a estrela azul. Estrela e caricatura foram
retomadas **do card 01** e reencaixadas na escala deste card. A escala foi
medida pela caixa do conteúdo: **1,158×**, consistente nos dois eixos, o que
confirma ser a mesma arte. A estrela do card 01 é amarela mas de cor sólida,
então entra como máscara pintada no azul exato do 09 (`#00A8FF`). O selo do
coração foi recortado da camada fundida.

As três peças ficam num **grupo único** que entra e balança junto, com o giro
só por dentro. Se fossem camadas soltas, a escala de entrada as separaria — a
caricatura sairia de dentro da estrela no meio do pop.

### NumerosRolando — card 12
Fileiras alternadas roxa/amarela rolando de cima para baixo, em ciclo de duas
fileiras para a alternância fechar sem salto.

**Armadilha resolvida:** a defasagem do balanço usava o índice `i` cheio. No
fechamento do ciclo cada posição de tela troca de índice em duas unidades, a
fase pulava junto e a costura ficava visível (RMSE de 39,7 contra 21,2 de
média local). Passou a usar `i % 2`, que é invariante ao ciclo.

Escala do primeiro plano: a busca por escala e posição contra o preview
mostrou que **o tamanho de projeto é 2,340** — praticamente o que estava
aplicado. A diferença real era de **posição**, 63 px mais baixo. Mesmo no
tamanho de projeto a caricatura tapa os números, então o usuário pediu menor:
está em **1,85**, centralizado. Se quiser mais números visíveis, 1,65 abre
mais.

Sombra no primeiro plano é necessária: a estrela é amarela e as fileiras
ímpares também, e sem ela a estrela sumia ao passar sobre uma fileira amarela.

### DeixaComEla — cards 03 e 10
Estrela e caricatura já vinham separadas, então a estrela gira sozinha.
Os cards 03 e 10 têm previews **pixel-idênticos** (RMSE 0,00) — só os bytes
dos PNGs diferem, de reexportação. Uma composição serve para os dois.

### ForcaDaMulher — card 04
A estrela **não gira** aqui, de propósito: a foto vem recortada dentro da
forma da estrela, num PNG só, e girar viraria a foto de cabeça para baixo.
Compensado com balanço mais largo no grupo.

O texto foi fatiado em 5 peças. "força", "da" e o coração ficam juntos numa
peça só porque as caixas se tocam.

### EuToFechadao — card 11
**Erro pego pela validação:** as regiões de fatiamento estavam erradas e a
peça rotulada "tô" era na verdade a letra "u" do "eu"; o "tô" real nunca foi
capturado. A tela sairia com "eu fechadão". Corrigido, RMSE caiu de 13,86
para 7,51.

O selo do coração encosta na caixa do "Castro" e vem junto com ela.

Arquivo grande (44 MiB em CRF 15) por causa do detalhe da foto com movimento
constante. Cópia de entrega em CRF 23.

### EuToComAndrea — card 05
Mesma frase do card 09, com foto no lugar da caricatura. Reaproveita a mesma
grade, então as duas telas são **intercambiáveis no corte** sem mexer no
tempo.

### Assinatura55670 — card 07 e Numeros55670Rosa — card 08
O 07 é fecho: leitura mais assentada, um algarismo por batida. O 08 é
estampida curta, também um por batida, no esquema fixo rosa/branco — o
contraponto da tela que troca de paleta, que revela um por meio tempo.

### Bandeira — card 02
Foto única, sem camadas para sequenciar. Cortada em **56 faixas verticais**,
cada uma deslizando em Y numa onda que viaja do mastro para a ponta, com
amplitude saindo de zero no mastro. O mastro foi localizado medindo a coluna
mais alta do terço esquerdo do alfa: **14% da largura**. Duas ondas
superpostas, uma no meio tempo e outra no compasso.

### Coracao13 / Coracao14 — cards 13 e 14
Mesmo coração em dois fundos, uma composição parametrizada por fundo e
sentido do giro.

Por ser **um elemento só numa tela vazia**, precisou de amplitude bem maior
que as telas cheias — com os valores das outras, lia como parado. Movimento
médio subiu de 5,4 para 8,4.

---

## Melhoria geral tardia

As peças reveladas uma a uma (algarismos, letras) não tinham vida própria
depois da revelação: o grupo virava bloco parado. Ganharam onda, giro e pulso
individuais em `palco.tsx`. Afeta `Numeros55670Rosa`, `Assinatura55670` e a
tag de `EuToFechadao`.

---

## O que ainda não foi usado

Verificado no registro npm, todos na mesma versão do projeto (4.0.512), então
instalam limpo:

| Pacote | O que traria |
| --- | --- |
| `@remotion/motion-blur` | `<Trail>` e `<CameraMotionBlur>` — peso real nas entradas rápidas |
| `@remotion/noise` | ruído Perlin no lugar das senoides do balanço, movimento não-periódico |
| `@remotion/transitions` | transições prontas entre cenas, se emendar dentro do Remotion |
| `@remotion/paths` | animar ao longo de traçado, desenhar contorno progressivo |
| `@remotion/shapes`, `@remotion/three`, `@remotion/lottie` | formas, 3D, Lottie |

E o `Easing` que já vem no pacote base e **não usamos** — todas as curvas hoje
saem de molas e senoides. A versão instalada oferece `linear, ease, quad,
cubic, poly, sin, circle, exp, elastic, back, bounce, bezier` com `in/out/inOut`.

Dos disponíveis, os que mudariam mais a sensação sem tocar na estrutura são
**motion-blur** nas entradas e **noise** no balanço.

---

## Ferramentas de verificação usadas

Ficam registradas porque foram elas que pegaram os erros:

- **Remontagem × preview por RMSE** — pegou o "tô" faltando no card 11
- **RMSE entre quadros consecutivos** — mede se a tela continua viva no terço
  final; pegou o coração parado demais
- **Máscara de cor forte + caixa de conteúdo** — mede margem de borda. Atenção:
  em sequência JPEG reduzida dá falso positivo por artefato de compressão;
  confirmar em still em resolução plena
- **Correlação de perfil vertical entre quadros** — mediu a continuidade da
  rolagem na costura do loop
