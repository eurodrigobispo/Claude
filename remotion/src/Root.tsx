import {Composition} from 'remotion';
import {MesaDeLuz} from './MesaDeLuz';
import {Card01, DURACAO, LARGURA, ALTURA, FPS} from './Card01';

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="Card01"
      component={Card01}
      durationInFrames={DURACAO}
      fps={FPS}
      width={LARGURA}
      height={ALTURA}
    />
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
