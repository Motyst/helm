// Generates the PWA icons in public/ from one drawing: a magenta course line with one course
// change, ending at a position fix (circle and dot, as plotted on a chart).
// Run with `pnpm --filter @helm/web icons` after changing the drawing; the PNGs are committed.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const NAVY = '#18293a';
const FOG = '#d5e1e7';
const MAGENTA = '#e26aa3';

/**
 * Drawn on a 512 grid. Everything important stays inside the maskable safe zone
 * (a circle of radius 205 around the centre), so one drawing serves every shape.
 */
function drawing({ radius }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${NAVY}"/>
  <path d="M124 388 L214 236 L290 204" fill="none" stroke="${MAGENTA}" stroke-width="30"
    stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="214" cy="236" r="15" fill="${FOG}"/>
  <circle cx="356" cy="176" r="58" fill="none" stroke="${FOG}" stroke-width="22"/>
  <circle cx="356" cy="176" r="18" fill="${FOG}"/>
</svg>
`;
}

function png(svg, size, file) {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
  writeFileSync(join(out, file), img.asPng());
}

const rounded = drawing({ radius: 112 });
const square = drawing({ radius: 0 });

writeFileSync(join(out, 'favicon.svg'), rounded);
png(rounded, 192, 'icon-192.png');
png(rounded, 512, 'icon-512.png');
// Maskable and Apple icons are full-bleed; the OS applies its own shape.
png(square, 512, 'icon-maskable-512.png');
png(square, 180, 'apple-touch-icon.png');
console.log(`Icons written to ${out}`);
