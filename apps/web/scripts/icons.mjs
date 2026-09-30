// Generates the PWA icons in public/ from one drawing: a ship's helm that doubles as a network.
// The spokes meet the rim at nodes and run into a magenta hub (the brain steering it all), and
// the top handle, also magenta, marks the heading.
// Run with `pnpm --filter @helm/web icons` after changing the drawing; the PNGs are committed.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const NAVY = '#18293a';
const DEEP = '#0f1c27';
const FOG = '#d5e1e7';
const MAGENTA = '#e26aa3';

const C = 256;
const RIM = 124;

/** The point `r` from the centre at compass bearing `deg` (0 is straight up). */
function at(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [+(C + r * Math.cos(a)).toFixed(1), +(C + r * Math.sin(a)).toFixed(1)];
}

function line(r1, r2, deg, attrs) {
  const [x1, y1] = at(r1, deg);
  const [x2, y2] = at(r2, deg);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-linecap="round" ${attrs}/>`;
}

/**
 * Drawn on a 512 grid. Everything important stays inside the maskable safe zone
 * (a circle of radius 205 around the centre), so one drawing serves every shape.
 */
function drawing({ radius, scale = 1 }) {
  let handles = '';
  let spokes = '';
  let nodes = '';
  for (let i = 0; i < 8; i++) {
    const deg = i * 45;
    const color = i === 0 ? MAGENTA : FOG;
    handles += line(146, 188, deg, `stroke="${color}" stroke-width="26"`);
    spokes += line(44, RIM, deg, `stroke="${color}" stroke-width="${i === 0 ? 12 : 10}"`);
    const [x, y] = at(RIM, deg);
    nodes += `<circle cx="${x}" cy="${y}" r="17" fill="${NAVY}" stroke="${color}" stroke-width="10"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="sea" cx="50%" cy="40%" r="70%">
      <stop offset="0" stop-color="${NAVY}"/>
      <stop offset="1" stop-color="${DEEP}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#sea)"/>
  <g transform="translate(${C} ${C}) scale(${scale}) translate(${-C} ${-C})">
  ${handles}
  <circle cx="${C}" cy="${C}" r="${RIM}" fill="none" stroke="${FOG}" stroke-width="20"/>
  ${spokes}
  ${nodes}
  <circle cx="${C}" cy="${C}" r="42" fill="${MAGENTA}"/>
  <circle cx="${C}" cy="${C}" r="13" fill="${NAVY}"/>
  </g>
</svg>
`;
}

function png(svg, size, file) {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
  writeFileSync(join(out, file), img.asPng());
}

const rounded = drawing({ radius: 112 });
// Launchers crop these to a circle or squircle, so the helm sits smaller to keep clear of the edge.
const square = drawing({ radius: 0, scale: 0.84 });

writeFileSync(join(out, 'favicon.svg'), rounded);
png(rounded, 192, 'icon-192.png');
png(rounded, 512, 'icon-512.png');
// Maskable and Apple icons are full-bleed; the OS applies its own shape.
png(square, 512, 'icon-maskable-512.png');
png(square, 180, 'apple-touch-icon.png');

/** Home-screen shortcut icons: the helm's sea and magenta, with one glyph, clear of a circular crop. */
function shortcut(glyph) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" fill="${NAVY}"/>
  <circle cx="96" cy="96" r="58" fill="${MAGENTA}"/>
  <g fill="none" stroke="${NAVY}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>
`;
}
png(shortcut('<path d="M96 70v52M70 96h52"/>'), 192, 'shortcut-add.png');
png(
  shortcut('<rect x="84" y="62" width="24" height="42" rx="12"/><path d="M72 94a24 24 0 0 0 48 0M96 118v12"/>'),
  192,
  'shortcut-voice.png',
);
console.log(`Icons written to ${out}`);
