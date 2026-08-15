import {Composition} from 'remotion';
import {MesaDeLuz} from './MesaDeLuz';

export const RemotionRoot: React.FC = () => {
  return (
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
  );
};
