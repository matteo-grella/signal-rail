// Parity fixture generator: same matrix as snap.zig / parity.py.
// Emits full logical cells (glyph:color:emphasis) plus the ASCII render,
// so parity covers the complete cell contract, not just glyphs.
const path = require('path');
const R = require(path.join(__dirname, '..', 'rail.js'));

const states = ['idle', 'listening', 'captured', 'thinking', 'speaking', 'acting',
  'waiting', 'needs_input', 'complete', 'interrupted', 'error'];
const widths = [25, 37, 49, 61];
const ticks = [0, 1, 2, 3, 4, 7, 11, 26, 53];
// 64-bit boundary seeds: zero, >2^31 (32-bit truncation trap), 2^53-1
// (Number precision edge), 2^64-1 (full range; BigInt required in JS)
const seeds = [0n, 2147483649n, 9007199254740991n, 18446744073709551615n];

const lines = [];
function cellsStr(cells) {
  return cells.map((c) => `${c.glyph}:${c.color}:${c.emphasis}`).join(',');
}
function snapLine(state, name, w, tick, moff, prog, seed) {
  const q = tick % 5;
  const cells = R.frame(state, {
    width: w, tick, entryTick: 0, inputQ: q, outputQ: q, seed,
    progress: prog, motion: moff ? 'off' : 'normal',
  });
  lines.push(`${name}|${w}|${tick}|${moff ? 1 : 0}|${seed}|${R.renderAscii(cells)}|${cellsStr(cells)}`);
}

for (const st of states) {
  for (const w of widths) {
    for (const tick of ticks) {
      for (const moff of [false, true]) {
        snapLine(st, st, w, tick, moff, null, 9n);
        if (st === 'acting') snapLine(st, 'acting_det', w, tick, moff, tick / 64, 9n);
      }
    }
  }
}
// seed-boundary block: seeded states only
for (const seed of seeds) {
  for (const st of ['thinking', 'waiting', 'error']) {
    for (const tick of [4, 26]) {
      snapLine(st, st, 49, tick, false, null, seed);
    }
  }
}
process.stdout.write(lines.join('\n') + '\n');
