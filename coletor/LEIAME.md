# Coletor da apuração

Lê a divulgação do TSE em tempo real e publica um feed de JSON pequenos para o
painel. Com o coletor no ar, quem abre o painel lê só o feed:
- o placar a cada 15 s;
- um arquivo por estado no lugar de centenas de arquivos municipais;
- as zonas das capitais já somadas dos boletins de urna;
- a evolução da noite e as últimas atualizações.

Não há dependências: Node 22 ou mais novo.

## Rodar

Coletor e servidor no mesmo processo (o jeito mais simples):

```
node coletor/servidor.mjs --coletar --porta 8080
```

O painel fica em `http://localhost:8080/painel/` e encontra o feed sozinho em
`/feed/`. O servidor também responde `/api/vivo`, o contador de pessoas com o
painel aberto.

Só o coletor, gravando numa pasta que outro servidor ou CDN publica:

```
node coletor/coletor.mjs --saida /var/www/feed
```

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `--saida` | `feed` | Pasta onde o feed é gravado |
| `--intervalo` | `15` | Segundos entre leituras do placar |
| `--municipios` | `1,3,5` | Cargos com matriz por município (`6,7` acrescenta deputados, bem mais pesado) |
| `--zonas` | `capitais` | Cidades com zonas lidas dos boletins: `capitais`, `nenhuma` ou lista `sp:71072,rj:60011` |
| `--zonas-cargos` | `1,3,5` | Cargos somados nas zonas (`6,7` acrescenta deputados e multiplica a memória) |
| `--paralelo` | `12` | Pedidos simultâneos ao TSE |
| `--turno` | automático | Força `1` ou `2`; sem ela, o coletor segue o índice de eleições do TSE e troca sozinho quando o 2º turno for publicado |
| `--uma-vez` | | Faz um ciclo e sai |

Ao reiniciar na mesma pasta, o coletor retoma o histórico e os eventos já
gravados, desde que sejam do mesmo turno.

## Painel em outro endereço

Se o painel estiver no GitHub Pages e o coletor num servidor próprio, abra:

```
https://<usuário>.github.io/<repositório>/painel/?feed=https://seu-servidor/feed/
```

O servidor libera CORS no feed e no contador. Sem coletor, o painel volta a ler
o TSE direto, como antes.

## Arquivos do feed

| Arquivo | Atualização | Conteúdo |
| --- | --- | --- |
| `agora.json` | a cada ciclo | Placar de Presidente (Brasil, UFs e exterior), Governador e Senador (UFs): seções, eleitorado, comparecimento, válidos (computados, como o TSE), brancos, nulos, votos e situação de cada candidato; `municipais` lista os cargos com matriz por município |
| `candidatos.json` | quando muda | Nome, partido, número, foto (`sq`) e vices de cada disputa |
| `historico.json` | quando a apuração anda | Por disputa, pontos `[hora, % seções, {número: votos}, válidos]` dos seis primeiros |
| `eventos.json` | a cada ciclo | Últimas 120 atualizações: `secoes`, `eleito`, `segundo-turno`, `virada`, `concluida` |
| `uf/<uf>-c<cargo>.json` | quando um município muda | Todos os municípios da UF, em colunas alinhadas por `mun` |
| `zonas/<uf>-<mun>.json` | a cada lote de 1.500 boletins | Zonas e locais de votação de Presidente, Governador e Senador, somados dos boletins de urna; `proporcionais` lista os cargos de deputado com arquivo próprio |
| `zonas/<uf>-<mun>-c<cargo>.json` | a cada lote de 1.500 boletins | O mesmo para cada cargo de deputado (`--zonas-cargos 1,3,5,6,7`), separado porque os da capital paulista passam de 10 MB |
| `arquivo/t<turno>/<HHMM>.json` | a cada minuto | Retrato do `agora.json`, com índice em `arquivo/t<turno>/indice.json` |
| `estado.json` | a cada ciclo | Saúde: ciclos, pedidos, falhas, último erro, progresso das zonas |

O servidor também responde `GET /api/saude`: 200 se o coletor gravou o placar
nos últimos 2 minutos, 503 se não. Serve para o Docker ou um monitor externo.

## Como ele conta

- **Placar:** lê os 83 arquivos estaduais e o nacional a cada ciclo, em cerca de
  1 s. O total do Brasil é a soma dos estados e do exterior sempre que essa soma
  for mais recente que o arquivo nacional do TSE, que costuma atrasar.
- **Validação:** um arquivo com números negativos, mais seções totalizadas que
  seções, ou votos que não fecham é descartado. O último resultado bom continua
  publicado, e um arquivo nunca substitui outro mais novo.
- **Municípios:** segue o índice de andamento de cada UF e baixa só os
  municípios cuja totalização (data e hora) mudou.
- **Zonas:** lê os boletins de urna das cidades configuradas em lotes,
  revezando entre elas. A seção que o TSE totalizou mas ainda não publicou fica
  como "aguardando" e entra na passada seguinte.
- **Eventos:** compara cada ciclo com o anterior e registra:
  - avanço de seções no placar nacional;
  - viradas na liderança;
  - eleitos e disputas que vão ao 2º turno;
  - disputas que chegam a 100%.

## Publicar num servidor

Qualquer máquina com Node 22 serve. Com Docker:

```
docker build -t painel-eleitoral -f coletor/Dockerfile .
docker run -d -p 8080:8080 -v painel-feed:/app/feed painel-eleitoral
```

Ponha uma CDN (Cloudflare, por exemplo) na frente com cache curto em `/feed/`
(o servidor já envia `max-age=5`). Assim milhares de pessoas leem o feed e só o
coletor fala com o TSE. A rota `/api/vivo` não pode ter cache.
