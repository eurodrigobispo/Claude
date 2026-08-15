@echo off
REM Instala o projeto Remotion e abre o Studio. Windows.
REM Uso: abra a pasta remotion no Explorer e de duplo clique neste arquivo,
REM      ou no terminal:  cd remotion  e depois  setup.cmd
setlocal
cd /d "%~dp0"

echo ==^> Conferindo o Node
where node >nul 2>nul
if errorlevel 1 (
  echo Node nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo     Node %%v

echo ==^> Instalando as dependencias ^(demora uns 30s na primeira vez^)
call npm install
if errorlevel 1 (
  echo Falha no npm install. Copie o erro acima e me mande.
  pause
  exit /b 1
)

echo ==^> Conferindo se o projeto compila
call npx tsc --noEmit
if errorlevel 1 (
  echo O projeto nao compilou. Copie o erro acima e me mande.
  pause
  exit /b 1
)
echo     tipos ok

echo.
echo Pronto. O Chrome que o Remotion usa para EXPORTAR video ^(~100 MB^) so e
echo baixado na primeira vez que voce rodar: npm run build
echo.
echo Abrindo o Studio em http://localhost:3000
echo ^(Ctrl+C encerra. Para reabrir depois, rode: npm run dev^)
echo.
call npm run dev
