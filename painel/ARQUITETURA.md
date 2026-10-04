# Arquitetura do Painel Analítico — Apuração 2026

Este documento descreve o que o painel precisa para analisar a votação em tempo
real até o nível de zona, local de votação e seção, comparar com eleições
anteriores e buscar qualquer candidato com filtros de estado, cidade e zona.
Ele separa o que o protótipo deste repositório já faz direto no navegador do
que exige um coletor no servidor para funcionar em escala.

## 1. Fontes de dados

Todas são públicas e foram verificadas durante a apuração de 4/10/2026.

| Fonte | O que traz | Formato | Atualização | Acesso pelo navegador |
| --- | --- | --- | --- | --- |
| Divulgação TSE — resultado por abrangência (`resultados.tse.jus.br/oficial/ele2026/{eleição}/dados/{uf}/{uf}{mun}-c{cargo}-e{eleição}-u.json`) | Votos por candidato no Brasil, na UF ou no município; seções totalizadas; comparecimento, brancos e nulos | JSON (gzip) | A cada totalização | Sim (CORS liberado) |
| Divulgação TSE — andamento por município (`…/dados/{uf}/{uf}-e{eleição}-ab.json`) | Hora da última totalização e % de seções de cada município | JSON | A cada totalização | Sim |
| Divulgação TSE — configuração (`…/config/mun-e{eleição}-cm.json`) | Municípios com código TSE, código IBGE, capital e zonas | JSON | Fixa | Sim |
| Arquivo de urna — seções (`…/arquivo-urna/3220/config/{uf}/{uf}-p003220-cs.json`) | Todas as seções de cada zona de cada município, com a hora em que o boletim chegou | JSON (SP: 5,7 MB) | Contínua | Sim |
| Arquivo de urna — boletim (BU) (`…/arquivo-urna/3220/dados/{uf}/{mun}/{zona}/{seção}/{hash}/…-bu.dat`) | Votos de cada candidato na seção, comparecimento, zona, local e seção | ASN.1 DER binário, ~9 KB | Assim que a urna transmite | Sim |
| Dados abertos TSE — locais de votação 2026 | Nome, endereço, bairro, latitude e longitude de cada local, seções e eleitores | CSV em ZIP (88 MB) | Pré-eleição | Não (pré-processado em `dados/locais/`) |
| Dados abertos TSE — votação 2022 por município e zona | Votos por candidato, município e zona, 1º e 2º turnos | CSV em ZIP (642 MB) | Histórico | Não (pré-processado em `dados/2022/`) |
| IBGE — malhas | Contornos dos estados e municípios | TopoJSON (BR por município: 412 KB gzip) | Fixa | Sim (CORS liberado) |

Volumes do 1º turno de 2026: 5.570 municípios, 499.248 seções (Brasil e
exterior), 158,7 milhões de eleitores. Os boletins somam cerca de 4,5 GB por
turno.

### Validação do boletim de urna

O decodificador de BU (`js/bu.js`) foi conferido contra o resultado oficial:
somando os boletins de todas as seções de Porto Walter (AC), os votos de cada
candidato a Presidente e a Governador batem exatamente com o arquivo municipal
do TSE, inclusive brancos e nulos. Os locais de votação casam pelo número: o
local 1031 que aparece no boletim é a Escola Borges de Aquino nos dados abertos.

### O que se aprendeu na noite da apuração

Duas defasagens do próprio TSE mudam o desenho de qualquer painel em tempo
real:

1. **Os agregados atrasam em relação às partes.** Às 19h56 o arquivo nacional
   de Presidente ainda trazia a totalização das 19h06 (64,8% das seções),
   enquanto os arquivos estaduais estavam em 19h32 e somavam 84,9%. O índice de
   andamento por município (`-ab.json`) é, por sua vez, mais novo que os
   arquivos de resultado. Regra: somar de baixo para cima e usar o agregado do
   TSE só quando ele for o mais recente. O painel já faz isso para o Brasil.
2. **O boletim de urna sai depois da totalização.** Em Bauru (SP), com 100% das
   seções totalizadas, 524 dos 877 boletins estavam publicados às 19h46; os
   demais respondiam 404. A abertura por zona e local se completa ao longo da
   noite, e o painel mostra quantos boletins já entraram.

## 2. O que o protótipo faz hoje, sem servidor

O painel (`painel/index.html`) é estático e lê tudo direto da fonte:

- **Matriz de municípios.** Para o cargo e a UF escolhidos, baixa o arquivo de
  cada município (645 em SP) e pinta o mapa pelo percentual do candidato ou
  pelo líder. Na visão Brasil, pinta por estado e oferece carregar os 5.570
  municípios sob demanda.
- **Atualização incremental.** A cada 60 s relê o andamento por município e só
  baixa de novo os municípios cuja hora de totalização mudou.
- **Zona, local e seção.** Ao abrir uma cidade, lê os boletins de urna de todas
  as seções publicadas, soma por zona e por local de votação, e desenha no mapa
  a área aproximada de cada local (Voronoi dos locais, recortado pelo contorno
  do município) com o número de cada zona. Releitura a cada 3 min, só das
  seções novas ou ainda não publicadas.
- **Comparação com 2022.** Usa a votação por município e zona de 2022 para
  Presidente, Governador e Senador: mesmo número no mesmo cargo ou, sem ele, o
  candidato do mesmo partido mais votado em 2022.
- **Leitura estratégica.** Concentração do voto, perfil por porte de município,
  redutos, colégios onde perde terreno, voto a conquistar e variação contra 2022.
- **Busca.** Indexa os 18.853 candidatos com votação divulgada (Presidente;
  Governador, Senador e Deputados de todas as UFs) e filtra por nome, número,
  partido, UF e cargo.

### Limites do modo navegador

| Situação | Custo no navegador | Consequência |
| --- | --- | --- |
| Deputado em SP, matriz completa | 645 arquivos de ~40 KB gzip ≈ 26 MB | Funciona em desktop, leva de 30 s a 1 min |
| Presidente, todos os municípios do Brasil | 5.570 arquivos ≈ 13 MB | Funciona sob demanda, ~1 min |
| Zonas da capital de SP | 26.696 boletins ≈ 240 MB | Bloqueado acima de 3.000 seções; precisa do coletor |
| Cada pessoa que abre o painel | Repete todas as requisições ao TSE | Não escala para audiência grande |
| Histórico | Só 2022 e só cargos majoritários | Deputados e 2018/2024 exigem ETL maior |

## 3. Arquitetura para tempo real em escala

```
            TSE (divulgação + arquivo de urna)          Dados abertos TSE, IBGE
                         │                                      │
              ┌──────────▼──────────┐                ┌──────────▼──────────┐
              │ Coletor de resultado│                │   ETL histórico     │
              │ andamento → arquivos│                │ 2018/2022/2024,     │
              │ municipais alterados│                │ locais, malhas      │
              ├─────────────────────┤                └──────────┬──────────┘
              │ Coletor de boletins │                           │
              │ seções novas → BU → │                           │
              │ votos por seção     │                           │
              └──────────┬──────────┘                           │
                         ▼                                      ▼
              ┌──────────────────────────────────────────────────────────┐
              │ Banco analítico (ClickHouse ou PostgreSQL + TimescaleDB) │
              │ voto_secao · resultado_municipio · candidato ·           │
              │ local_votacao (geo) · historico_munzona · historico_secao│
              │ visões materializadas por zona, local, município, UF     │
              └──────────┬───────────────────────────────────────────────┘
                         ▼
              ┌──────────────────────┐     ┌────────────────────────┐
              │ API + push (SSE/WS)  │────▶│ CDN com JSON pré-montado│
              │ busca, matriz, zonas,│     │ por candidato e nível   │
              │ comparação, leitura  │     └───────────┬────────────┘
              └──────────────────────┘                 ▼
                                               Painel (este front-end)
```

### 3.1 Coletor de resultado

- Consulta `ele-c.json` e os arquivos `-ab.json` de cada UF a cada 15–30 s com
  `If-None-Match` (o TSE envia `ETag`).
- Compara a hora de totalização de cada município e baixa só os arquivos
  municipais alterados, para todos os cargos.
- Grava um *snapshot* por município e cargo com a hora de totalização, o que
  permite reconstruir a evolução da apuração.

### 3.2 Coletor de boletins

- Lê o `-cs.json` de cada UF e detecta seções com nova hora de recebimento.
- Para cada uma, baixa o `-aux.json`, depois o `-bu.dat`, e decodifica com o
  mesmo algoritmo de `js/bu.js` (portável para Node, Python ou Go).
- Grava uma linha por seção, cargo e votável: `(uf, município, zona, local,
  seção, cargo, votável, votos, recebida_em)`.
- Ritmo esperado na noite da eleição: cerca de 500 mil boletins em ~6 h, média
  de 25 por segundo e picos de 200 por segundo. Um processo com 64 requisições
  simultâneas dá conta; o banco fica com ~50 milhões de linhas por turno
  (~1 GB comprimido no ClickHouse).
- Conferência automática: a soma dos boletins de cada município precisa bater
  com o arquivo municipal do TSE quando ele chega a 100%. Divergência gera
  alerta.

### 3.3 Banco e agregações

- **ClickHouse** é a escolha natural para somar dezenas de milhões de linhas
  por zona, local ou município em milissegundos. PostgreSQL com TimescaleDB
  serve para um volume menor (só alguns estados).
- Visões materializadas: votos por candidato × zona, × local, × município, × UF,
  atualizadas a cada inserção.
- Tabelas de apoio: candidatos (com foto, partido, coligação), locais de
  votação com coordenadas, histórico por zona e por seção.

### 3.4 API

| Rota | Uso |
| --- | --- |
| `GET /candidatos?q=&uf=&cargo=&partido=` | Busca com tolerância a acento e erro de digitação (pg_trgm, Meilisearch ou Typesense) |
| `GET /candidatos/{sq}/matriz?nivel=uf\|municipio\|zona\|local` | Votos e % em cada unidade, para o mapa |
| `GET /municipios/{cd}/zonas?cargo=` e `/locais?cargo=` | Abertura da cidade |
| `GET /candidatos/{sq}/comparacao?ano=2022` | Variação por unidade contra a referência histórica |
| `GET /candidatos/{sq}/leitura` | Métricas e texto da leitura estratégica |
| `GET /stream` (SSE) | Avisa o painel de que um recorte mudou |

As respostas mais pedidas (matriz de cada candidato por nível) são geradas como
JSON estático e servidas por CDN; o banco só é consultado quando o dado muda.
Assim o público não bate no TSE nem no banco.

### 3.5 Mapa de zonas

O TSE não publica polígono de zona eleitoral. O caminho é:

1. Pontos: cada local de votação já tem latitude e longitude (dados abertos).
2. Áreas aproximadas: diagrama de Voronoi dos locais recortado pelo contorno do
   município. O protótipo já calcula isso no navegador (`d3-delaunay`, copiado
   em `js/vendor/`). No servidor, as células podem ser unidas por zona (turf.js
   no ETL) para ter o contorno de cada zona pronto.

### 3.6 Histórico e comparação

- 2022 por zona já está no repositório para os cargos majoritários.
- Próximos passos do ETL: deputados de 2022 por município (para candidatos à
  reeleição), 2018, prefeitos de 2024 por partido (análise de aliança
  municipal) e votação por seção de 2022, que permite comparar local a local.
- Para candidatos sem histórico no mesmo cargo, a referência é o partido; o
  painel deixa explícito qual critério foi usado.

### 3.7 Leitura com IA (opcional)

A leitura estratégica atual é calculada por regras. Um passo seguinte é passar
as métricas já calculadas (nunca dados crus) para um modelo de linguagem, como
a API do Claude, e pedir um texto analítico. Isso roda no servidor, com a chave
guardada lá e cache por candidato e por *snapshot*, para o custo não crescer
com a audiência.

## 4. Infraestrutura sugerida

| Peça | Opção enxuta | Opção robusta |
| --- | --- | --- |
| Coletores | 1 VM (4 vCPU, 16 GB) com dois processos | Fila (SQS/Redis) e workers escaláveis |
| Banco | ClickHouse na mesma VM | ClickHouse Cloud ou cluster gerenciado |
| API | Node ou Go na mesma VM | Contêineres atrás de balanceador |
| Entrega | Cloudflare na frente da API e dos JSON | Igual, com regras de cache por rota |
| Custo estimado | US$ 80–150 por mês | US$ 400+ por mês na semana da eleição |

## 5. Fases

1. **Feito — protótipo estático.** Matriz por município, zonas e locais via
   boletim para cidades até 3 mil seções, comparação com 2022, leitura
   estratégica, busca global.
2. **Coletor e banco.** Zonas e locais de todas as cidades, inclusive capitais;
   histórico da evolução da apuração; o painel passa a ler da API trocando só a
   camada `js/tse.js`.
3. **Mapa de zonas e histórico amplo.** Polígonos aproximados por zona; 2018,
   2024 e deputados de 2022; comparação por seção.
4. **Alertas e IA.** Avisos de virada por zona ou município e texto analítico
   gerado sobre as métricas.
