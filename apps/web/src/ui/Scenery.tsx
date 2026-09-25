import type { ReactNode } from 'react';
import { useScenery, useTheme, type ThemeId } from './themes.ts';
import './scenery.css';

/*
 * A landscape along the bottom of the screen for each theme, drawn in the manner of Japanese
 * woodblock prints: flat color, dark outlines, clawed foam, bands of mist (kasumi) and a sun
 * or moon disk. Every color comes from the theme's own variables (see scenery.css), mixed far
 * toward the page color so text on top stays readable.
 *
 * Drawn in a 1600 × 600 box anchored at the bottom center: the main subject sits between
 * x 500 and 1100, which is what a phone shows.
 */

const W = 1600;
const H = 600;

/** The picture behind the app, for the current theme. */
export function Scenery() {
  const theme = useTheme();
  const on = useScenery();
  if (!on) return null;
  return (
    <div className="scenery" aria-hidden="true">
      <SceneArt theme={theme} />
    </div>
  );
}

export function SceneArt({ theme }: { theme: ThemeId }) {
  const Scene = SCENES[theme];
  return (
    <svg className="scene" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice">
      <Scene />
    </svg>
  );
}

const SCENES: Record<ThemeId, () => ReactNode> = {
  harbor: Harbor,
  desert: Desert,
  beach: Beach,
  forest: Forest,
  prairie: Prairie,
  night: Night,
};

// ---------- Drawing helpers ----------

type Pt = [number, number];

/** Repeatable pseudo-random numbers, so the picture is the same on every load. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function cubic(p: [Pt, Pt, Pt, Pt], t: number): { at: Pt; dir: Pt } {
  const u = 1 - t;
  const [a, b, c, d] = p;
  const at: Pt = [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ];
  const dx = 3 * u * u * (b[0] - a[0]) + 6 * u * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]);
  const dy = 3 * u * u * (b[1] - a[1]) + 6 * u * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]);
  const len = Math.hypot(dx, dy) || 1;
  return { at, dir: [dx / len, dy / len] };
}

const f = (n: number) => Math.round(n * 10) / 10;

/** A band of mist: a long pill with a shorter one stepped above it. */
function Mist({ x, y, w, h = 30 }: { x: number; y: number; w: number; h?: number }) {
  return (
    <g className="sc-mist">
      <rect x={x} y={y} width={w} height={h} rx={h / 2} />
      <rect x={x + w * 0.18} y={y - h * 0.55} width={w * 0.5} height={h} rx={h / 2} />
    </g>
  );
}

/** A small Fuji: flat-topped cone with a jagged snow cap. */
function Fuji({ x, base, w, h }: { x: number; base: number; w: number; h: number }) {
  const top = base - h;
  const cap = top + h * 0.3;
  const at = (y: number) => ((y - top) / h) * (w / 2 - w * 0.07) + w * 0.07;
  const cw = at(cap);
  return (
    <g>
      <path
        className="sc-2 sc-stroke"
        d={`M${x - w / 2} ${base} L${x - w * 0.07} ${top} L${x + w * 0.07} ${top} L${x + w / 2} ${base} Z`}
      />
      <path
        className="sc-foam sc-stroke"
        d={`M${x - w * 0.07} ${top} L${x + w * 0.07} ${top} L${f(x + cw)} ${cap} L${f(x + cw * 0.55)} ${cap - h * 0.08}
            L${f(x + cw * 0.25)} ${cap + h * 0.02} L${x} ${cap - h * 0.1} L${f(x - cw * 0.3)} ${cap + h * 0.03}
            L${f(x - cw * 0.6)} ${cap - h * 0.07} L${f(x - cw)} ${cap} Z`}
      />
    </g>
  );
}

/** A pine in the woodblock manner: a leaning trunk, needles in flat layered clusters at the branch tips. */
function Pine({ x, y, s = 1, flip = false }: { x: number; y: number; s?: number; flip?: boolean }) {
  // [cx, cy, width, height] of each cluster, at the end of a branch.
  const clusters: [number, number, number, number][] = [
    [-112, -148, 150, 30],
    [78, -190, 140, 28],
    [-62, -248, 124, 26],
    [82, -272, 112, 24],
  ];
  // Flat underside, scalloped top.
  const pad = (cx: number, cy: number, w: number, h: number) => {
    const bumps = 4;
    const bw = w / bumps;
    const x0 = cx - w / 2;
    const top = Array.from(
      { length: bumps },
      (_, i) => `Q${f(x0 + bw * (i + 0.5))} ${f(cy - h * (1.15 + (i % 2) * 0.2))} ${f(x0 + bw * (i + 1))} ${f(cy - h * 0.55)}`,
    ).join(' ');
    return `M${f(x0)} ${cy} L${f(x0)} ${f(cy - h * 0.55)} ${top} L${f(x0 + w)} ${cy} Z`;
  };
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <g className="sc-trunk">
        <path d="M0 0 C 10 -60, -30 -110, -10 -170 C 5 -215, 40 -240, 78 -268" />
        <path d="M-16 -118 Q -60 -128 -110 -146 M-6 -176 Q 30 -178 72 -188 M14 -222 Q -20 -236 -58 -246" />
      </g>
      {clusters.map(([cx, cy, w, h], i) => (
        <g key={i}>
          <path className="sc-3 sc-stroke" d={pad(cx, cy, w, h)} />
          <path className="sc-2 sc-stroke-thin" d={pad(cx + w * 0.08, cy - h * 0.6, w * 0.62, h * 0.8)} />
        </g>
      ))}
    </g>
  );
}

/** A wave rising to a clawed crest that curls over, after Hokusai. Base line at y 440, 800 wide. */
function Wave({ x, y, s = 1, seed = 1 }: { x: number; y: number; s?: number; seed?: number }) {
  const face: [Pt, Pt, Pt, Pt] = [[250, 160], [310, 90], [400, 50], [480, 60]];
  const lip: [Pt, Pt, Pt, Pt] = [[480, 60], [560, 70], [600, 120], [585, 165]];
  const rnd = random(seed);
  const claws: string[] = [];
  const spray: Pt[] = [];
  for (const [seg, from, to, n] of [
    [face, 0.15, 1, 9],
    [lip, 0, 0.95, 7],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const t = from + ((to - from) * i) / (n - 1);
      const { at, dir } = cubic(seg, t);
      const out: Pt = [dir[1], -dir[0]]; // outside of the crest
      const len = 16 + rnd() * 12;
      const tip: Pt = [at[0] + out[0] * len, at[1] + out[1] * len];
      // Each claw curls forward, the way the foam reaches ahead of the wave.
      const hook: Pt = [tip[0] + dir[0] * len * 0.7 - out[0] * len * 0.3, tip[1] + dir[1] * len * 0.7 - out[1] * len * 0.3];
      claws.push(`M${f(at[0])} ${f(at[1])} Q${f(tip[0])} ${f(tip[1])} ${f(hook[0])} ${f(hook[1])}`);
      if (rnd() > 0.45) spray.push([at[0] + out[0] * (len + 16 + rnd() * 26), at[1] + out[1] * (len + 16 + rnd() * 26)]);
    }
  }
  const hatch = Array.from({ length: 4 }, (_, k) => {
    const b = 150 + k * 62;
    return `M${b} 440 C ${b + 30} 385, ${b + 60 + k * 4} 320, ${b + 95 + k * 6} 262`;
  }).join(' ');

  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path
        className="sc-deep sc-stroke"
        d="M0 440 C 80 380, 170 250, 250 160 C 310 90, 400 50, 480 60 C 560 70, 600 120, 585 165
           C 565 135, 525 118, 485 128 C 420 145, 395 215, 410 280 C 430 350, 560 410, 800 440 Z"
      />
      <path className="sc-2" d="M80 440 C 140 390, 215 275, 285 195 C 335 140, 395 110, 455 108 C 420 128, 380 172, 372 232 C 362 320, 420 392, 520 440 Z" />
      <path className="sc-hatch" d={hatch} />
      <g className="sc-claw">
        <path className="sc-claw-edge" d={claws.join(' ')} />
        <path className="sc-claw-fill" d={claws.join(' ')} />
      </g>
      {spray.map(([sx, sy], i) => (
        <circle key={i} className="sc-foam sc-stroke-thin" cx={f(sx)} cy={f(sy)} r={3 + (i % 3) * 1.5} />
      ))}
    </g>
  );
}

/** Horizontal wave marks on open water. */
function Ripples({ y1, y2, seed }: { y1: number; y2: number; seed: number }) {
  const rnd = random(seed);
  const d: string[] = [];
  for (let y = y1; y < y2; y += 14) {
    for (let x = rnd() * 80; x < W; x += 90 + rnd() * 90) d.push(`M${f(x)} ${y} q 14 -7 28 0`);
  }
  return <path className="sc-hatch" d={d.join(' ')} />;
}

// ---------- Scenes ----------

/** Harbor: Fuji across a calm bay, square sails, mist on the slopes. */
function Harbor() {
  const boat = (x: number, y: number, s: number) => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="sc-3 sc-stroke" d="M-46 0 L46 0 L34 16 L-36 16 Z" />
      <path className="sc-foam sc-stroke" d="M-26 -8 L26 -8 L26 -92 L-26 -92 Z" />
      <path className="sc-hatch" d="M-9 -90 L-9 -10 M9 -90 L9 -10 M0 -8 L0 0" />
    </g>
  );
  return (
    <>
      <Mist x={980} y={230} w={380} />
      <Fuji x={800} base={470} w={640} h={235} />
      <Mist x={420} y={395} w={560} h={34} />
      <rect className="sc-1" x={0} y={470} width={W} height={H - 470} />
      <path className="sc-line-soft" d={`M0 470 L${W} 470`} />
      <Ripples y1={490} y2={H} seed={7} />
      {boat(560, 520, 0.9)}
      {boat(1110, 540, 1.1)}
      {boat(1300, 505, 0.7)}
    </>
  );
}

/** Beach: the great wave, with Fuji small beyond it. */
function Beach() {
  return (
    <>
      <Mist x={420} y={290} w={760} />
      <Fuji x={1000} base={565} w={190} h={72} />
      <Wave x={1060} y={370} s={0.5} seed={11} />
      <Wave x={300} y={150} s={1} seed={3} />
      <Wave x={-120} y={420} s={0.4} seed={5} />
      <Ripples y1={574} y2={H} seed={2} />
    </>
  );
}

/** Desert: a low sun behind mist, dunes combed by the wind. */
function Desert() {
  const dunes = [
    { cls: 'sc-1', top: 'M0 470 C 200 440, 350 400, 520 420 C 700 440, 820 380, 1000 395 C 1180 410, 1350 440, 1600 430' },
    { cls: 'sc-2', top: 'M0 520 C 180 500, 330 450, 560 470 C 760 488, 860 520, 1060 500 C 1260 480, 1400 470, 1600 490' },
    { cls: 'sc-3', top: 'M0 565 C 220 545, 420 520, 640 545 C 820 565, 1000 540, 1200 555 C 1380 568, 1500 560, 1600 570' },
  ];
  return (
    <>
      <circle className="sc-sun" cx={1000} cy={250} r={96} />
      <Mist x={820} y={292} w={560} h={32} />
      <Mist x={240} y={352} w={640} h={26} />
      {dunes.map((d, i) => (
        <g key={i}>
          <clipPath id={`sc-dune-${i}`}>
            <path d={`${d.top} L${W} ${H} L0 ${H} Z`} />
          </clipPath>
          <path className={d.cls} d={`${d.top} L${W} ${H} L0 ${H} Z`} />
          {/* Ripples follow the crest line down the face of the dune. */}
          <g clipPath={`url(#sc-dune-${i})`}>
            {[1, 2, 3, 4].map((k) => (
              <path key={k} className="sc-hatch" d={d.top} transform={`translate(${k * 9} ${k * 13})`} />
            ))}
          </g>
          <path className="sc-line" d={d.top} />
        </g>
      ))}
    </>
  );
}

/** Deep forest: a belt of cedars in mist below the ridges, a pine in front. */
function Forest() {
  const rnd = random(19);
  const cedars: ReactNode[] = [];
  for (let x = -20, i = 0; x < W + 40; x += 30 + rnd() * 22, i++) {
    const h = 80 + rnd() * 70;
    const w = 34 + rnd() * 12;
    const base = 488 + rnd() * 10;
    const top = base - h;
    // Jagged tiers down each side, like the stacked boughs of a cedar: a tip, then a notch inward.
    const right: Pt[] = [0.3, 0.55, 0.8, 1].flatMap((k): Pt[] => {
      const tip: Pt = [(w / 2) * k, top + h * k];
      return k < 1 ? [tip, [(w / 2) * k * 0.55, top + h * k + 2]] : [tip];
    });
    const outline = [...right, ...[...right].reverse().map(([dx, y]): Pt => [-dx, y])];
    cedars.push(
      <path
        key={i}
        className={`${i % 3 === 0 ? 'sc-3' : 'sc-2'} sc-stroke-thin`}
        d={`M${f(x)} ${f(top)} ${outline.map(([dx, y]) => `L${f(x + dx)} ${f(y)}`).join(' ')} Z`}
      />,
    );
  }
  return (
    <>
      <Mist x={880} y={215} w={420} />
      <path
        className="sc-1 sc-stroke-thin"
        d="M0 430 L180 330 L300 390 L470 280 L620 380 L760 300 L900 390 L1080 270 L1250 370 L1400 320 L1600 400 L1600 600 L0 600 Z"
      />
      <Mist x={120} y={372} w={620} h={28} />
      {cedars}
      <Mist x={560} y={478} w={700} h={30} />
      <path className="sc-3 sc-stroke" d="M0 600 L0 548 C 300 525, 500 535, 700 548 C 900 562, 1200 532, 1600 546 L1600 600 Z" />
      <Pine x={770} y={560} s={0.95} />
      <Pine x={1230} y={556} s={0.55} flip />
    </>
  );
}

/** Prairie: rolling hills, a pale sun, pampas grass bending in the wind. */
function Prairie() {
  const rnd = random(23);
  const blades: string[] = [];
  const plumes: string[] = [];
  for (let i = 0; i < 70; i++) {
    const x = 300 + rnd() * 1000 + (rnd() - 0.5) * 500;
    const h = 90 + rnd() * 140;
    const lean = 30 + rnd() * 60;
    blades.push(`M${f(x)} ${H} Q${f(x + lean * 0.2)} ${f(H - h * 0.6)} ${f(x + lean)} ${f(H - h)}`);
    if (i % 5 === 0) {
      // A plume: a stem, then fine strands falling away downwind.
      const top: Pt = [x + lean * 1.1, H - h - 50];
      plumes.push(`M${f(x)} ${H} Q${f(x + lean * 0.3)} ${f(H - h * 0.7)} ${f(top[0])} ${f(top[1])}`);
      for (let k = 0; k < 7; k++) {
        const sx = top[0] - k * 7;
        const sy = top[1] + k * 9;
        plumes.push(`M${f(sx)} ${f(sy)} q 18 4 26 20`);
      }
    }
  }
  const flowers = Array.from({ length: 26 }, (_, i) => [180 + ((i * 523) % 1250), 572 + ((i * 37) % 22)] as Pt);
  return (
    <>
      <circle className="sc-sun" cx={1040} cy={245} r={84} />
      <Mist x={660} y={292} w={660} />
      <path className="sc-1 sc-stroke-thin" d="M0 470 C 300 420, 600 430, 800 452 C 1000 474, 1300 412, 1600 440 L1600 600 L0 600 Z" />
      <Mist x={200} y={430} w={520} h={26} />
      <path className="sc-2 sc-stroke-thin" d="M0 530 C 260 500, 520 505, 760 522 C 1000 540, 1300 500, 1600 515 L1600 600 L0 600 Z" />
      <path className="sc-grass" d={blades.join(' ')} />
      <path className="sc-plume" d={plumes.join(' ')} />
      {flowers.map(([x, y], i) => (
        <circle key={i} className="sc-sun-strong" cx={x} cy={y} r={4} />
      ))}
    </>
  );
}

/** Night: geese crossing the full moon, clouds in bands, dark ridges and a pine. */
function Night() {
  const goose = (x: number, y: number, s: number) =>
    `M${x - 16 * s} ${y - 5 * s} Q${x - 7 * s} ${y - 6 * s} ${x} ${y} Q${x + 7 * s} ${y - 6 * s} ${x + 16 * s} ${y - 5 * s}`;
  return (
    <>
      <circle className="sc-moon sc-stroke-thin" cx={1000} cy={205} r={92} />
      <path
        className="sc-line"
        d={[goose(930, 175, 1.3), goose(975, 205, 1.1), goose(1030, 160, 1.2), goose(1070, 230, 1), goose(890, 225, 0.9)].join(' ')}
      />
      <Mist x={860} y={262} w={420} h={30} />
      <Mist x={380} y={318} w={520} h={24} />
      <path className="sc-1 sc-stroke-thin" d="M0 470 L220 380 L380 440 L560 350 L720 430 L880 370 L1060 450 L1260 360 L1440 420 L1600 380 L1600 600 L0 600 Z" />
      <Mist x={620} y={455} w={640} h={28} />
      <path className="sc-2 sc-stroke-thin" d="M0 560 C 240 520, 480 540, 700 530 C 920 520, 1180 555, 1600 530 L1600 600 L0 600 Z" />
      <Pine x={1330} y={568} s={0.6} />
    </>
  );
}
