#!/bin/sh
# Painel Eleitoral 2026 no seu computador: rode ./iniciar-linux.sh no terminal.
# Precisa do Node 22 ou mais novo (https://nodejs.org). Para parar, feche a janela.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Instale o Node 22 em https://nodejs.org e abra este arquivo de novo."
  read -r _
  exit 1
fi
echo "Ligando o coletor. O painel abre no navegador em alguns segundos:"
echo "  http://localhost:8080/painel/"
echo "Deixe esta janela aberta enquanto usar o painel."
(sleep 5; open http://localhost:8080/painel/ 2>/dev/null || xdg-open http://localhost:8080/painel/ 2>/dev/null) &
NODE_OPTIONS=--max-old-space-size=3072 exec node coletor/servidor.mjs --coletar --porta 8080 --zonas capitais --zonas-cargos 1,3,5,6,7 --municipios 1,3,5,6,7 --limite-tse 60
