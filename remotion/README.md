# Remotion — Mesa de Luz

Projeto de vídeo em React. Independente do `mesa-de-luz.html`, que segue sem
build e sem dependências.

## Instalar

```
cd remotion
npm install
```

## Rodar

Studio (preview interativo em http://localhost:3000):

```
npm run dev
```

Renderizar o vídeo em `out/mesa-de-luz.mp4`:

```
npm run build
```

Um quadro só, em PNG:

```
npm run still
```

## Chromium

Na primeira renderização o Remotion baixa o próprio Chrome Headless Shell de
`remotion.media`. Onde esse host estiver bloqueado, aponte para um Chromium já
instalado:

```
export REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
npm run build
```

O `remotion.config.ts` lê essa variável e só chama `setBrowserExecutable` quando
ela existe — sem ela, o comportamento padrão de download continua valendo.

## Composição

`MesaDeLuz`, 1920×1080, 30 fps, 5 s. A mesa acende, quatro referências pousam
uma a uma e o título entra. Os textos são props (`titulo`, `legenda`), editáveis
no Studio ou por `--props`.

## Licença

O Remotion é gratuito para indivíduos e organizações de até 3 pessoas; acima
disso exige licença de empresa. Ver https://remotion.dev/license
