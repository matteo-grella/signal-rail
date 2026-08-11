#!/bin/sh
# Self-contained three-way parity check for Signal Rail 1.0.
# Requires: zig (0.16), node (>=16, BigInt), python3 (>=3.8). No network.
# Emits the fixture matrix from all three engines — full logical cells
# (glyph:color:emphasis) plus ASCII — and diffs them pairwise.
set -e
cd "$(dirname "$0")"

zig build-exe snap.zig -femit-bin=snap-bin
./snap-bin 2> fixtures-zig.txt
node parity.js > fixtures-js.txt
python3 parity.py > fixtures-py.txt

wc -l fixtures-zig.txt fixtures-js.txt fixtures-py.txt
diff fixtures-zig.txt fixtures-js.txt && echo "zig <-> js : IDENTICAL"
diff fixtures-zig.txt fixtures-py.txt && echo "zig <-> py : IDENTICAL"
echo "sha256:"
shasum -a 256 fixtures-zig.txt
