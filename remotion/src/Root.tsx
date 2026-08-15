import {Composition} from 'remotion';
import {MesaDeLuz} from './MesaDeLuz';
import {Card01, DURACAO, LARGURA, ALTURA, FPS} from './Card01';
import {Numeros55670} from './Numeros55670';
import {ToComAndrea} from './ToComAndrea';
import {NumerosRolando} from './NumerosRolando';
import {DeixaComEla} from './DeixaComEla';
import {ForcaDaMulher} from './ForcaDaMulher';
import {Assinatura55670} from './Assinatura55670';
import {EuToFechadao} from './EuToFechadao';

const palco = {
  durationInFrames: DURACAO,
  fps: FPS,
  width: LARGURA,
  height: ALTURA,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Card01" component={Card01} {...palco} />
      <Composition id="Numeros55670" component={Numeros55670} {...palco} />
      <Composition id="ToComAndrea" component={ToComAndrea} {...palco} />
      <Composition id="NumerosRolando" component={NumerosRolando} {...palco} />
      <Composition id="DeixaComEla" component={DeixaComEla} {...palco} />
      <Composition id="ForcaDaMulher" component={ForcaDaMulher} {...palco} />
      <Composition id="EuToFechadao" component={EuToFechadao} {...palco} />
      <Composition id="Assinatura55670" component={Assinatura55670} {...palco} />
      <Composition
        id="MesaDeLuz"
        component={MesaDeLuz}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          titulo: 'Mesa de Luz',
          legenda: 'referência vira prompt',
        }}
      />
    </>
  );
};
