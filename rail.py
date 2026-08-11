"""Signal Rail 1.0 — Python engine.

Faithful port of the reference implementation (fucina
examples/voiceagent/rail.zig): frame() is a pure, deterministic map
(state, ctx) -> logical cells, byte-identical to the Zig engine on the
shared state set (verified by the parity harness in this directory).
The logical cell model carries no ANSI, no colors-as-values, no timing;
renderers map cells through a glyph profile and the palette (spec §5).

Beyond the Zig reference: WARNING, implemented from Signal Rail 1.0 §25
(fixed lattice, double pulse). The voice agent omits WARNING because it
has no genuine warning source; a host that has one can use it.

Dependency-free (stdlib only), Python 3.8+.
"""

from __future__ import annotations

from typing import List, NamedTuple, Optional

TICK_MS = 1000.0 / 12.0  # 12 Hz base tick (spec §13)
MAX_WIDTH = 61

STATES = [
    "idle", "listening", "captured", "thinking", "speaking", "acting",
    "waiting", "needs_input", "complete", "warning", "error", "interrupted",
]

LABELS = {
    "idle": "IDLE", "listening": "LISTENING", "captured": "CAPTURED",
    "thinking": "THINKING", "speaking": "SPEAKING", "acting": "ACTING",
    "waiting": "WAITING", "needs_input": "NEEDS INPUT", "complete": "COMPLETE",
    "warning": "WARNING", "error": "ERROR", "interrupted": "INTERRUPTED",
}

# glyph rank for the speaking-overlap rule (keep the highest intensity)
_GLYPH_RANK = {
    "track": 0, "low": 1, "medium": 2, "high": 3, "peak": 4,
    "head_right": 5, "head_left": 6, "boundary": 7, "hard_boundary": 8,
    "fracture": 9,
}

GLYPHS = {
    "instrument_square": {
        "track": "─", "low": "▪", "medium": "■", "high": "█",
        "peak": "█", "head_right": "▐", "head_left": "▌",
        "boundary": "│", "hard_boundary": "┃", "fracture": " ",
    },
    "safe_block": {
        "track": "─", "low": "▂", "medium": "▄", "high": "▆",
        "peak": "█", "head_right": "▐", "head_left": "▌",
        "boundary": "│", "hard_boundary": "┃", "fracture": " ",
    },
    "ascii": {
        "track": "-", "low": ".", "medium": "=", "high": "#", "peak": "#",
        "head_right": ">", "head_left": "<", "boundary": "|",
        "hard_boundary": "!", "fracture": " ",
    },
}

# obsidian_instrument truecolor palette (spec §11.1), as (r, g, b)
PALETTE = {
    "track": (0x30, 0x36, 0x3B), "frame": (0x4A, 0x51, 0x57),
    "aux": (0x7C, 0x80, 0x7C),
    "neutral": (0xC9, 0xC3, 0xB4), "neutral_hot": (0xF0, 0xEB, 0xDD),
    "input": (0xD4, 0x9A, 0x32), "input_hot": (0xFF, 0xC7, 0x5A),
    "output": (0x8E, 0xAF, 0x8B), "output_hot": (0xC6, 0xE1, 0xBB),
    "success": (0x69, 0xB5, 0x78), "success_hot": (0xA8, 0xDB, 0xA9),
    "warning": (0xD9, 0x77, 0x2A), "warning_hot": (0xF0, 0xA3, 0x4A),
    "interrupted": (0x8E, 0x45, 0x42),
    "err": (0xB7, 0x40, 0x3D), "err_hot": (0xEF, 0x65, 0x5D),
}

LABEL_COLOR = {
    "idle": "neutral", "thinking": "neutral", "acting": "neutral",
    "listening": "input", "captured": "input", "waiting": "input",
    "needs_input": "input", "speaking": "output", "complete": "success",
    "warning": "warning", "interrupted": "interrupted", "error": "err_hot",
}


class Cell(NamedTuple):
    glyph: str
    color: str
    emphasis: str  # 'dim' | 'normal' | 'bright'


class Zones(NamedTuple):
    input: int
    processing: int
    output: int


def zones_of(width: int) -> Zones:
    zin = (width * 28 + 50) // 100
    proc = (width * 44 + 50) // 100
    return Zones(zin, proc, width - zin - proc)


def quantize(level: float) -> int:
    """§14 quantization bands (NaN -> 0, clamp 0..1)."""
    v = 0.0 if level != level else min(1.0, max(0.0, level))
    if v < 0.10:
        return 0
    if v < 0.30:
        return 1
    if v < 0.50:
        return 2
    if v < 0.75:
        return 3
    return 4


def step_level(prev: int, target: int) -> int:
    """Stepped meter response: rise <=2, fall <=1 per tick."""
    if target > prev:
        return min(target, prev + 2)
    if target < prev:
        return prev - 1
    return prev


_M64 = (1 << 64) - 1
_C1 = 0x9E3779B97F4A7C15
_C2 = 0xBF58476D1CE4E5B9
_C3 = 0x94D049BB133111EB


def hash3(seed: int, a: int, b: int) -> int:
    """64-bit wrapping hash, bit-identical to the Zig engine's hash3."""
    h = (seed ^ ((a * _C1) & _M64) ^ ((b * _C2) & _M64)) & _M64
    h ^= h >> 30
    h = (h * _C2) & _M64
    h ^= h >> 27
    h = (h * _C3) & _M64
    return (h ^ (h >> 31)) & _M64


_TRACK = Cell("track", "track", "dim")


def frame(
    state: str,
    *,
    width: int,
    tick: int,
    entry_tick: int = 0,
    input_q: int = 0,
    output_q: int = 0,
    seed: int = 0,
    progress: Optional[float] = None,
    motion: str = "normal",
) -> List[Cell]:
    """Generate one logical frame. Pure and deterministic."""
    w = width
    z = zones_of(w)
    t = tick - entry_tick
    off = motion == "off"
    cells = [_TRACK] * w

    def put(i: int, c: Cell) -> None:
        if 0 <= i < w:
            cells[i] = c

    if state == "idle":
        # one stable marker at the processing-zone center; no animation
        put(z.input + z.processing // 2, Cell("medium", "neutral", "normal"))

    elif state == "listening":
        # quantized amplitude expands from the input-zone origin
        origin = z.input // 2
        q = input_q
        if q == 0:
            put(origin, Cell("medium", "input", "normal"))
        else:
            radius = min(z.input // 2, q + 1)
            for d in range(radius + 1):
                lvl = min(4, max(1, q + 1 - d))
                g = ("low", "medium", "high", "peak")[lvl - 1]
                col = "input_hot" if lvl >= 4 else "input"
                em = "bright" if lvl >= 4 else "normal"
                if origin + d < z.input:
                    put(origin + d, Cell(g, col, em))
                if d != 0 and origin >= d:
                    put(origin - d, Cell(g, col, em))

    elif state == "captured":
        # 4-tick collapse toward the origin, ending input-hot
        origin = z.input // 2
        phase = min(t, 3)
        spread = 3 if phase == 0 else 2 if phase == 1 else 1
        for d in range(spread):
            em = "bright" if phase >= 3 else "normal"
            col = "input_hot" if phase >= 3 else "input"
            if origin + d < z.input:
                put(origin + d, Cell("peak", col, em))
            if d != 0 and origin >= d:
                put(origin - d, Cell("peak", col, em))

    elif state == "thinking":
        # deterministic sparse field + read head, one cell per 2 ticks,
        # never bouncing; new field each pass
        p0 = z.input
        plen = z.processing
        steps_per_pass = plen + 1
        pos_in_pass = (t // 2) % steps_per_pass
        pass_i = (t // 2) // steps_per_pass
        for i in range(plen):
            h = hash3(seed, pass_i, i) % 100
            if h < 25:
                put(p0 + i, Cell("low", "neutral", "dim"))
            elif h < 40:
                put(p0 + i, Cell("medium", "neutral", "normal"))
        if off:
            put(p0 + plen // 2, Cell("head_right", "neutral_hot", "bright"))
        elif pos_in_pass < plen:
            head = p0 + pos_in_pass
            put(head, Cell("head_right", "neutral_hot", "bright"))
            if pos_in_pass >= 1:
                put(head - 1, Cell("medium", "neutral", "normal"))
            if pos_in_pass >= 2:
                put(head - 2, Cell("low", "neutral", "dim"))
        # else: the one-tick inter-pass dim (field only)

    elif state == "speaking":
        # packets spawn at the output boundary and travel right one
        # cell/tick; spawn period follows the quantized output level
        o0 = z.input + z.processing
        olen = z.output
        period = (12, 8, 6, 4, 3)[output_q]
        if off:
            put(o0 + olen // 2, Cell("medium", "output", "normal"))
            put(o0 + olen // 2 + 1, Cell("head_right", "output_hot", "bright"))
        else:
            plen_pkt = min(3, output_q + 1)
            live = 0
            spawn_i = 0
            while live < 3:
                if spawn_i * period > t:
                    break
                age = t - spawn_i * period
                spawn_i += 1
                if age >= olen + plen_pkt:
                    continue  # left the rail
                live += 1
                for k in range(plen_pkt + 1):
                    if age < k:
                        break
                    cell_off = age - k
                    if cell_off >= olen:
                        continue
                    idx = o0 + cell_off
                    nxt = (
                        Cell("head_right", "output_hot", "bright") if k == 0
                        else Cell("medium", "output", "normal") if k == 1
                        else Cell("low", "output", "dim")
                    )
                    # overlap keeps the highest intensity
                    if (_GLYPH_RANK[cells[idx].glyph] < _GLYPH_RANK[nxt.glyph]
                            or cells[idx].glyph == "track"):
                        cells[idx] = nxt

    elif state == "waiting":
        # frozen dim residue, pulsing boundary at the processing/output
        # boundary (where emission stopped)
        b = z.input + z.processing
        for i in range(b):
            if hash3(seed, 7, i) % 100 < 30:
                put(i, Cell("low", "neutral", "dim"))
        bright = (t % 11) < 4
        put(b, Cell("boundary", "input",
                    "bright" if bright and not off else "normal"))

    elif state == "acting":
        if progress is not None:
            # determinate: committed cells + head + track (spec §21.1)
            pc = min(1.0, max(0.0, progress))
            committed = min(w - 1, int(pc * w))
            for i in range(committed):
                put(i, Cell("medium", "neutral", "normal"))
            put(committed, Cell("head_right", "neutral_hot", "bright"))
        else:
            # indeterminate: bounded work packet through processing + output,
            # two-tick pause, restart — never bouncing (§21.2)
            span = z.processing + z.output
            cycle = span + 2
            pos = t % cycle
            if pos < span and not off:
                head = z.input + pos
                put(head, Cell("head_right", "neutral_hot", "bright"))
                if pos >= 1:
                    put(head - 1, Cell("peak", "neutral", "normal"))
                if pos >= 2:
                    put(head - 2, Cell("medium", "neutral", "normal"))
                if pos >= 3:
                    put(head - 3, Cell("low", "neutral", "dim"))
            elif off:
                b = z.input + z.processing
                put(b - 1, Cell("peak", "neutral", "normal"))
                put(b, Cell("head_right", "neutral_hot", "bright"))

    elif state == "needs_input":
        # control handed back: processing + input markers alternate
        in_mark = z.input // 2
        proc_mark = z.input + z.processing // 2
        phase = t % 15
        a_hot = phase < 4
        b_hot = 4 <= phase < 8
        put(proc_mark, Cell("medium" if a_hot else "low", "input",
                            "bright" if a_hot and not off else "normal"))
        put(in_mark, Cell("medium" if (b_hot or off) else "low", "input_hot",
                          "bright" if b_hot and not off else "normal"))

    elif state == "complete":
        # one rightward sweep, then a settled medium rail
        speed = (w + 6) // 7
        head = (t + 1) * speed
        if head < w and not off:
            for i in range(head):
                put(i, Cell("medium", "success", "normal"))
            put(head, Cell("head_right", "success_hot", "bright"))
        else:
            for i in range(w):
                put(i, Cell("medium", "success", "normal"))

    elif state == "warning":
        # Signal Rail 1.0 §25 (not in the Zig reference — the voice agent
        # has no warning source): fixed lattice, double pulse
        p = t % 17
        bright = not off and (p < 2 or 4 <= p < 6)
        for i in range(0, w, 3):
            put(i, Cell("peak", "warning_hot" if bright else "warning",
                        "bright" if bright else "normal"))

    elif state == "interrupted":
        # stop, retract to the input/processing boundary, hard cut
        b = z.input
        retract = min(t, 3)
        spill = (3 - retract) * 2
        for i in range(b):
            put(i, Cell("medium", "interrupted", "normal"))
        i = 0
        while i < spill and b + 1 + i < w:
            put(b + 1 + i, Cell("low", "interrupted", "dim"))
            i += 1
        put(b, Cell("hard_boundary", "err", "bright"))

    elif state == "error":
        # saturate (2 ticks) -> blackout (1) -> deterministic fracture
        if t < 2 and not off:
            for i in range(w):
                put(i, Cell("peak", "err_hot", "bright"))
        elif t == 2 and not off:
            for i in range(w):
                put(i, Cell("fracture", "track", "dim"))
        else:
            i = 0
            while i < w:
                run = 2 + hash3(seed, 13, i) % 4
                gap = 1 + hash3(seed, 17, i) % 2
                k = 0
                while k < run and i < w:
                    cells[i] = Cell("peak", "err", "normal")
                    i += 1
                    k += 1
                k = 0
                while k < gap and i < w:
                    cells[i] = Cell("fracture", "track", "dim")
                    i += 1
                    k += 1
    else:
        raise ValueError(f"unknown state: {state}")

    return cells


def render_ascii(cells: List[Cell]) -> str:
    """ASCII render of logical cells (tests, NO_COLOR hosts)."""
    g = GLYPHS["ascii"]
    return "".join(g[c.glyph] for c in cells)


def render_ansi(
    state: str,
    cells: List[Cell],
    aux: str = "",
    profile: str = "instrument_square",
    color: str = "truecolor",
) -> str:
    """One-row ANSI render: label + caps + cells + aux, with compact SGR
    runs (style emitted only on change), mirroring the Zig renderer.
    color: 'truecolor' | 'mono' (mono uses dim/normal/bold only)."""
    glyphs = GLYPHS.get(profile, GLYPHS["instrument_square"])
    out: List[str] = []
    if color == "truecolor":
        r, g, b = PALETTE[LABEL_COLOR[state]]
        out.append(f"\x1b[38;2;{r};{g};{b}m")
    lbl = LABELS[state]
    out.append(lbl.ljust(12) if len(lbl) < 12 else lbl + " ")
    if color == "truecolor":
        out.append("\x1b[38;2;74;81;87m[")
    else:
        out.append("\x1b[0m[")
    prev = None
    for c in cells:
        key = (c.color, c.emphasis)
        if key != prev:
            prev = key
            if color == "truecolor":
                em = {"dim": "\x1b[2m", "normal": "", "bright": "\x1b[1m"}[c.emphasis]
                r, g, b = PALETTE[c.color]
                out.append(f"\x1b[0m{em}\x1b[38;2;{r};{g};{b}m")
            else:
                out.append({"dim": "\x1b[0;2m", "normal": "\x1b[0m",
                            "bright": "\x1b[0;1m"}[c.emphasis])
        out.append(glyphs[c.glyph])
    if color == "truecolor":
        out.append("\x1b[0m\x1b[38;2;74;81;87m]")
    else:
        out.append("\x1b[0m]")
    if aux:
        out.append(f"  \x1b[2m{aux}\x1b[0m")
    else:
        out.append("\x1b[0m")
    return "".join(out)


if __name__ == "__main__":
    # tiny self-demo: print every state once, truecolor, width 49
    import sys
    w = 49
    for st in STATES:
        cells = frame(st, width=w, tick=16, entry_tick=0, input_q=3,
                      output_q=3, seed=9,
                      progress=0.52 if st == "acting" else None)
        aux = {"acting": "052%", "waiting": "HOLD", "needs_input": "INPUT",
               "complete": "DONE", "error": "E03", "interrupted": "CUT",
               "thinking": "T+01.3"}.get(st, "")
        sys.stdout.write(render_ansi(st, cells, aux) + "\n")
