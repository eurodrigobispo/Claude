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
