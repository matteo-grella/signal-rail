# Signal Rail 1.0

## Normative TUI specification for the AI assistant status rail

Implement the horizontal status rail according to this specification.

The rail is the primary visual identity of the application. It is not a spinner, equalizer, waveform decoration, progress bar skin, or imitation of the KITT scanner. It is a state-display system with consistent spatial semantics, glyphs, colors, timing, transitions, and accessibility behavior.

The implementation must work entirely in a terminal. It must not require a browser, HTML, CSS, a canvas, or graphical assets.

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

---

# 1. Design objective

The rail should resemble a piece of dedicated electronic instrumentation from an older machine:

* segmented rather than fluid
* mechanical rather than organic
* directional rather than ambient
* restrained rather than constantly animated
* functional rather than decorative
* readable without color
* rectangular rather than circular
* deterministic rather than randomly generated

The user should eventually be able to identify the assistant state from the rail pattern without reading the state label.

Each state must have a distinct rule.

Examples:

* listening expands
* captured input collapses
* thinking reads
* speaking emits
* acting advances
* waiting freezes
* needs-input returns control toward the user
* warning pulses without moving
* error fractures
* interruption cuts movement off

Do not differentiate states only by changing color.

---

# 2. Component anatomy

The standard rail occupies one terminal row:

```text
THINKING    [───────▪■█──────────────]  T+01.8
```

It contains four regions:

```text
STATE LABEL    LEFT CAP    LOGICAL RAIL    RIGHT CAP    AUXILIARY VALUE
```

Example:

```text
ACTING      [████████████▐───────────]  052%
```

## 2.1 State label

The state label:

* MUST be uppercase
* MUST be visible in monochrome mode
* SHOULD use a fixed width of 12 terminal columns
* MUST NOT use an icon as the only state identifier
* MUST NOT blink
* SHOULD use the same semantic foreground color as the active rail cells

Canonical labels:

```text
IDLE
LISTENING
CAPTURED
THINKING
SPEAKING
ACTING
WAITING
NEEDS INPUT
COMPLETE
WARNING
ERROR
INTERRUPTED
```

Internally, the state may still be named `Success`, but the displayed label should be `COMPLETE`.

## 2.2 Caps

The default caps are:

```text
[
]
```

Use plain square brackets because they:

* render consistently
* remain one terminal cell wide
* have an industrial appearance
* work in ASCII mode
* do not imply rounded geometry

Caps use the frame color, not the active state color.

Do not use parentheses, rounded box characters, pill-shaped containers, or curved Unicode characters.

## 2.3 Logical rail

The logical rail is a sequence of fixed-width terminal cells.

Each logical segment occupies exactly one terminal column.

There are no spaces between logical segments.

A space character inside the rail represents a deliberate blackout, fracture, or absent electrical connection. It must not be used as the normal inactive track.

## 2.4 Auxiliary value

The suffix is optional and state-dependent.

Examples:

```text
T+01.8
042%
HOLD
INPUT
DONE
E03
```

The auxiliary value:

* SHOULD be right-aligned
* SHOULD use at most eight terminal columns
* MUST be hidden before the rail itself is reduced
* MUST NOT display invented precision
* MUST NOT display a percentage when actual progress is unavailable

For unknown progress, use:

```text
--
```

or:

```text
ACTIVE
```

Do not display fake values such as `67%` when the backend does not provide progress.

---

# 3. Rail geometry

## 3.1 Logical width

The rail width excludes:

* state label
* whitespace
* square brackets
* suffix

Recommended widths:

| Layout   | Logical cells |
| -------- | ------------: |
| Wide     |            61 |
| Standard |            49 |
| Compact  |            37 |
| Minimum  |            25 |

The default is 49 logical cells.

The implementation SHOULD select the largest preset that fits the available terminal width.

If a custom width is allowed, it MUST:

* be at least 17 cells
* preferably be odd
* be clamped to a safe maximum such as 97
* be measured using terminal display width, not UTF-8 byte count

An odd width is preferred because it provides an exact center cell.

## 3.2 Width calculation

A suggested calculation is:

```text
available = component_width
            - state_label_width
            - 1 space
            - 2 caps
            - optional_suffix_width
            - inter-region spacing

rail_width = largest supported odd width <= available
```

The rail MUST be preserved before diagnostics, timestamps, or suffix text.

Responsive priority:

1. Preserve the state label.
2. Preserve at least 25 rail cells.
3. Remove the suffix.
4. Shorten the label only when necessary.
5. Reduce the rail below 25 only as a final fallback.
6. Display a minimum-width warning only when the component cannot render meaningfully.

## 3.3 Cell-width validation

Every configured glyph MUST have a terminal display width of exactly one.

At startup, or when changing glyph profiles:

1. Measure each glyph with a Unicode terminal-width library.
2. Reject glyphs whose calculated width is not one.
3. Fall back to the safe block profile.
4. Fall back to ASCII if the safe block profile is also unavailable.

This is important for terminals or locales where geometric characters such as `■` may be treated as double-width.

Never assume that one Unicode scalar equals one terminal column.

---

# 4. Spatial semantics

The rail has three conceptual zones:

```text
INPUT          PROCESSING                 OUTPUT / ACTION
← 28% →        ← 44% →                    ← 28% →
```

For a rail of `N` cells:

```text
input_length      = round(N × 0.28)
processing_length = round(N × 0.44)
output_length     = N - input_length - processing_length
```

Correct rounding errors by adjusting the output zone.

For a 25-cell rail:

```text
INPUT       PROCESSING       OUTPUT
7 cells     11 cells         7 cells
```

For a 49-cell rail, an acceptable division is:

```text
INPUT       PROCESSING       OUTPUT
14 cells    21 cells         14 cells
```

The boundaries are logical and are not normally drawn.

A debug mode MAY show them using dim divider glyphs:

```text
──────│────────────────────│────────────
```

The production interface SHOULD hide zone dividers unless they are needed for diagnostic clarity.

## 4.1 Directional meaning

Normal information flow is:

```text
INPUT → PROCESSING → OUTPUT / ACTION
```

Therefore:

* listening activity occurs in the input zone
* captured input collapses inside the input zone
* thinking activity occurs primarily in the processing zone
* speaking activity originates at the output-zone boundary and moves right
* determinate action progress may use the entire rail
* success may traverse the entire rail

Rightward movement means forward processing or emission.

Leftward movement is reserved for explicit semantic reversal:

* the assistant is returning control to the user
* the assistant needs input
* an operation is being interrupted or retracted

Movement must not reverse direction merely for visual variety.

The thinking state must never perform a continuous left-right bounce.

---

# 5. Logical cell model

The animation system must generate logical rail cells independently of the TUI rendering library.

A suggested model is:

```rust
struct RailCell {
    level: Intensity,
    glyph_role: GlyphRole,
    color_role: ColorRole,
    emphasis: Emphasis,
}

enum Intensity {
    Off,
    Low,
    Medium,
    High,
    Peak,
}

enum GlyphRole {
    Track,
    Signal,
    HeadRight,
    HeadLeft,
    Boundary,
    HardBoundary,
    Fracture,
}

enum ColorRole {
    Track,
    Neutral,
    Input,
    Output,
    Success,
    Warning,
    Error,
}

enum Emphasis {
    Dim,
    Normal,
    Bright,
}
```

The logical model MUST NOT contain:

* ANSI escape sequences
* Ratatui `Span` objects
* preformatted strings
* terminal-specific color values
* assumptions about Unicode support

The renderer converts logical cells into glyphs and styles.

This separation is required so that:

* state logic is unit-testable
* ASCII and Unicode modes share the same state machine
* color modes can change without changing motion
* snapshot tests can operate on logical or rendered frames
* terminal resizing does not corrupt state progression

---

# 6. Glyph profiles

Provide at least three glyph profiles:

1. Instrument Square
2. Safe Block
3. ASCII

The user may choose a profile manually. Automatic mode should prefer Instrument Square when all glyphs are one column wide, then Safe Block, then ASCII.

---

# 7. Instrument Square profile

This is the preferred visual profile.

| Role              | Glyph | Unicode | Purpose                          |
| ----------------- | ----- | ------- | -------------------------------- |
| Track             | `─`   | U+2500  | Inactive electrical path         |
| Low signal        | `▪`   | U+25AA  | Low-intensity segment            |
| Medium signal     | `■`   | U+25A0  | Normal active segment            |
| High signal       | `█`   | U+2588  | High-energy or committed segment |
| Right-moving head | `▐`   | U+2590  | Leading edge moving right        |
| Left-moving head  | `▌`   | U+258C  | Leading edge moving left         |
| Boundary          | `│`   | U+2502  | Waiting or progress boundary     |
| Hard boundary     | `┃`   | U+2503  | Interruption or hard stop        |
| Fracture          | space | U+0020  | Broken connection or blackout    |
| Left cap          | `[`   | U+005B  | Rail enclosure                   |
| Right cap         | `]`   | U+005D  | Rail enclosure                   |

This profile provides a segmented-machine appearance without using circular symbols.

The geometric square characters `▪` and `■` must be width-checked. Some East Asian terminal configurations may render them as double-width.

---

# 8. Safe Block profile

Use this profile when geometric square glyphs are not reliably one column wide.

| Role              | Glyph |
| ----------------- | ----- |
| Track             | `─`   |
| Low signal        | `▂`   |
| Medium signal     | `▄`   |
| High signal       | `▆`   |
| Peak signal       | `█`   |
| Right-moving head | `▐`   |
| Left-moving head  | `▌`   |
| Boundary          | `│`   |
| Hard boundary     | `┃`   |
| Fracture          | space |
| Left cap          | `[`   |
| Right cap         | `]`   |

This profile uses box-drawing and block-element characters that are commonly supported by terminal fonts.

It is also useful for listening-state amplitude because the levels have visible vertical height.

---

# 9. ASCII profile

The ASCII profile must remain fully functional and must not merely display a generic progress bar.

| Role              | Character           |   |
| ----------------- | ------------------- | - |
| Track             | `-`                 |   |
| Low signal        | `.`                 |   |
| Medium signal     | `=`                 |   |
| High signal       | `#`                 |   |
| Peak signal       | `#` with bold style |   |
| Right-moving head | `>`                 |   |
| Left-moving head  | `<`                 |   |
| Boundary          | `                   | ` |
| Hard boundary     | `!`                 |   |
| Fracture          | space               |   |
| Left cap          | `[`                 |   |
| Right cap         | `]`                 |   |

Do not use `o`, `O`, `0`, parentheses, or other circular-looking characters.

In monochrome ASCII mode, intensity is communicated by:

```text
-  inactive
.  low activity
=  medium activity
#  high activity
>  rightward head
<  leftward head
|  soft boundary
!  hard stop
```

---

# 10. Background rendering

The default rail background should inherit the terminal background.

Recommended behavior:

```text
active cell background   = terminal default
inactive cell background = terminal default
cap background           = terminal default
label background         = terminal default
```

Active segments are drawn primarily through foreground glyphs.

Do not create a row of colored rectangular backgrounds for normal activity. This tends to produce a modern progress-bar appearance rather than an instrument display.

Background colors may be used only in tightly controlled cases:

* optional focused-component indication
* high-contrast accessibility theme
* one non-repeating error transition frame
* user-selected solid-segment theme

The default theme MUST NOT:

* continuously invert the rail
* flash the full terminal background
* alternate red and black backgrounds
* use gradients
* use per-cell RGB interpolation
* use transparency simulations

Reverse video SHOULD be disabled by default.

---

# 11. Recommended color system

The recommended theme is called `obsidian_instrument`.

It uses a nearly black background, warm neutral processing colors, amber input states, restrained green output states, and muted red only for problems.

## 11.1 True-color palette

| Role             | RGB hex   | Use                                         |
| ---------------- | --------- | ------------------------------------------- |
| Base background  | `#07090B` | Main terminal background when not inherited |
| Panel background | `#0B0E11` | Optional panel separation                   |
| Track            | `#30363B` | Inactive rail                               |
| Frame            | `#4A5157` | Caps, dividers, secondary labels            |
| Neutral dim      | `#7C807C` | Processing residue, inactive metadata       |
| Neutral          | `#C9C3B4` | Thinking and acting                         |
| Neutral hot      | `#F0EBDD` | Read head and active peak                   |
| Input dim        | `#72521F` | Listening trail                             |
| Input            | `#D49A32` | Listening and needs-input activity          |
| Input hot        | `#FFC75A` | Listening peak and captured input           |
| Output dim       | `#4F6652` | Speaking trail                              |
| Output           | `#8EAF8B` | Speaking activity                           |
| Output hot       | `#C6E1BB` | Speaking head                               |
| Success          | `#69B578` | Completion                                  |
| Success hot      | `#A8DBA9` | Completion sweep head                       |
| Warning          | `#D9772A` | Warning lattice                             |
| Warning hot      | `#F0A34A` | Warning pulse                               |
| Error            | `#B7403D` | Stable error pattern                        |
| Error hot        | `#EF655D` | Initial error event                         |
| Interrupted      | `#8E4542` | User cancellation                           |

Avoid pure red `#FF0000`. It is visually aggressive, closely associated with familiar scanner imagery, and generally too bright against a black terminal.

## 11.2 Suggested xterm-256 approximations

| Role             | Index |
| ---------------- | ----: |
| Base background  |   232 |
| Panel background |   233 |
| Track            |   238 |
| Frame            |   240 |
| Neutral dim      |   244 |
| Neutral          |   250 |
| Neutral hot      |   255 |
| Input dim        |    94 |
| Input            |   178 |
| Input hot        |   221 |
| Output dim       |    65 |
| Output           |   108 |
| Output hot       |   151 |
| Success          |    71 |
| Warning          |   166 |
| Warning hot      |   208 |
| Error            |   124 |
| Error hot        |   203 |

These values may be adjusted after testing in actual terminals, but the semantic separation must remain.

## 11.3 ANSI 16-color fallback

| Semantic role | ANSI color                     |
| ------------- | ------------------------------ |
| Track         | Bright Black / Dark Gray       |
| Frame         | Bright Black / Dark Gray       |
| Neutral dim   | Gray                           |
| Neutral       | White                          |
| Neutral hot   | Bright White or White + Bold   |
| Input         | Yellow                         |
| Input hot     | Bright Yellow or Yellow + Bold |
| Output        | Green                          |
| Output hot    | Bright Green or Green + Bold   |
| Success       | Green                          |
| Warning       | Yellow                         |
| Error         | Red                            |
| Error hot     | Bright Red or Red + Bold       |
| Interrupted   | Red                            |

Do not assume that the terminal distinguishes bright colors from bold text. Glyph shape must remain sufficient.

## 11.4 Monochrome behavior

When color is disabled:

* track cells use dim text when supported
* low and medium activity use normal weight
* high and peak activity use bold
* boundaries use their distinct glyphs
* state labels remain visible
* no state may become indistinguishable from another

Honor:

```text
NO_COLOR
```

An explicit user setting may override automatic color detection.

---

# 12. Optional theme presets

## 12.1 Amber terminal

All ordinary active states use amber levels.

```text
dim     #6F521D
normal  #C99432
hot     #FFD064
```

Success may use pale yellow-green:

```text
#B8C76A
```

Errors retain muted red.

This theme should resemble amber instrumentation, not a monochrome orange webpage.

## 12.2 Phosphor green

Ordinary active states use green phosphor colors:

```text
dim     #3E6443
normal  #78AD76
hot     #C0E8B8
```

Warnings remain amber and errors remain muted red.

## 12.3 Redline

This theme is optional and should not be the default.

Use dark, restrained reds:

```text
dim     #60302F
normal  #A94440
hot     #E16A62
```

Do not use red for every cell in every state. Even in this theme:

* inactive track remains gray
* success remains green or neutral white
* warning and error use different pattern grammar
* the thinking head must move in one direction rather than bouncing

---

# 13. Timing model

Use a monotonic clock.

The rail animation must not depend on wall-clock time or local time.

Recommended base tick:

```text
12 Hz
```

One tick is approximately:

```text
83.333 milliseconds
```

The application may render at a different refresh rate, but state frames must be calculated from elapsed monotonic time.

Suggested calculation:

```text
frame_index = floor(elapsed_milliseconds / frame_duration_milliseconds)
```

Animations must be deterministic for a given:

* state
* state entry time
* rail width
* input values
* animation seed
* motion mode

Do not use uncontrolled randomness.

A deterministic seed may be derived from:

* task identifier
* message identifier
* explicit demo seed

Do not derive the visual pattern from system random state on every frame.

## 13.1 Motion modes

Support three modes:

```text
NORMAL
REDUCED
OFF
```

### Normal

Uses all specified stepped movement.

### Reduced

* no continuous travel across the full rail
* heads update at reduced frequency
* listening amplitude remains quantized
* warning pulses change brightness rather than turning fully off
* success uses a two-frame confirmation instead of a sweep
* transitions complete using two or three discrete frames

### Off

* all states use static patterns
* no cell changes unless the semantic state or external value changes
* progress may still advance when the actual progress value changes
* the text state label remains authoritative

---

# 14. Input normalization

The rail may receive these external values:

```rust
struct RailInputs {
    input_level: Option<f32>,
    output_level: Option<f32>,
    progress: Option<f32>,
    queue_depth: Option<u32>,
    elapsed: Duration,
    task_seed: u64,
}
```

All numeric input must be sanitized.

For levels:

```text
valid range = 0.0 through 1.0
NaN         = 0.0
negative    = 0.0
above 1.0   = 1.0
```

Quantize audio-like levels into five values:

```text
0, 1, 2, 3, 4
```

Do not map input directly to dozens of smooth amplitude values.

Suggested quantization:

```text
0.00–0.09 → 0
0.10–0.29 → 1
0.30–0.49 → 2
0.50–0.74 → 3
0.75–1.00 → 4
```

Suggested stepped smoothing:

* amplitude may rise by at most two levels per tick
* amplitude may fall by at most one level per tick
* silence must settle to level zero
* avoid random idle jitter

This creates an electronic meter response rather than a fluid waveform.

---

# 15. Base track

Unless a state specifies a blackout or fracture, initialize every rail cell as:

```text
glyph role = Track
color role = Track
intensity  = Off
emphasis   = Dim
```

Default rendering:

```text
─────────────────────────────────────────────────
```

The track serves as the inactive electrical path.

Do not use a row of spaces as the normal track because:

* the rail width becomes unclear
* inactive and broken states become indistinguishable
* patterns float without structural context
* resizing appears unstable

---

# 16. State specification: IDLE

## Meaning

The assistant is available and not performing work.

## Spatial behavior

Place one stable marker at the center of the processing zone.

It does not scan.

## Pattern

Instrument Square:

```text
────────────■────────────
```

Safe Block:

```text
────────────▄────────────
```

ASCII:

```text
------------=------------
```

## Colors

```text
track   = Track
marker  = Neutral dim
label   = Neutral dim
```

## Timing

The default idle state has no animation.

An optional `idle_voltage_check` setting may brighten the marker for two ticks once every 12 seconds:

```text
■ → █ → ■
```

The marker must not change position.

This optional heartbeat should be disabled by default.

## Reduced motion

Same as normal.

## Animation-off mode

Same as normal.

## Prohibited behavior

IDLE must not:

* sweep from side to side
* pulse continuously
* display a breathing waveform
* fill and empty
* emit random cells
* use a rotating spinner beside the rail

---

# 17. State specification: LISTENING

## Meaning

The assistant is receiving operator input.

## Spatial behavior

Listening activity occurs only in the input zone.

Set the listening origin near the middle of the input zone:

```text
origin = floor(input_zone_length / 2)
```

Signal energy expands outward from this origin.

It must not occupy the full rail like a generic audio waveform.

## Pattern construction

For quantized amplitude `q`:

```text
radius = min(input_zone_radius, q + 1)
```

For each distance `d` from the origin:

```text
level = clamp(q + 1 - d, 1, 4)
```

Cells outside the active radius remain track cells.

Example progression:

```text
Level 0: ───▄─────────────────────
Level 1: ──▂▄▂────────────────────
Level 2: ─▂▄▆▄▂───────────────────
Level 3: ▂▄▆█▆▄▂──────────────────
Level 4: ▄▆████▆▄─────────────────
```

The exact pattern should be adjusted to fit the input-zone width.

## Glyph behavior

The Safe Block glyph levels are particularly suitable:

```text
low     ▂
medium  ▄
high    ▆
peak    █
```

For Instrument Square:

```text
low     ▪
medium  ■
high    █
peak    █ with bright emphasis
```

## Colors

```text
trail   = Input dim
body    = Input
peak    = Input hot
label   = Input
track   = Track
```

## Timing

* update amplitude at the base tick
* use quantized levels
* do not interpolate cell colors
* do not move the origin randomly
* do not add artificial activity when input level is zero

## Reduced motion

Update only when the quantized input level changes.

## Animation-off mode

Display a static input marker:

```text
───■─────────────────────
```

The label still reads `LISTENING`.

---

# 18. State specification: CAPTURED

## Meaning

Input has ended and has been committed for processing.

This state is transitional but semantically visible.

## Spatial behavior

The final listening shape collapses toward the listening origin.

## Duration

Recommended:

```text
4 ticks
approximately 333 milliseconds
```

## Frame behavior

Given a frozen listening pattern:

### Frame 0

Hold the final listening pattern.

```text
▂▄▆█▆▄▂──────────────────
```

### Frame 1

Move each active cell halfway toward the origin.

```text
──▄███▄──────────────────
```

### Frame 2

Collapse into a compact block.

```text
───██────────────────────
```

### Frame 3

Brighten the compact block and prepare the handoff.

```text
───██────────────────────
```

The final frame uses `Input hot`.

When multiple cells collapse into one position, retain the highest intensity rather than adding brightness numerically.

## Colors

```text
collapse body = Input
final block   = Input hot
```

## Transition destination

The normal destination is `THINKING`.

Cancellation may instead transition to `INTERRUPTED`.

## Reduced motion

Use two frames:

```text
final listening shape
compact captured block
```

## Animation-off mode

Display only the compact captured block for the configured captured duration.

---

# 19. State specification: THINKING

## Meaning

The assistant is analyzing, reasoning, planning, searching internally, or generating a response.

## Spatial behavior

Thinking occurs primarily in the processing zone.

A read head moves from the left boundary of the processing zone toward the right boundary.

It never bounces back.

At the end of a pass:

1. dim the processing field for one tick
2. generate a new deterministic field pattern
3. restart from the left

## Field pattern

Populate the processing zone with a sparse, structured arrangement of low and medium cells.

Example:

```text
───────▪──■─▪──■──▪───────
```

The field must not look like random television noise.

A deterministic pattern generator may use:

```text
hash(task_seed, pass_index, cell_index)
```

Suggested density:

* 45–65% track cells
* 20–35% low cells
* 10–20% medium cells
* no peak cells except the read head

Avoid identical spacing across every pass.

## Read head

The read head:

* starts at the left edge of the processing zone
* moves one logical cell every two ticks
* uses the right-moving head glyph
* uses `Neutral hot`
* may leave a two-cell intensity trail

Suggested trail:

```text
▪ ■ ▐
```

ASCII:

```text
. = >
```

Example frames:

```text
───────▐▪─■──▪─■──────────
────────■▐─■──▪─■─────────
────────▪■▐───▪─■─────────
```

## Colors

```text
field low     = Neutral dim
field medium  = Neutral
trail         = Neutral
head          = Neutral hot
label         = Neutral
track         = Track
```

## Timing

Recommended head speed:

```text
6 cells per second
```

At 12 Hz, advance one cell every two ticks.

The field itself remains fixed during a pass.

Do not regenerate every cell on every frame.

## Optional captured residue

For the first six ticks of THINKING, a dim input marker may remain in the input zone and then disappear.

This creates continuity between captured input and processing.

## Reduced motion

* show a static processing field
* move the head only once every 500 milliseconds
* do not animate the trail

## Animation-off mode

Display a static processing field with a bright head near the center:

```text
───────▪─■─▐─▪─■──────────
```

## Prohibited behavior

THINKING must not:

* bounce continuously left and right
* use a red scanner by default
* animate the entire rail
* use a generic spinner
* display a full-width waveform
* change colors randomly
* use smooth sub-cell movement

---

# 20. State specification: SPEAKING

## Meaning

The assistant is emitting a response.

This may represent:

* synthesized speech
* streamed text output
* another outward communication channel

## Spatial behavior

Speaking activity occurs in the output zone.

Packets originate at the left boundary of the output zone and travel right.

This makes speaking visually different from listening:

```text
LISTENING = localized expansion
SPEAKING  = directional packet emission
```

## Packet model

A packet is a short group of cells with the head on the right.

Suggested shapes:

```text
Level 0: ▐
Level 1: ▂▐
Level 2: ▂▄▐
Level 3: ▂▄▆▐
Level 4: ▄▆█▐
```

Instrument Square equivalent:

```text
Level 0: ▐
Level 1: ▪▐
Level 2: ▪■▐
Level 3: ▪■█▐
Level 4: ■██▐
```

Packets:

* move right one cell per tick
* disappear when they leave the output zone
* must not reverse
* may overlap by retaining the highest intensity in each cell
* should be limited to three simultaneous packets

## Packet spawn rate

Quantized output activity controls spawn frequency.

Suggested periods:

| Output level |                           Spawn period |
| -----------: | -------------------------------------: |
|            0 | no packet or one marker every 12 ticks |
|            1 |                          every 8 ticks |
|            2 |                          every 6 ticks |
|            3 |                          every 4 ticks |
|            4 |                          every 3 ticks |

Do not use raw audio samples to create a full-width waveform.

## Colors

```text
trail   = Output dim
body    = Output
head    = Output hot
label   = Output
track   = Track
```

## Reduced motion

Show one output packet at a fixed position. Update its intensity only when the quantized output level changes.

## Animation-off mode

Display:

```text
──────────────────■▐─────
```

---

# 21. State specification: ACTING

## Meaning

The assistant is executing a tool, command, automation, external operation, or system action.

ACTING supports two modes:

```text
DETERMINATE
INDETERMINATE
```

## 21.1 Determinate action

Use actual progress provided by the backend.

Normalize:

```text
progress = clamp(progress, 0.0, 1.0)
```

Calculate:

```text
committed_cells = floor(progress × rail_width)
```

Render:

* committed cells as high or medium neutral signal
* the next cell as the right-moving head
* remaining cells as track

Recommended pattern:

```text
████████████▐────────────
```

To avoid excessive brightness, the committed portion may use `■` or `▆`, while the head uses `█` or `▐`.

Suggested styling:

```text
committed = Neutral
head      = Neutral hot
remaining = Track
```

Display the real percentage in the suffix:

```text
052%
```

Progress should not move backward unless:

* the backend explicitly reports a reset
* the task identifier changes
* the operation starts a new phase that is clearly labeled

For minor backend fluctuations, retain the maximum observed progress.

At 100%, transition to `COMPLETE`.

## 21.2 Indeterminate action

Do not fake cumulative progress.

Instead, show a bounded work packet moving through the processing and output zones.

Suggested packet:

```text
▪■█▐
```

ASCII:

```text
.=#>
```

Behavior:

1. Start at the processing-zone boundary.
2. Move right one cell per tick.
3. Exit the output zone.
4. Show a two-tick empty pause.
5. Restart at the processing-zone boundary.
6. Never bounce left.

Suffix:

```text
--
```

or:

```text
ACTIVE
```

Do not display a percentage.

## Colors

```text
body  = Neutral
head  = Neutral hot
label = Neutral
```

The active tool name should appear elsewhere in the diagnostics panel rather than being encoded into rail color.

## Reduced motion

Determinate progress updates only when its value changes.

Indeterminate progress uses three static phases:

```text
processing zone
processing/output boundary
output zone
```

Advance no faster than once every 500 milliseconds.

## Animation-off mode

Determinate progress remains visible.

Indeterminate action displays a static work block at the processing/output boundary.

---

# 22. State specification: WAITING

## Meaning

The assistant is blocked while waiting for:

* an external tool
* a network response
* a subprocess
* a user confirmation
* a system dependency

## Spatial behavior

WAITING preserves the final visible frame of the previous active state.

All movement stops.

A boundary marker is inserted at the point where progress stopped.

Preferred glyph:

```text
│
```

Example:

```text
██████████████│──────────
```

For a harder external lock, use:

```text
┃
```

only when the distinction is meaningful.

## Boundary position

For determinate action:

```text
boundary = committed_cells
```

For indeterminate action:

```text
boundary = current packet head
```

For waiting without previous progress:

```text
boundary = processing/output zone boundary
```

## Pulse behavior

Only the boundary marker changes emphasis.

Suggested cycle:

```text
300 ms bright
600 ms normal
```

The rest of the rail remains frozen.

Do not blink the entire completed section.

## Colors

```text
preserved cells = previous colors, optionally dimmed
boundary        = Input / amber
label           = Input / amber
track           = Track
```

## Reduced motion

The boundary alternates between normal and bold once per second.

## Animation-off mode

The boundary remains static.

---

# 23. State specification: NEEDS INPUT

## Meaning

The assistant requires information, confirmation, selection, permission, or another user action.

## Spatial behavior

This is a semantic return of control toward the input zone.

It is one of the few states allowed to imply leftward movement.

Use two markers:

* one in the processing zone
* one in the input zone

Alternate their intensity to show that control is being handed back to the operator.

Example phase A:

```text
───■──────▪──────────────
```

Example phase B:

```text
───▪──────■──────────────
```

An optional three-phase sequence may move the processing marker one or two cells left before brightening the input marker.

Do not animate a full scanner moving repeatedly between the two points.

## Timing

Suggested cycle:

```text
phase A  300 ms
phase B  300 ms
pause    600 ms
```

The pause prevents constant visual activity.

## Colors

```text
input marker       = Input hot when active
processing marker  = Input dim or Input
label              = Input
track              = Track
```

Suffix:

```text
INPUT
```

## Reduced motion

Display both markers statically, with the input marker brighter.

## Animation-off mode

Same as reduced motion.

---

# 24. State specification: COMPLETE

## Meaning

The current task completed successfully.

## Entry animation

Perform one rightward confirmation sweep across the full rail.

The sweep must occur once.

It must not loop.

Suggested duration:

```text
500–700 milliseconds
```

The head should advance multiple cells per tick so that wide rails do not take several seconds.

Suggested speed:

```text
ceil(rail_width / 7) cells per tick
```

Cells behind the head become committed success cells.

Example:

```text
■■■■■■■■■■▐──────────────
```

Then:

```text
■■■■■■■■■■■■■■■■■■■■■■■■■
```

## Settled pattern

After the sweep, show a medium-intensity completed rail for approximately:

```text
700–1200 milliseconds
```

Do not keep the full rail at peak brightness.

Recommended settled glyph:

```text
■
```

or:

```text
▄
```

not full `█` in every cell.

## Colors

```text
committed cells = Success
head            = Success hot
label           = Success
```

Suffix:

```text
DONE
```

## Exit

Transition to IDLE after the configured completion-display duration.

## Reduced motion

Use two frames:

```text
partial confirmation
complete settled rail
```

## Animation-off mode

Display the settled complete rail for the configured duration.

---

# 25. State specification: WARNING

## Meaning

The current operation can continue, but attention is required.

WARNING is not necessarily a terminal failure.

## Pattern geometry

Use a fixed lattice.

The geometry does not move.

Instrument Square:

```text
█──█──█──█──█──█──█──█
```

ASCII:

```text
#--#--#--#--#--#--#--#
```

Adjust the final spacing to fill the rail width.

## Pulse rhythm

Use a double-pulse pattern:

```text
150 ms bright
150 ms normal
150 ms bright
950 ms normal
repeat
```

Normal means the lattice remains visible in the warning base color. It does not disappear completely.

The rail must not produce high-frequency flashing.

## Colors

For ordinary warnings:

```text
normal = Warning
bright = Warning hot
```

Do not use error red for all warnings.

## State preservation

The state machine should store the interrupted or underlying state so that the application can resume after the warning is acknowledged or dismissed.

Suggested fields:

```rust
previous_state: Option<RailState>
warning_code: Option<String>
```

## Reduced motion

The fixed lattice alternates between normal and bold once per cycle.

## Animation-off mode

Display the fixed warning lattice without pulsing.

## Prohibited behavior

WARNING must not:

* scan
* fill like progress
* alternate full red and black frames
* flash the terminal background
* use more than two bright events per cycle

---

# 26. State specification: ERROR

## Meaning

The current operation failed.

## Entry sequence

ERROR has a one-time entry sequence.

### Phase 1: electrical saturation

Duration:

```text
2 ticks
```

Pattern:

```text
█████████████████████████
```

Color:

```text
Error hot
```

### Phase 2: blackout

Duration:

```text
1 tick
```

Pattern:

```text
                         
```

The caps and state label remain visible.

### Phase 3: fractured settled state

Pattern example:

```text
██████  ██   ████  ████  
```

ASCII:

```text
######--##---####--####--
```

In Unicode mode, fractures are real spaces, not track glyphs.

The pattern must look electrically interrupted rather than like incomplete progress.

Generate fracture locations deterministically from the error code or task seed.

Requirements:

* at least two fractures
* no fracture at every cell
* at least one visible signal group
* no repeated animation after settling

## Colors

```text
entry saturation = Error hot
settled groups    = Error
label             = Error hot or Error
track             = Track where track is intentionally present
fractures         = terminal background
```

Suffix may display a short error code:

```text
E03
```

Do not display a long error message inside the rail row.

## Exit

The settled error state remains until:

* the user acknowledges it
* the application starts a new operation
* the user clears the transcript
* an explicit timeout policy is configured

Errors should not disappear immediately.

## Reduced motion

Skip saturation. Use:

```text
one blackout frame
settled fractured state
```

## Animation-off mode

Display only the settled fractured state.

---

# 27. State specification: INTERRUPTED

## Meaning

The operator cancelled or interrupted an active operation.

## Entry behavior

Movement stops immediately.

The current frame is captured.

Active cells retract toward the nearest left semantic boundary:

* output activity retracts toward the processing/output boundary
* processing activity retracts toward the input/processing boundary
* full action progress retracts toward the left edge

Duration:

```text
3–4 ticks
```

After retraction, place a hard boundary at the interruption point:

```text
┃
```

Example:

```text
██████┃──────────────────
```

ASCII:

```text
######!------------------
```

The hard boundary remains visible for approximately:

```text
500–800 milliseconds
```

Then transition to IDLE.

## Colors

```text
residual cells = Interrupted
hard boundary  = Error or Interrupted, bright
label          = Interrupted
```

## Reduced motion

Immediately replace the active pattern with the hard-cut pattern.

## Animation-off mode

Same as reduced motion.

## Distinction from ERROR

INTERRUPTED:

* is caused by cancellation
* retracts
* shows a hard cut
* returns to idle automatically

ERROR:

* is caused by failure
* saturates and fractures
* remains until acknowledged

---

# 28. Transition grammar

Transitions are first-class state-machine behavior.

Do not instantly replace one unrelated pattern with another unless the specification explicitly permits it.

Suggested transition table:

| From             | To             |         Duration | Visual rule                                            |
| ---------------- | -------------- | ---------------: | ------------------------------------------------------ |
| IDLE             | LISTENING      |           1 tick | Input marker activates                                 |
| LISTENING        | CAPTURED       |          4 ticks | Input field collapses                                  |
| CAPTURED         | THINKING       |          3 ticks | Compact token moves to processing boundary             |
| THINKING         | SPEAKING       |          2 ticks | Read head exits processing; first output packet begins |
| THINKING         | ACTING         |          2 ticks | Read head becomes action head                          |
| ACTING           | WAITING        |           1 tick | Freeze and insert boundary                             |
| WAITING          | ACTING         |          2 ticks | Boundary dims; action resumes                          |
| NEEDS INPUT      | LISTENING      |           1 tick | Input marker becomes listening origin                  |
| Any active state | WARNING        |           1 tick | Preserve previous state; apply fixed warning state     |
| WARNING          | Previous state |           1 tick | Restore stored state                                   |
| Any active state | ERROR          |          3 ticks | Saturate, blackout, fracture                           |
| Any active state | INTERRUPTED    |        3–4 ticks | Stop, retract, cut                                     |
| ACTING           | COMPLETE       |        7–9 ticks | One confirmation sweep                                 |
| SPEAKING         | COMPLETE       |        7–9 ticks | One confirmation sweep                                 |
| COMPLETE         | IDLE           | configured delay | Completed rail clears to center marker                 |
| ERROR            | IDLE           |  acknowledgement | Fracture clears, center marker appears                 |

## 28.1 Captured-to-thinking handoff

The compact captured token should move right from the input origin to the left edge of the processing zone.

Use exactly three discrete positions:

```text
input origin
input/processing boundary
processing start
```

Do not animate every intermediate cell.

This keeps the transition mechanical and brief.

## 28.2 Thinking-to-speaking handoff

The processing read head reaches or is placed at the processing/output boundary.

The next frame creates the first speaking packet inside the output zone.

This makes the relationship visible:

```text
processed information becomes output
```

## 28.3 Complete-to-idle handoff

Do not erase the complete rail in one frame.

Suggested sequence:

```text
full medium success rail
success rail divided into three large groups
center processing marker
idle
```

Total duration should remain under approximately 500 milliseconds.

---

# 29. Transition interruptibility

Every transition should declare whether it is interruptible.

Recommended rules:

| Transition           | Interruptible                                 |
| -------------------- | --------------------------------------------- |
| IDLE → LISTENING     | Yes                                           |
| LISTENING → CAPTURED | Yes                                           |
| CAPTURED → THINKING  | Yes                                           |
| THINKING → SPEAKING  | Yes                                           |
| THINKING → ACTING    | Yes                                           |
| ACTING → WAITING     | Yes                                           |
| WAITING → ACTING     | Yes                                           |
| Any → INTERRUPTED    | No, once interruption starts                  |
| Any → ERROR          | No, during the initial error entry sequence   |
| Any → COMPLETE       | Yes during sweep, if a late error is reported |
| COMPLETE → IDLE      | Yes                                           |

A higher-priority failure may replace a success transition before completion.

Priority order:

```text
ERROR
INTERRUPTED
WARNING
NEEDS INPUT
WAITING
ACTING / THINKING / SPEAKING
COMPLETE
IDLE
```

This priority list should be documented in the state machine.

---

# 30. State overlays versus primary states

The implementation may use either:

1. a flat state machine, or
2. a primary state plus an attention overlay

The preferred model is:

```rust
struct RailStatus {
    primary: PrimaryState,
    attention: Option<AttentionState>,
}
```

Example:

```rust
enum PrimaryState {
    Idle,
    Listening,
    Captured,
    Thinking,
    Speaking,
    Acting,
    Waiting,
    NeedsInput,
    Complete,
}

enum AttentionState {
    Warning,
    Error,
    Interrupted,
}
```

However, ERROR and INTERRUPTED should take full visual control during their entry sequences.

WARNING may temporarily preserve the underlying state for later restoration.

Do not render two unrelated animations simultaneously.

---

# 31. Focus and interaction behavior

The rail itself is normally non-interactive.

It must not appear as a button.

When the containing panel has keyboard focus:

* the caps may use the focus color
* the state label may become bold
* the rail animation and state color must remain unchanged
* do not add a glowing background
* do not add a cursor inside the rail

When diagnostics mode allows inspecting the rail:

* show logical cell indices below it
* show zone boundaries
* show current state
* show frame number
* show elapsed state time
* show normalized input values
* show current glyph and color profile

Diagnostic indices may appear as:

```text
0000000000111111111122222
0123456789012345678901234
```

This mode is for development only.

---

# 32. Terminal capability detection

Detect or configure:

* true-color support
* 256-color support
* 16-color support
* monochrome mode
* Unicode support
* terminal width
* reduced-motion preference
* `NO_COLOR`

A reasonable color-selection order:

```text
explicit user configuration
NO_COLOR
true color
256 color
16 color
monochrome
```

A reasonable glyph-selection order:

```text
explicit user configuration
Instrument Square when all glyph widths equal one
Safe Block when all glyph widths equal one
ASCII
```

Do not infer advanced terminal support solely from one environment variable.

Terminal detection may be imperfect. Configuration must always allow manual override.

---

# 33. Resizing behavior

When the terminal is resized:

1. Recalculate the logical rail width.
2. Preserve the semantic state.
3. Preserve normalized progress.
4. Preserve normalized head position within its zone.
5. Regenerate the logical frame at the new width.
6. Do not copy or truncate an old rendered string directly.

Example:

```text
normalized_head_position =
    old_head_index / max(old_zone_length - 1, 1)
```

Then:

```text
new_head_index =
    round(normalized_head_position × (new_zone_length - 1))
```

For deterministic thinking fields, regenerate using the same seed and pass index.

Resize must not:

* panic
* move progress backward substantially
* duplicate caps
* produce double-width overflow
* leave stale characters at the previous width

---

# 34. Performance rules

The rail must not force the entire application to redraw at maximum speed when static.

Recommended behavior:

* IDLE with heartbeat disabled: redraw only on external changes
* WAITING: redraw only when the boundary emphasis changes
* ERROR settled: no animation redraws
* animation-off mode: redraw only on state or data changes
* active movement: render at the configured tick rate

The event loop must not block while rendering.

Do not create a separate thread per rail state.

Use one application animation clock.

---

# 35. Accessibility rules

The component must remain understandable when:

* colors are unavailable
* motion is disabled
* the terminal supports only ASCII
* the terminal uses a high-contrast theme
* the user cannot distinguish red from green

Requirements:

* persistent text state label
* unique glyph pattern per state
* unique movement rule per state
* no state conveyed only through hue
* no rapid full-field flashing
* no continuously pulsing idle state
* warning and error must have different geometry
* complete and error must not differ only by green versus red
* focus must not be indicated only by color
* reduced-motion and animation-off settings must be available from configuration and keyboard controls

Suggested keyboard control:

```text
F4    cycle NORMAL → REDUCED → OFF
```

---

# 36. Configuration

Suggested TOML structure:

```toml
[status_rail]
enabled = true
width = 49
glyph_profile = "auto"
color_profile = "auto"
theme = "obsidian_instrument"
tick_hz = 12
motion = "normal"
show_state_label = true
show_auxiliary_value = true
show_caps = true
idle_voltage_check = false
debug_zones = false
```

Allowed glyph profiles:

```text
auto
instrument_square
safe_block
ascii
```

Allowed color profiles:

```text
auto
truecolor
xterm256
ansi16
monochrome
```

Allowed motion modes:

```text
normal
reduced
off
```

Invalid values must produce a readable warning and use safe defaults.

---

# 37. Suggested Rust API

The exact code may differ, but maintain equivalent separation.

```rust
pub enum RailState {
    Idle,
    Listening,
    Captured,
    Thinking,
    Speaking,
    Acting {
        progress: Option<f32>,
    },
    Waiting,
    NeedsInput,
    Complete,
    Warning,
    Error {
        code: Option<String>,
    },
    Interrupted,
}

pub enum MotionMode {
    Normal,
    Reduced,
    Off,
}

pub enum GlyphProfile {
    InstrumentSquare,
    SafeBlock,
    Ascii,
}

pub enum ColorProfile {
    TrueColor,
    Xterm256,
    Ansi16,
    Monochrome,
}

pub struct RailContext {
    pub width: usize,
    pub elapsed: Duration,
    pub tick: u64,
    pub input_level: f32,
    pub output_level: f32,
    pub progress: Option<f32>,
    pub seed: u64,
    pub motion: MotionMode,
}

pub struct RailFrame {
    pub label: String,
    pub cells: Vec<RailCell>,
    pub suffix: Option<String>,
}
```

Primary interface:

```rust
pub trait RailGenerator {
    fn frame(
        &self,
        state: &RailState,
        context: &RailContext,
    ) -> RailFrame;
}
```

Rendering interface:

```rust
pub trait RailRenderer {
    fn render(
        &self,
        frame: &RailFrame,
        glyphs: &GlyphSet,
        theme: &RailTheme,
    ) -> Vec<StyledCell>;
}
```

The state generator must not import Ratatui.

The Ratatui widget consumes `StyledCell` or converts the frame into spans.

---

# 38. Reference rendering pipeline

Use this order:

```text
1. Determine terminal capabilities.
2. Select glyph profile.
3. Select color profile.
4. Calculate logical width.
5. Calculate zone ranges.
6. Create base track cells.
7. Generate the current primary-state pattern.
8. Apply transition behavior.
9. Apply attention state when relevant.
10. Assign semantic color roles.
11. Map logical roles to actual glyphs.
12. Map semantic colors to terminal colors.
13. Add label, caps, and suffix.
14. Verify final terminal display width.
15. Render.
```

Never add ANSI escape sequences before calculating display width.

---

# 39. Exact ASCII snapshot fixtures

Use a 25-cell rail for deterministic snapshot tests.

Glyph mapping:

```text
track          -
low            .
medium         =
high           #
right head     >
left head      <
boundary       |
hard boundary  !
fracture       space
```

Every fixture below is exactly 25 logical cells.

## IDLE

```text
------------=------------
```

## LISTENING

```text
.=###=.------------------
```

## CAPTURED

```text
--##---------------------
```

## THINKING, frame A

```text
------->..=..=..=.-------
```

## THINKING, frame B

```text
-------.>..=..=...-------
```

## SPEAKING

```text
------------------>#=----
```

## ACTING, determinate

```text
##############>----------
```

## WAITING

```text
##############|----------
```

## NEEDS INPUT

```text
---=------=--------------
```

## COMPLETE, settled

```text
=========================
```

## WARNING

```text
#--#--#--#--#--#--#--#--#
```

## ERROR, settled

```text
######--##---####--####--
```

For the actual error fixture, replace selected `-` groups with spaces when testing the Unicode-style fracture model separately.

## INTERRUPTED

```text
######!------------------
```

Tests must assert terminal display width, not only string byte length.

---

# 40. Required unit tests

Add tests for:

## Geometry

* preset-width selection
* odd-width preference
* minimum width
* zone lengths sum to rail width
* valid boundaries for 17, 25, 37, 49, and 61 cells
* no rendered frame exceeds its allocated terminal width

## Glyphs

* every glyph has display width one
* automatic fallback from Instrument Square to Safe Block
* automatic fallback from Safe Block to ASCII
* caps remain ASCII square brackets
* no circular glyphs appear in the default profiles

## IDLE

* center marker is stable
* no movement when heartbeat is disabled
* heartbeat does not change position
* animation-off output is stable

## LISTENING

* activity remains in the input zone
* amplitude is clamped
* amplitude is quantized
* zero input creates no artificial waveform
* attack and release follow stepped limits
* reduced motion updates only on quantized changes

## CAPTURED

* final listening frame is frozen
* active cells collapse toward the origin
* the state completes after the expected ticks
* destination is THINKING unless interrupted

## THINKING

* read head remains in the processing zone
* read head never moves left during a pass
* wrap creates a new deterministic field
* identical seed and frame produce identical output
* different pass indices may produce different field patterns
* field density remains within configured limits
* output and input zones remain mostly inactive

## SPEAKING

* packets originate in the output zone
* packets move only right
* packet count is limited
* packets disappear at the rail edge
* packet frequency follows quantized output level
* listening and speaking produce structurally different patterns

## ACTING

* progress is clamped
* real progress maps to the correct cell count
* progress does not regress accidentally
* indeterminate action shows no percentage
* indeterminate head never bounces
* 100% transitions to COMPLETE

## WAITING

* previous frame is preserved
* movement stops
* one boundary is visible
* only boundary emphasis changes
* no full-rail blinking occurs

## NEEDS INPUT

* input and processing markers are both present
* input marker becomes visually dominant
* no full-width scanner is used
* reduced-motion frame remains understandable

## COMPLETE

* confirmation sweep occurs once
* sweep duration is bounded
* settled pattern uses medium rather than peak intensity
* state transitions to IDLE after the configured delay

## WARNING

* lattice geometry remains fixed
* exactly two bright pulses occur per cycle
* normal phase remains visible
* warning does not use scanning movement
* underlying state can be restored

## ERROR

* entry saturation occurs once
* blackout occurs once
* settled state contains deterministic fractures
* settled state does not animate indefinitely
* error remains visible until acknowledgement

## INTERRUPTED

* movement stops immediately
* active cells retract left
* hard boundary is displayed
* state returns to IDLE after the hold duration

## Accessibility

* every state has a distinct monochrome pattern
* every state has a visible text label
* animation-off frames remain distinct
* warning and error are distinguishable without color
* complete and error are distinguishable without color
* `NO_COLOR` selects monochrome unless explicitly overridden

## Resize

* state semantics survive resizing
* progress remains approximately normalized
* thinking head remains in the processing zone
* speaking packets remain in the output zone
* no stale characters remain after shrink
* no panic occurs during repeated resize events

---

# 41. Golden-frame tests

Create golden tests for at least:

```text
IDLE
LISTENING at levels 0–4
CAPTURED at every transition frame
THINKING at start, middle, end, and wrap
SPEAKING with one and three packets
ACTING at 0%, 1%, 50%, 99%, and 100%
ACTING with unknown progress
WAITING after determinate action
WAITING after indeterminate action
NEEDS INPUT at every phase
COMPLETE at start, middle, and settled
WARNING bright and normal phases
ERROR saturation, blackout, and settled phases
INTERRUPTED before, during, and after retraction
```

Run these tests for:

```text
25 cells
49 cells
ASCII
Safe Block Unicode
monochrome
normal motion
reduced motion
animation off
```

Golden tests must use injected elapsed time.

Do not sleep during tests.

---

# 42. Visual quality requirements

The rail is acceptable only when:

* all states are recognizable from motion and geometry
* no state depends on color alone
* inactive track is visible but subdued
* the rail does not dominate the conversation text
* peak cells are used sparingly
* the terminal remains responsive
* the rail remains stable during input
* motion appears stepped rather than smooth
* state changes appear intentional
* the same visual rule is used consistently every time a state occurs

The rail should look like an instrument that reports machine state, not a decorative animation added after the interface was built.

---

# 43. Explicit anti-patterns

Do not implement any of the following:

```text
A permanent red light bouncing left and right
A circular spinner placed beside the rail
A full-width audio waveform for every state
Randomized equalizer columns
Smooth RGB color interpolation
Rainbow state colors
Rounded boxes
Pill-shaped status indicators
Continuous idle breathing
Full-screen warning flashes
Repeated error flashing
Fake progress percentages
Progress that moves backward for visual effect
Particles or spark effects
Uncontrolled random noise
Background gradients
Emoji state icons
A state distinguished only by hue
Identical movement for listening and speaking
Identical patterns for warning and error
```

---

# 44. Required implementation notes

Document these decisions in the code:

* selected logical width
* zone ratios
* base tick rate
* glyph fallback order
* color fallback order
* state priority
* transition durations
* motion-mode behavior
* deterministic seed behavior
* error acknowledgement behavior
* unknown-progress behavior

Do not bury these values as unexplained numeric literals.

Use named constants or configuration values.

---

# 45. Completion criteria

The rail implementation is complete when:

1. Every specified state is implemented.
2. Every state has normal, reduced, and animation-off behavior.
3. Unicode and ASCII profiles work.
4. True-color, 256-color, 16-color, and monochrome modes work.
5. State transitions are explicit and deterministic.
6. Tests do not depend on real time.
7. Resize behavior is safe.
8. No generic spinner is used.
9. No continuous bidirectional scanner is used.
10. The rail remains understandable without color.
11. The application restores the terminal correctly after exit or panic.
12. The README documents the grammar with text captures.
13. The demo mode allows manually selecting every state and advancing one frame at a time.
14. Formatting, linting, tests, and release compilation succeed.

When reporting implementation completion, include:

* glyph profiles implemented
* palettes implemented
* state and transition coverage
* accessibility modes
* test coverage
* deliberate deviations
* terminal-specific limitations discovered during testing
