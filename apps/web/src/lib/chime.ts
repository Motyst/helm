/**
 * The timer's sound, made with Web Audio so there is no file to load. Browsers only let a page
 * play sound after a tap, so `unlockAudio` runs on the tap that starts a timer.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

export function unlockAudio(): void {
  const a = audio();
  if (a && a.state !== 'running') void a.resume().catch(() => undefined);
}

/** A soft three-note bell, played `rounds` times. */
export function playChime(rounds = 3): void {
  const a = audio();
  if (!a) return;
  if (a.state !== 'running') void a.resume().catch(() => undefined);
  const notes = [880, 1174.66, 1567.98];
  const start = a.currentTime + 0.05;
  for (let r = 0; r < rounds; r++) {
    notes.forEach((freq, i) => {
      const t = start + r * 1.6 + i * 0.22;
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc.connect(gain).connect(a.destination);
      osc.start(t);
      osc.stop(t + 1.2);
    });
  }
}

export function vibrate(): void {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 600]);
  } catch {
    /* not supported */
  }
}
