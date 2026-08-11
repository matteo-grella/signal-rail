//! Generates the paper's truecolor figure panels (LaTeX color runs) by
//! running the vendored reference engine. Output on stderr; RAILSPLIT
//! lines separate the three panels. Build: zig build-exe gen.zig
const std = @import("std");
const rail = @import("rail.zig");

const W = 49;
const bg = [3]u8{ 0x07, 0x09, 0x0B };

fn rgbOf(role: rail.ColorRole) [3]u8 {
    return switch (role) {
        .track => .{ 0x30, 0x36, 0x3B },
        .neutral => .{ 0xC9, 0xC3, 0xB4 },
        .neutral_hot => .{ 0xF0, 0xEB, 0xDD },
        .input => .{ 0xD4, 0x9A, 0x32 },
        .input_hot => .{ 0xFF, 0xC7, 0x5A },
        .output => .{ 0x8E, 0xAF, 0x8B },
        .output_hot => .{ 0xC6, 0xE1, 0xBB },
        .success => .{ 0x69, 0xB5, 0x78 },
        .success_hot => .{ 0xA8, 0xDB, 0xA9 },
        .interrupted => .{ 0x8E, 0x45, 0x42 },
        .err => .{ 0xB7, 0x40, 0x3D },
        .err_hot => .{ 0xEF, 0x65, 0x5D },
    };
}

fn hotOf(role: rail.ColorRole) rail.ColorRole {
    return switch (role) {
        .neutral => .neutral_hot,
        .input => .input_hot,
        .output => .output_hot,
        .success => .success_hot,
        .err => .err_hot,
        else => role,
    };
}

fn dimmed(c: [3]u8) [3]u8 {
    var res: [3]u8 = undefined;
    for (0..3) |i| {
        const f: f32 = @floatFromInt(c[i]);
        const b: f32 = @floatFromInt(bg[i]);
        res[i] = @intFromFloat(b + (f - b) * 0.55);
    }
    return res;
}

fn glyphOf(p: rail.GlyphProfile, g: rail.GlyphRole) []const u8 {
    return switch (p) {
        .instrument_square => switch (g) {
            .track => "─",
            .low => "▪",
            .medium => "■",
            .high => "█",
            .peak => "█",
            .head_right => "▐",
            .head_left => "▌",
            .boundary => "│",
            .hard_boundary => "┃",
            .fracture => "~",
        },
        .safe_block => switch (g) {
            .track => "─",
            .low => "▂",
            .medium => "▄",
            .high => "▆",
            .peak => "█",
            .head_right => "▐",
            .head_left => "▌",
            .boundary => "│",
            .hard_boundary => "┃",
            .fracture => "~",
        },
        .ascii => switch (g) {
            .track => "-",
            .low => ".",
            .medium => "=",
            .high => "#",
            .peak => "#",
            .head_right => ">",
            .head_left => "<",
            .boundary => "|",
            .hard_boundary => "!",
            .fracture => "~",
        },
    };
}

fn labelHex(s: rail.State) [3]u8 {
    return rgbOf(switch (s) {
        .idle, .thinking, .acting => .neutral,
        .listening, .captured, .waiting, .needs_input => .input,
        .speaking => .output,
        .complete => .success,
        .interrupted => .interrupted,
        .err => .err_hot,
    });
}

const frame_hex = [3]u8{ 0x4A, 0x51, 0x57 };
const aux_hex = [3]u8{ 0x7C, 0x80, 0x7C };

var out: std.ArrayList(u8) = .empty;
var gpa: std.mem.Allocator = undefined;

fn emitColor(c: [3]u8, bold: bool, text: []const u8) !void {
    const cmd: []const u8 = if (bold) "\\rb" else "\\rc";
    try out.print(gpa, "{s}{{{X:0>2}{X:0>2}{X:0>2}}}{{{s}}}", .{ cmd, c[0], c[1], c[2], text });
}

fn emitLine(profile: rail.GlyphProfile, lbl: []const u8, lbl_hex: [3]u8, state: rail.State, ctx_in: rail.Ctx, aux: []const u8) !void {
    var ctx = ctx_in;
    ctx.width = W;
    var cells: [rail.max_width]rail.Cell = undefined;
    rail.frame(state, ctx, &cells);

    // label, padded to 12 columns with ~
    var lblbuf: [16]u8 = undefined;
    var n: usize = 0;
    for (lbl) |ch| {
        lblbuf[n] = if (ch == ' ') '~' else ch;
        n += 1;
    }
    while (n < 12) : (n += 1) lblbuf[n] = '~';
    try emitColor(lbl_hex, false, lblbuf[0..12]);
    try emitColor(frame_hex, false, "[");

    // cells as merged same-style runs (like the renderer's SGR compaction)
    var run: std.ArrayList(u8) = .empty;
    defer run.deinit(gpa);
    var run_hex: [3]u8 = undefined;
    var run_bold = false;
    var have_run = false;
    for (cells[0..W]) |cell| {
        var color = cell.color;
        var bold = cell.emphasis == .bright;
        // Menlo-Bold lacks the box-drawing glyphs; brighten boundaries via
        // the hot color instead of bold (bold-as-bright, like ANSI-16)
        if (cell.glyph == .boundary or cell.glyph == .hard_boundary) {
            if (bold) color = hotOf(color);
            bold = false;
        }
        var c = rgbOf(color);
        if (cell.emphasis == .dim) c = dimmed(c);
        const g = glyphOf(profile, cell.glyph);
        if (have_run and (!std.mem.eql(u8, &c, &run_hex) or bold != run_bold)) {
            try emitColor(run_hex, run_bold, run.items);
            run.clearRetainingCapacity();
        }
        run_hex = c;
        run_bold = bold;
        have_run = true;
        try run.appendSlice(gpa, g);
    }
    if (have_run) try emitColor(run_hex, run_bold, run.items);
    try emitColor(frame_hex, false, "]");

    if (aux.len > 0) {
        try out.appendSlice(gpa, "~~");
        var esc: std.ArrayList(u8) = .empty;
        defer esc.deinit(gpa);
        for (aux) |ch| {
            if (ch == '%') try esc.appendSlice(gpa, "\\%") else try esc.append(gpa, ch);
        }
        try emitColor(aux_hex, false, esc.items);
    }
    try out.appendSlice(gpa, "\\\\\n");
}

pub fn main() !void {
    gpa = std.heap.page_allocator;

    // panel 1: the primary conversational loop (spec PrimaryState set)
    try emitLine(.instrument_square, "IDLE", labelHex(.idle), .idle, .{ .width = W, .tick = 0, .entry_tick = 0 }, "");
    try emitLine(.instrument_square, "LISTENING", labelHex(.listening), .listening, .{ .width = W, .tick = 6, .entry_tick = 0, .input_q = 3 }, "");
    try emitLine(.instrument_square, "CAPTURED", labelHex(.captured), .captured, .{ .width = W, .tick = 3, .entry_tick = 0 }, "");
    try emitLine(.instrument_square, "THINKING", labelHex(.thinking), .thinking, .{ .width = W, .tick = 16, .entry_tick = 0, .seed = 9 }, "T+01.3");
    try emitLine(.instrument_square, "SPEAKING", labelHex(.speaking), .speaking, .{ .width = W, .tick = 13, .entry_tick = 0, .output_q = 3 }, "");
    try emitLine(.instrument_square, "ACTING", labelHex(.acting), .acting, .{ .width = W, .tick = 3, .entry_tick = 0, .progress = 0.52 }, "052%");
    try emitLine(.instrument_square, "WAITING", labelHex(.waiting), .waiting, .{ .width = W, .tick = 2, .entry_tick = 0, .seed = 3 }, "HOLD");
    try emitLine(.instrument_square, "NEEDS INPUT", labelHex(.needs_input), .needs_input, .{ .width = W, .tick = 5, .entry_tick = 0 }, "INPUT");
    try emitLine(.instrument_square, "COMPLETE", labelHex(.complete), .complete, .{ .width = W, .tick = 20, .entry_tick = 0 }, "DONE");

    try out.appendSlice(gpa, "RAILSPLIT\n");

    // panel 2: attention states
    try emitLine(.instrument_square, "INTERRUPTED", labelHex(.interrupted), .interrupted, .{ .width = W, .tick = 10, .entry_tick = 0 }, "CUT");
    try emitLine(.instrument_square, "ERROR", labelHex(.err), .err, .{ .width = W, .tick = 10, .entry_tick = 0, .seed = 5 }, "E03");

    try out.appendSlice(gpa, "RAILSPLIT\n");

    // panel 3: safe-block listening amplitude ladder
    const dim_lbl = aux_hex;
    try emitLine(.safe_block, "LEVEL 0", dim_lbl, .listening, .{ .width = W, .tick = 6, .entry_tick = 0, .input_q = 0 }, "");
    try emitLine(.safe_block, "LEVEL 1", dim_lbl, .listening, .{ .width = W, .tick = 6, .entry_tick = 0, .input_q = 1 }, "");
    try emitLine(.safe_block, "LEVEL 2", dim_lbl, .listening, .{ .width = W, .tick = 6, .entry_tick = 0, .input_q = 2 }, "");
    try emitLine(.safe_block, "LEVEL 3", dim_lbl, .listening, .{ .width = W, .tick = 6, .entry_tick = 0, .input_q = 3 }, "");
    try emitLine(.safe_block, "LEVEL 4", dim_lbl, .listening, .{ .width = W, .tick = 6, .entry_tick = 0, .input_q = 4 }, "");

    std.debug.print("{s}", .{out.items});
}
