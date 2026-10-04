# Como subir o Painel Eleitoral num servidor

O pacote tem tudo num lugar só:
- `painel/` é o site;
- `coletor/` é o processo que lê o TSE a cada 15 s e publica o feed;
- `deploy/` traz o Docker Compose com HTTPS automático e uma alternativa sem Docker.

O caminho recomendado é Docker. São cerca de 15 minutos.

## 1. O que você precisa

- **Um servidor (VPS) com Ubuntu 22.04 ou 24.04.** Recomendado: 2 vCPU e 4 GB de RAM; com isso o coletor dá conta de todas as capitais. Com 1 vCPU e 2 GB, use `ZONAS=nenhuma`. Serve qualquer provedor: Hetzner, DigitalOcean, Contabo, Hostinger, Locaweb, AWS Lightsail.
- **Um domínio ou subdomínio**, por exemplo `apuracao.seudominio.com.br`.
- **Acesso SSH** ao servidor.

## 2. Aponte o domínio

No painel do seu provedor de domínio, crie um registro **A**:
- nome: `apuracao` (ou o subdomínio que quiser);
- valor: o IP do servidor.

Espere alguns minutos até o domínio responder com esse IP. Para conferir, rode `ping apuracao.seudominio.com.br`.

## 3. Instale o Docker

No servidor:

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Saia e entre de novo no SSH para o grupo valer.

## 4. Envie e descompacte o pacote

No seu computador:

```
scp painel-eleitoral-2026.zip usuario@IP-DO-SERVIDOR:~
```

No servidor:

```
sudo apt-get install -y unzip
sudo unzip -o ~/painel-eleitoral-2026.zip -d /opt/painel-eleitoral
sudo chown -R $USER /opt/painel-eleitoral
cd /opt/painel-eleitoral
```

## 5. Configure

```
cp deploy/.env.exemplo deploy/.env
nano deploy/.env
```

Troque `DOMINIO` e `EMAIL`. As demais opções podem ficar como estão:

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `DOMINIO` | | Endereço do painel, já apontado para o servidor |
| `EMAIL` | | Usado pelo Let's Encrypt para o certificado HTTPS |
| `PARALELO` | `12` | Pedidos simultâneos ao TSE |
| `ZONAS` | `capitais` | Cidades com zonas lidas dos boletins: `capitais`, `nenhuma` ou lista `sp:71072,rj:60011` |
| `MUNICIPIOS` | `1,3,5` | Cargos com matriz por município; `1,3,5,6,7` inclui deputados (bem mais pesado) |
| `TURNO` | `0` | `0` segue o TSE e troca sozinho para o 2º turno; `1` ou `2` força |

## 6. Suba

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Libere as portas 80 e 443 no firewall, se houver:

```
sudo ufw allow 80,443/tcp
```

## 7. Confira

Abra no navegador:

- `https://apuracao.seudominio.com.br/painel/` mostra o painel. No topo, ao passar o mouse sobre o status, deve aparecer "Dados do coletor".
- `https://apuracao.seudominio.com.br/api/saude` deve responder `{"ok":true,...}`.
- `https://apuracao.seudominio.com.br/feed/agora.json` traz o placar que o coletor publica.

Para acompanhar os registros do coletor:

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f painel
```

O primeiro certificado HTTPS leva até um minuto. Se o domínio ainda não aponta para o servidor, o Caddy tenta de novo sozinho.

## Operação

| Tarefa | Comando (na pasta `/opt/painel-eleitoral`) |
| --- | --- |
| Ver se está tudo de pé | `docker compose -f deploy/docker-compose.yml ps` |
| Reiniciar | `docker compose -f deploy/docker-compose.yml --env-file deploy/.env restart painel` |
| Parar | `docker compose -f deploy/docker-compose.yml --env-file deploy/.env down` |
| Atualizar para um pacote novo | `sudo unzip -o novo.zip -d /opt/painel-eleitoral` e rode o passo 6 de novo (o `deploy/.env` e o histórico são mantidos) |
| Guardar o histórico da noite | `docker compose -f deploy/docker-compose.yml cp painel:/app/feed ./feed-backup` |

O contêiner reinicia sozinho se cair ou se o servidor reiniciar. O Docker também confere `/api/saude` a cada 30 s: se o coletor ficar 2 minutos sem gravar o placar, o contêiner é marcado como doente.

## 2º turno (25/10)

Não precisa fazer nada. A cada 10 minutos o coletor confere o índice de eleições do TSE. Quando o 2º turno for publicado, ele troca sozinho, começa um histórico novo e guarda o do 1º turno em `arquivo/t1/`. O painel mostra só Presidente e Governador.

Para forçar, ponha `TURNO=2` no `deploy/.env` e rode o passo 6.

## Muita gente ao mesmo tempo

O painel lê só o feed, e o feed é estático, então um servidor pequeno aguenta bem. Para dezenas de milhares de pessoas:

1. Ponha o domínio na Cloudflare, com o proxy ligado (nuvem laranja).
2. Crie uma regra de cache para `/feed/*` com 5 segundos de validade. O servidor já manda esse cabeçalho.
3. Deixe `/api/*` sem cache.

Assim quase tudo sai da Cloudflare, e só o coletor fala com o TSE.

## Painel no GitHub Pages e coletor no servidor

Se preferir manter o site no GitHub Pages, o servidor só precisa do coletor. Abra o painel com o endereço do feed:

```
https://<usuário>.github.io/<repositório>/painel/?feed=https://apuracao.seudominio.com.br/feed/
```

## Sem Docker

1. Instale o Node 22:
   ```
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
2. Copie o pacote para `/opt/painel-eleitoral` e crie um usuário para o serviço:
   ```
   sudo useradd -r -s /usr/sbin/nologin painel
   sudo chown -R painel /opt/painel-eleitoral
   ```
3. Instale o serviço:
   ```
   sudo cp deploy/painel-eleitoral.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now painel-eleitoral
   ```
4. Coloque um proxy com HTTPS na frente da porta 8080. O mais simples é o Caddy (`sudo apt install caddy`), com este `/etc/caddy/Caddyfile`:
   ```
   apuracao.seudominio.com.br {
   	encode zstd gzip
   	reverse_proxy 127.0.0.1:8080
   }
   ```
   Depois rode `sudo systemctl reload caddy`.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `/api/saude` responde 503 | O coletor não está conseguindo ler o TSE. Veja os registros; costuma ser rede ou firewall de saída |
| O painel diz "Leitura direta do TSE" | O painel não achou `/feed/`. Abra pelo domínio do servidor, ou use `?feed=` |
| Zonas de uma capital ainda vazias | O coletor lê os boletins em lotes de 1.500. A capital paulista leva uns 20 minutos na primeira passada |
| Certificado não sai | O domínio ainda não aponta para o IP, ou as portas 80 e 443 estão fechadas |
| Memória alta | Diminua `ZONAS` (por exemplo, só algumas capitais) ou volte `MUNICIPIOS` para `1,3,5` |

## Testes (opcional, no seu computador)

Com Node 22 e o Playwright instalados:

```
npm run teste
```

Os testes rodam sem rede, com dados reais do TSE e do IBGE salvos em `test/fixtures`.
