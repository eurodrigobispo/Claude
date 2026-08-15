#!/usr/bin/env bash
# Instala o projeto Remotion e abre o Studio. macOS e Linux.
# Uso:  cd remotion && ./setup.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Conferindo o Node"
if ! command -v node >/dev/null 2>&1; then
  echo "Node nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo."
  exit 1
fi

VERSAO=$(node -p "process.versions.node.split('.')[0]")
echo "    Node $(node -v)"
if [ "$VERSAO" -lt 18 ]; then
  echo "    ATENCAO: o Remotion 4 pede Node 18 ou mais novo. O seu e mais antigo,"
  echo "    entao a instalacao pode falhar. Recomendo atualizar antes de seguir."
fi

echo "==> Instalando as dependencias (demora uns 30s na primeira vez)"
npm install

echo "==> Conferindo se o projeto compila"
npx tsc --noEmit && echo "    tipos ok"

echo
echo "Pronto. O Studio nao precisa baixar nada alem disso — o Chrome que o"
echo "Remotion usa para EXPORTAR video (~100 MB) so e baixado na primeira vez"
echo "que voce rodar 'npm run build'."
echo
echo "Abrindo o Studio em http://localhost:3000"
echo "(Ctrl+C encerra. Para reabrir depois, rode: npm run dev)"
echo
npm run dev
