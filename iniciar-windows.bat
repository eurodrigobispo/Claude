@echo off
rem Painel Eleitoral 2026 no seu computador: dois cliques neste arquivo.
rem Precisa do Node 22 ou mais novo (https://nodejs.org). Para parar, feche esta janela.
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node 22 em https://nodejs.org e abra este arquivo de novo. & pause & exit /b 1)
echo Ligando o coletor. O painel abre no navegador em alguns segundos:
echo   http://localhost:8080/painel/
echo Deixe esta janela aberta enquanto usar o painel.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:8080/painel/"
set NODE_OPTIONS=--max-old-space-size=3072
node coletor\servidor.mjs --coletar --porta 8080 --zonas capitais --zonas-cargos 1,3,5,6,7 --municipios 1,3,5,6,7 --limite-tse 60
pause
