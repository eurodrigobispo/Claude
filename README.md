# Mesa de Luz

Ferramenta para transformar imagens de referência em prompts de geração — para
Midjourney, Flux / Nano Banana, vídeo (Veo, Sora, Kling) ou briefing de campanha.

Arquivo único, sem dependências: `mesa-de-luz.html`. Abre no navegador ou publica
como artifact.

## Como usar

1. **Ponha as referências na mesa.** Arraste as imagens ou clique para escolher.
   Elas ficam apenas no seu navegador — nada é enviado a lugar nenhum.
2. **Copie o pedido de análise** (Passo 1) e cole no chat do Claude junto com as
   imagens. Ele devolve um bloco JSON com os atributos lidos.
3. **Cole o JSON de volta** (Passo 2) e clique em *Aplicar leitura*. Os oito
   campos de atributo se preenchem sozinhos.
4. **Escolha o destino**, ajuste proporção, intensidade e o que fica fora do
   quadro. O prompt se recompõe a cada tecla.
5. **Copie ou salve.** Os salvos ficam no `localStorage` do navegador.

Os campos são todos editáveis — a leitura do Claude é um ponto de partida, não
uma sentença.

## Sobre o motor

A página tem um adaptador de motor com dois modos:

- **Automático** — se a superfície onde a página roda expõe o Claude, o botão
  *Analisar referências* aparece e a leitura acontece sem sair da página.
- **Manual** — quando não há motor disponível, o fluxo dos Passos 1 e 2 cobre o
  mesmo caminho passando pelo chat.

A trilha no topo mostra em qual modo a página está. O modo manual é o padrão e
funciona em qualquer lugar; o automático depende do que o runtime concede.

Artifacts rodam com bloqueio total de rede externa, então a página nunca chama a
API da Anthropic por conta própria — não adianta configurar chave nela.

## Formatos de saída

| Destino | O que ele monta |
| --- | --- |
| Midjourney | Frase única com `--no`, `--ar`, `--style raw` e `--stylize` |
| Flux / Nano Banana | Parágrafo em linguagem natural, sem flags |
| Vídeo | Bloco rotulado com CENA, PLANO, CÂMERA, LUZ, FORMATO |
| Briefing | Markdown de direção de arte, para colar em documento |

## Desenvolvimento

Não há build. Edite o HTML e recarregue.

Para rodar o teste de fluxo em Chromium:

```
node test/smoke.mjs
```

---

# Apuração 2026

Painel ao vivo da apuração das Eleições 2026 (1º turno, 4 de outubro), lendo
direto os arquivos de divulgação do TSE em `resultados.tse.jus.br`.

Arquivo único, sem dependências: `apuracao-2026.html`. Não há servidor nem banco:
cada navegador busca os números na fonte, a cada 30 segundos (a cada 2 minutos
depois que a apuração chega a 100%).

## O que mostra

- **Cargos:** Presidente, Governador, Senador, Deputado Federal e Deputado
  Estadual (Distrital, no DF).
- **Local:** Brasil, cada estado, Exterior (só Presidente) e qualquer município.
- **Andamento:** % de seções totalizadas, horário da última totalização,
  comparecimento, abstenção, válidos, brancos, nulos e votos de legenda.
- **Candidatos:** ordenados por votos, com foto, número, partido, vice ou
  suplentes, % dos válidos e a situação que o TSE divulgar (eleito, 2º turno…).
  Presidente e Governador têm a marca dos 50%; Senador destaca as vagas em jogo.
- **Por estado:** com Presidente · Brasil, uma tabela com o 1º e o 2º colocado e
  o andamento em cada estado. Clicar na linha abre o estado.

A seleção fica no endereço (`#cargo=3&uf=sp&mun=71072`), então dá para mandar o
link de um recorte específico.

## Como publicar

O TSE libera os arquivos para leitura a partir de qualquer site, então qualquer
hospedagem estática serve. Com GitHub Pages: *Settings → Pages → Deploy from a
branch*, escolha o branch e a pasta raiz. O painel fica em
`https://<usuário>.github.io/<repositório>/apuracao-2026.html`.

Também funciona abrindo o arquivo direto no navegador do computador.

Não funciona como artifact do Claude: artifacts bloqueiam rede externa, e a
página precisa falar com o TSE.

## Desenvolvimento

O teste de fluxo serve recortes reais da divulgação (`test/fixtures`) no lugar
do TSE, então roda sem rede:

```
node test/apuracao.mjs
```
