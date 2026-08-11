/*! Signal Rail 1.0 — web engine.
 *
 * Faithful port of the reference implementation (fucina
 * examples/voiceagent/rail.zig): the frame() function is a pure,
 * deterministic map (state, ctx) -> logical cells, byte-identical to the
 * Zig engine on the shared state set (verified by the parity harness in
 * this directory). The logical cell model contains no DOM, no colors-as-
 * values, no timing — renderers map cells through a glyph profile and a
 * palette, exactly as the spec requires (§5).
 *
 * One addition beyond the Zig reference: the WARNING state, implemented
 * from Signal Rail 1.0 §25 (fixed lattice, double pulse). The voice agent
 * omits WARNING because it has no genuine warning source; a web host that
 * has one can use it.
 *
 * Plain script (works from file:// via <script src>), also loadable from
 * Node via require() for the parity tests.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SignalRail = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TICK_MS = 1000 / 12; // 12 Hz base tick (spec §13)
  const MAX_WIDTH = 61;

  const STATES = [
    'idle', 'listening', 'captured', 'thinking', 'speaking', 'acting',
    'waiting', 'needs_input', 'complete', 'warning', 'error', 'interrupted',
  ];

  const LABELS = {
    idle: 'IDLE', listening: 'LISTENING', captured: 'CAPTURED',
    thinking: 'THINKING', speaking: 'SPEAKING', acting: 'ACTING',
    waiting: 'WAITING', needs_input: 'NEEDS INPUT', complete: 'COMPLETE',
    warning: 'WARNING', error: 'ERROR', interrupted: 'INTERRUPTED',
  };

  // glyph rank for the speaking-overlap rule (keep the highest intensity)
  const GLYPH_RANK = {
    track: 0, low: 1, medium: 2, high: 3, peak: 4,
    head_right: 5, head_left: 6, boundary: 7, hard_boundary: 8, fracture: 9,
  };

  const GLYPHS = {
    instrument_square: {
      track: '─', low: '▪', medium: '■', high: '█',
      peak: '█', head_right: '▐', head_left: '▌',
      boundary: '│', hard_boundary: '┃', fracture: ' ',
    },
    safe_block: {
      track: '─', low: '▂', medium: '▄', high: '▆',
      peak: '█', head_right: '▐', head_left: '▌',
      boundary: '│', hard_boundary: '┃', fracture: ' ',
    },
    ascii: {
      track: '-', low: '.', medium: '=', high: '#', peak: '#',
      head_right: '>', head_left: '<', boundary: '|', hard_boundary: '!',
      fracture: ' ',
    },
  };

  // obsidian_instrument truecolor palette (spec §11.1)
  const PALETTE = {
    bg: '#07090B', frame: '#4A5157', aux: '#7C807C',
    track: '#30363B', neutral: '#C9C3B4', neutral_hot: '#F0EBDD',
    input: '#D49A32', input_hot: '#FFC75A',
    output: '#8EAF8B', output_hot: '#C6E1BB',
    success: '#69B578', success_hot: '#A8DBA9',
    warning: '#D9772A', warning_hot: '#F0A34A',
    interrupted: '#8E4542', err: '#B7403D', err_hot: '#EF655D',
  };

  const LABEL_COLOR = {
    idle: 'neutral', thinking: 'neutral', acting: 'neutral',
    listening: 'input', captured: 'input', waiting: 'input', needs_input: 'input',
    speaking: 'output', complete: 'success', warning: 'warning',
    interrupted: 'interrupted', error: 'err_hot',
  };

  function zonesOf(width) {
    const input = Math.floor((width * 28 + 50) / 100);
    const processing = Math.floor((width * 44 + 50) / 100);
    return { input, processing, output: width - input - processing };
  }

  // §14 quantization bands
  function quantize(level) {
    const v = Number.isNaN(level) ? 0 : Math.min(1, Math.max(0, level));
    if (v < 0.10) return 0;
    if (v < 0.30) return 1;
    if (v < 0.50) return 2;
    if (v < 0.75) return 3;
    return 4;
  }

  // stepped meter response: rise <=2, fall <=1 per tick
  function stepLevel(prev, target) {
    if (target > prev) return Math.min(target, prev + 2);
    if (target < prev) return prev - 1;
    return prev;
  }

  // 64-bit wrapping hash, bit-identical to the Zig engine's hash3
  const M64 = (1n << 64n) - 1n;
  const C1 = 0x9E3779B97F4A7C15n, C2 = 0xBF58476D1CE4E5B9n, C3 = 0x94D049BB133111EBn;
  function hash3(seed, a, b) {
    let h = (BigInt(seed) ^ ((BigInt(a) * C1) & M64) ^ ((BigInt(b) * C2) & M64)) & M64;
    h ^= h >> 30n; h = (h * C2) & M64;
    h ^= h >> 27n; h = (h * C3) & M64;
    return Number((h ^ (h >> 31n)) % 100000n); // callers use small moduli
  }

  const cell = (glyph, color, emphasis) => ({ glyph, color, emphasis });
  const trackCell = () => cell('track', 'track', 'dim');

  /**
   * Generate one logical frame. Pure and deterministic.
   * ctx: { width, tick, entryTick, inputQ, outputQ, seed, progress, motion }
   *   width 25..61 (odd preferred), motion 'normal' | 'off',
   *   progress null for indeterminate ACTING, inputQ/outputQ quantized 0..4.
   */
  function frame(state, ctx) {
    const w = ctx.width;
    const z = zonesOf(w);
    const t = ctx.tick - ctx.entryTick;
    // seed is 64-bit: accept Number (exact to 2^53) or BigInt (full range);
    // hash3 promotes to BigInt internally — never truncate here
    const seed = ctx.seed;
    const off = ctx.motion === 'off';
    const cells = Array.from({ length: w }, trackCell);
    const set = (i, c) => { if (i >= 0 && i < w) cells[i] = c; };

    switch (state) {
      case 'idle': {
        // one stable marker at the processing-zone center; no animation
        set(z.input + Math.floor(z.processing / 2), cell('medium', 'neutral', 'normal'));
        break;
      }
      case 'listening': {
        // quantized amplitude expands from the input-zone origin
        const origin = Math.floor(z.input / 2);
        const q = ctx.inputQ;
        if (q === 0) {
          set(origin, cell('medium', 'input', 'normal'));
        } else {
          const radius = Math.min(Math.floor(z.input / 2), q + 1);
          for (let d = 0; d <= radius; d++) {
            const lvl = Math.min(4, Math.max(1, q + 1 - d));
            const g = lvl === 1 ? 'low' : lvl === 2 ? 'medium' : lvl === 3 ? 'high' : 'peak';
            const col = lvl >= 4 ? 'input_hot' : 'input';
            const em = lvl >= 4 ? 'bright' : 'normal';
            if (origin + d < z.input) set(origin + d, cell(g, col, em));
            if (d !== 0 && origin >= d) set(origin - d, cell(g, col, em));
          }
        }
        break;
      }
      case 'captured': {
        // 4-tick collapse toward the origin, ending input-hot
        const origin = Math.floor(z.input / 2);
        const phase = Math.min(t, 3);
        const spread = phase === 0 ? 3 : phase === 1 ? 2 : 1;
        for (let d = 0; d < spread; d++) {
          const em = phase >= 3 ? 'bright' : 'normal';
          const col = phase >= 3 ? 'input_hot' : 'input';
          if (origin + d < z.input) set(origin + d, cell('peak', col, em));
          if (d !== 0 && origin >= d) set(origin - d, cell('peak', col, em));
        }
        break;
      }
      case 'thinking': {
        // deterministic sparse field + read head, one cell per 2 ticks,
        // never bouncing; new field each pass
        const p0 = z.input;
        const plen = z.processing;
        const stepsPerPass = plen + 1;
        const posInPass = Math.floor(t / 2) % stepsPerPass;
        const pass = Math.floor(Math.floor(t / 2) / stepsPerPass);
        for (let i = 0; i < plen; i++) {
          const h = hash3(seed, pass, i) % 100;
          if (h < 25) set(p0 + i, cell('low', 'neutral', 'dim'));
          else if (h < 40) set(p0 + i, cell('medium', 'neutral', 'normal'));
        }
        if (off) {
          set(p0 + Math.floor(plen / 2), cell('head_right', 'neutral_hot', 'bright'));
        } else if (posInPass < plen) {
          const head = p0 + posInPass;
          set(head, cell('head_right', 'neutral_hot', 'bright'));
          if (posInPass >= 1) set(head - 1, cell('medium', 'neutral', 'normal'));
          if (posInPass >= 2) set(head - 2, cell('low', 'neutral', 'dim'));
        } // else: the one-tick inter-pass dim (field only)
        break;
      }
      case 'speaking': {
        // packets spawn at the output boundary and travel right one
        // cell/tick; spawn period follows the quantized output level
        const o0 = z.input + z.processing;
        const olen = z.output;
        const period = [12, 8, 6, 4, 3][ctx.outputQ];
        if (off) {
          set(o0 + Math.floor(olen / 2), cell('medium', 'output', 'normal'));
          set(o0 + Math.floor(olen / 2) + 1, cell('head_right', 'output_hot', 'bright'));
        } else {
          const plenPkt = Math.min(3, ctx.outputQ + 1);
          let live = 0;
          for (let spawnI = 0; live < 3; spawnI++) {
            if (spawnI * period > t) break;
            const age = t - spawnI * period;
            if (age >= olen + plenPkt) continue; // left the rail
            live++;
            for (let k = 0; k < plenPkt + 1; k++) {
              if (age < k) break;
              const cellOff = age - k;
              if (cellOff >= olen) continue;
              const idx = o0 + cellOff;
              const next = k === 0 ? cell('head_right', 'output_hot', 'bright')
                : k === 1 ? cell('medium', 'output', 'normal')
                : cell('low', 'output', 'dim');
              // overlap keeps the highest intensity
              if (GLYPH_RANK[cells[idx].glyph] < GLYPH_RANK[next.glyph] || cells[idx].glyph === 'track')
                cells[idx] = next;
            }
          }
        }
        break;
      }
      case 'waiting': {
        // frozen dim residue, pulsing boundary at the processing/output
        // boundary (where emission stopped)
        const b = z.input + z.processing;
        for (let i = 0; i < b; i++) {
          if (hash3(seed, 7, i) % 100 < 30) set(i, cell('low', 'neutral', 'dim'));
        }
        const bright = (t % 11) < 4;
        set(b, cell('boundary', 'input', bright && !off ? 'bright' : 'normal'));
        break;
      }
      case 'acting': {
        if (ctx.progress != null) {
          // determinate: committed cells + head + track (spec §21.1)
          const pc = Math.min(1, Math.max(0, ctx.progress));
          const committed = Math.min(w - 1, Math.floor(pc * w));
          for (let i = 0; i < committed; i++) set(i, cell('medium', 'neutral', 'normal'));
          set(committed, cell('head_right', 'neutral_hot', 'bright'));
        } else {
          // indeterminate: bounded work packet through processing + output,
          // two-tick pause, restart — never bouncing (§21.2)
          const span = z.processing + z.output;
          const cycle = span + 2;
          const pos = t % cycle;
          if (pos < span && !off) {
            const head = z.input + pos;
            set(head, cell('head_right', 'neutral_hot', 'bright'));
            if (pos >= 1) set(head - 1, cell('peak', 'neutral', 'normal'));
            if (pos >= 2) set(head - 2, cell('medium', 'neutral', 'normal'));
            if (pos >= 3) set(head - 3, cell('low', 'neutral', 'dim'));
          } else if (off) {
            const b = z.input + z.processing;
            set(b - 1, cell('peak', 'neutral', 'normal'));
            set(b, cell('head_right', 'neutral_hot', 'bright'));
          }
        }
        break;
      }
      case 'needs_input': {
        // control handed back: processing + input markers alternate
        const inMark = Math.floor(z.input / 2);
        const procMark = z.input + Math.floor(z.processing / 2);
        const phase = t % 15;
        const aHot = phase < 4;
        const bHot = phase >= 4 && phase < 8;
        set(procMark, cell(aHot ? 'medium' : 'low', 'input', aHot && !off ? 'bright' : 'normal'));
        set(inMark, cell(bHot || off ? 'medium' : 'low', 'input_hot', bHot && !off ? 'bright' : 'normal'));
        break;
      }
      case 'complete': {
        // one rightward sweep, then a settled medium rail
        const speed = Math.floor((w + 6) / 7);
        const head = (t + 1) * speed;
        if (head < w && !off) {
          for (let i = 0; i < head; i++) set(i, cell('medium', 'success', 'normal'));
          set(head, cell('head_right', 'success_hot', 'bright'));
        } else {
          for (let i = 0; i < w; i++) set(i, cell('medium', 'success', 'normal'));
        }
        break;
      }
      case 'warning': {
        // Signal Rail 1.0 §25 (not in the Zig reference — the voice agent
        // has no warning source): fixed lattice, double pulse
        // 150/150/150/950 ms ≈ ticks {0,1} and {4,5} bright of a 17-tick cycle
        const p = t % 17;
        const bright = !off && (p < 2 || (p >= 4 && p < 6));
        for (let i = 0; i < w; i += 3)
          set(i, cell('peak', bright ? 'warning_hot' : 'warning', bright ? 'bright' : 'normal'));
        break;
      }
      case 'interrupted': {
        // stop, retract to the input/processing boundary, hard cut
        const b = z.input;
        const retract = Math.min(t, 3);
        const spill = (3 - retract) * 2;
        for (let i = 0; i < b; i++) set(i, cell('medium', 'interrupted', 'normal'));
        for (let i = 0; i < spill && b + 1 + i < w; i++)
          set(b + 1 + i, cell('low', 'interrupted', 'dim'));
        set(b, cell('hard_boundary', 'err', 'bright'));
        break;
      }
      case 'error': {
        // saturate (2 ticks) -> blackout (1) -> deterministic fracture
        if (t < 2 && !off) {
          for (let i = 0; i < w; i++) set(i, cell('peak', 'err_hot', 'bright'));
        } else if (t === 2 && !off) {
          for (let i = 0; i < w; i++) set(i, cell('fracture', 'track', 'dim'));
        } else {
          let i = 0;
          while (i < w) {
            const run = 2 + hash3(seed, 13, i) % 4;
            const gap = 1 + hash3(seed, 17, i) % 2;
            for (let k = 0; k < run && i < w; k++) { cells[i] = cell('peak', 'err', 'normal'); i++; }
            for (let k = 0; k < gap && i < w; k++) { cells[i] = cell('fracture', 'track', 'dim'); i++; }
          }
        }
        break;
      }
      default:
        throw new Error('unknown state: ' + state);
    }
    return cells;
  }

  /** ASCII render of logical cells (tests, NO_COLOR hosts). */
  function renderAscii(cells) {
    return cells.map((c) => GLYPHS.ascii[c.glyph]).join('');
  }

  /**
   * DOM render into a container: one span per cell, colored inline from the
   * palette, dim as reduced opacity, bright as bold (bold-as-bright).
   */
  function renderInto(el, cells, profile) {
    const glyphs = GLYPHS[profile] || GLYPHS.instrument_square;
    while (el.childNodes.length > cells.length) el.removeChild(el.lastChild);
    while (el.childNodes.length < cells.length) {
      const s = el.ownerDocument.createElement('span');
      el.appendChild(s);
    }
    cells.forEach((c, i) => {
      const s = el.childNodes[i];
      const text = glyphs[c.glyph];
      if (s.textContent !== text) s.textContent = text;
      s.style.color = PALETTE[c.color];
      s.style.opacity = c.emphasis === 'dim' ? 0.55 : 1;
      s.style.fontWeight = c.emphasis === 'bright' ? '700' : '400';
    });
  }

  return {
    TICK_MS, MAX_WIDTH, STATES, LABELS, GLYPHS, PALETTE, LABEL_COLOR,
    zonesOf, quantize, stepLevel, hash3, frame, renderAscii, renderInto,
  };
});
