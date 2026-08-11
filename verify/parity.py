"""Parity fixture generator: same matrix as snap.zig / parity.js, via rail.py.
Emits full logical cells (glyph:color:emphasis) plus the ASCII render."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import rail  # noqa: E402  (the Signal Rail engine one directory up)

states = ["idle", "listening", "captured", "thinking", "speaking", "acting",
          "waiting", "needs_input", "complete", "interrupted", "error"]
widths = [25, 37, 49, 61]
ticks = [0, 1, 2, 3, 4, 7, 11, 26, 53]
# 64-bit boundary seeds (see parity.js for rationale)
seeds = [0, 2147483649, 9007199254740991, 18446744073709551615]

lines = []


def cells_str(cells):
    return ",".join(f"{c.glyph}:{c.color}:{c.emphasis}" for c in cells)


def snap_line(state, name, w, tick, moff, prog, seed):
    q = tick % 5
    cells = rail.frame(state, width=w, tick=tick, entry_tick=0, input_q=q,
                       output_q=q, seed=seed, progress=prog,
                       motion="off" if moff else "normal")
    lines.append(f"{name}|{w}|{tick}|{1 if moff else 0}|{seed}|"
                 f"{rail.render_ascii(cells)}|{cells_str(cells)}")


for st in states:
    for w in widths:
        for tick in ticks:
            for moff in (False, True):
                snap_line(st, st, w, tick, moff, None, 9)
                if st == "acting":
                    snap_line(st, "acting_det", w, tick, moff, tick / 64, 9)

for seed in seeds:
    for st in ("thinking", "waiting", "error"):
        for tick in (4, 26):
            snap_line(st, st, 49, tick, False, None, seed)

sys.stdout.write("\n".join(lines) + "\n")
