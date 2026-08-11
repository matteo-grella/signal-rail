//! Parity fixture generator: full logical cells + ASCII, plus a
//! 64-bit seed-boundary block. Same matrix as parity.js / parity.py.
const std = @import("std");
const rail = @import("rail-vendored.zig");

fn snapLine(state: rail.State, name: []const u8, w: usize, tick: u64, moff: bool, prog: ?f32, seed: u64) void {
    var cells: [rail.max_width]rail.Cell = undefined;
    var buf: [rail.max_width]u8 = undefined;
    const q: u3 = @intCast(tick % 5);
    var ctx = rail.Ctx{ .width = w, .tick = tick, .entry_tick = 0, .input_q = q, .output_q = q, .seed = seed, .progress = prog };
    if (moff) ctx.motion = .off;
    rail.frame(state, ctx, &cells);
    const s = rail.renderAsciiCells(cells[0..w], &buf);
    std.debug.print("{s}|{d}|{d}|{d}|{d}|{s}|", .{ name, w, tick, @intFromBool(moff), seed, s });
    for (cells[0..w], 0..) |c, i| {
        if (i != 0) std.debug.print(",", .{});
        std.debug.print("{s}:{s}:{s}", .{ @tagName(c.glyph), @tagName(c.color), @tagName(c.emphasis) });
    }
    std.debug.print("\n", .{});
}

pub fn main() void {
    const states = [_]rail.State{ .idle, .listening, .captured, .thinking, .speaking, .acting, .waiting, .needs_input, .complete, .interrupted, .err };
    const names = [_][]const u8{ "idle", "listening", "captured", "thinking", "speaking", "acting", "waiting", "needs_input", "complete", "interrupted", "error" };
    const widths = [_]usize{ 25, 37, 49, 61 };
    const ticks = [_]u64{ 0, 1, 2, 3, 4, 7, 11, 26, 53 };
    for (states, names) |st, name| {
        for (widths) |w| {
            for (ticks) |tick| {
                for ([_]bool{ false, true }) |moff| {
                    snapLine(st, name, w, tick, moff, null, 9);
                    if (st == .acting)
                        snapLine(st, "acting_det", w, tick, moff, @as(f32, @floatFromInt(tick)) / 64.0, 9);
                }
            }
        }
    }
    const seeds = [_]u64{ 0, 2147483649, 9007199254740991, 18446744073709551615 };
    const bstates = [_]rail.State{ .thinking, .waiting, .err };
    const bnames = [_][]const u8{ "thinking", "waiting", "error" };
    for (seeds) |seed| {
        for (bstates, bnames) |st, name| {
            for ([_]u64{ 4, 26 }) |tick| {
                snapLine(st, name, 49, tick, false, null, seed);
            }
        }
    }
}
