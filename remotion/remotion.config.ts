import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);

// O Remotion baixa o próprio Chrome Headless Shell na primeira renderização.
// Em ambientes sem acesso a remotion.media (rede restrita), aponte REMOTION_BROWSER
// para um Chromium já instalado — ex.: o do Playwright em /opt/pw-browsers.
if (process.env.REMOTION_BROWSER) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
}
