import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type MesaDeLuzProps = {
  titulo: string;
  legenda: string;
};

const SLIDES = ['#f2d0a4', '#cfe3e0', '#e8c7c8', '#d5d8ea'];

export const MesaDeLuz: React.FC<MesaDeLuzProps> = ({titulo, legenda}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();

  // A mesa acende: o fundo sai do escuro para a luz difusa.
  const luz = spring({frame, fps, config: {damping: 200}, durationInFrames: 45});

  const tituloY = interpolate(luz, [0, 1], [40, 0]);
  const tituloOpacity = interpolate(frame, [10, 35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const legendaOpacity = interpolate(frame, [40, 65], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#12100e',
        fontFamily: 'Georgia, "Times New Roman", serif',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* halo da mesa acesa */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse ${width * 0.55}px ${
            height * 0.5
          }px at 50% 52%, rgba(255, 244, 224, ${
            0.9 * luz
          }) 0%, rgba(255, 236, 204, ${0.25 * luz}) 45%, transparent 72%)`,
        }}
      />

      {/* as referências pousando na mesa, uma a uma */}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        {SLIDES.map((cor, i) => {
          const entrada = spring({
            frame: frame - (20 + i * 8),
            fps,
            config: {damping: 14, mass: 0.6},
          });
          const angulo = interpolate(i, [0, SLIDES.length - 1], [-9, 9]);
          const desloc = interpolate(i, [0, SLIDES.length - 1], [-1, 1]);

          return (
            <div
              key={cor}
              style={{
                position: 'absolute',
                width: 260,
                height: 340,
                backgroundColor: cor,
                borderRadius: 6,
                border: '10px solid #fffdf8',
                boxShadow: '0 24px 60px rgba(24, 18, 10, 0.35)',
                opacity: entrada,
                transform: [
                  `translateX(${desloc * 300 * entrada}px)`,
                  `translateY(${interpolate(entrada, [0, 1], [-60, 0])}px)`,
                  `rotate(${angulo * entrada}deg)`,
                  `scale(${interpolate(entrada, [0, 1], [0.85, 1])})`,
                ].join(' '),
              }}
            />
          );
        })}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 96,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 88,
            letterSpacing: -1,
            color: '#f7efe2',
            opacity: tituloOpacity,
            transform: `translateY(${tituloY}px)`,
          }}
        >
          {titulo}
        </h1>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 30,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: '#c2ab8f',
            opacity: legendaOpacity,
            fontFamily: 'Helvetica, Arial, sans-serif',
          }}
        >
          {legenda}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
