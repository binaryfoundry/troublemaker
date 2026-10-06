# Lessons from producing a track end to end

These come from building "Cowgirl, but melodic techno": a 256-bar, 127 BPM track in G minor,
produced with the bridge and mastered against Underworld's *Cowgirl*. Each lesson says what went
wrong or worked, and what to do next time. Read it before producing or mixing a track.

## Working with the person

- **They may not be able to hear the low end.** The user monitored on headphones without studio
  monitors. A 49 Hz sine bass was inaudible to them and was taken for a mix fault. So set the sub
  and the kick/bass balance by measurement and report numbers. Also give every bass part overtones
  above about 100 Hz (a saw, a triangle or saturation), so the line can be followed on any speakers.
- **Say so before playing anything**, and say for how long. Do not drive the transport otherwise.
- **The user saves; the API cannot.** Before force-quitting Live, check the window title: a `*`
  means unsaved changes. Renders come from the user's File → Export Audio/Video.
- **Check before diagnosing.** A full-track capture came back 49 s short, and it was diagnosed as
  dropouts. In fact the user had stopped it. Ask, or check whether the stop came from outside,
  before building a theory.
- **Translate complaints into measurements.** Each complaint mapped to a number:

  | Complaint | Measurement |
  |---|---|
  | "Clap too loud" | Soloed, the clap was 3.4 LU *above* the kick |
  | "Can't hear the bass" | It sat 14 dB under the kick at 60–250 Hz |
  | "Messy" | 195 hits a few ms apart per 16 bars |
  | "Tripping at phrase ends" | Clap flams 30 ms apart, open hats moved off their offbeats |

## Live and the bridge

**The transport**

- `live.play` is `start_playing`, which jumps to the start marker. To play from a beat, call
  `set_song_time` and then `continue_playing`.
- `continue_playing` takes effect on Live's next tick. Launching a recording slot first started
  the transport from the top, so captures recorded the intro. `master.capture` now waits until the
  transport really runs from `start_beat` (commit `ae02329`). Before trusting a comparison between
  captures, make sure they recorded the same place.

**Clips and notes**

- **Arrangement clips are copies.** After editing a Session clip, re-place it in the
  Arrangement, or edit the Arrangement clip in place with `arrangement_index` (which keeps
  Arrangement-only edits). Placing copies the envelopes too (measured, Cathedral 2026-10-05).
- **A write to an automated parameter turns its automation off until Re-Enable Automation.**
  Back to Arrangement does not do it. On Black Glass this read as "re-placing lost seven
  tracks' automation"; it was 42 parameters overridden by envelope rewrites, and every
  later capture measured the track with its automation off. `live.re_enable_automation`
  fixes it; `master.capture` now calls it.
- **Note ids change on removal.** In one pass, apply `update_notes` *before* `remove_notes`.
  Stale ids are refused with `NOTE_NOT_FOUND`, never applied to the wrong notes.
- **Tile with phrase-length clips, not loop-length ones.** A 3-beat and a 1.25-beat loop were
  tiled as 672 tiny Arrangement clips. Write a polymeter out over the phrase as one 16-bar clip.

**Track ids and names**

Track ids changed after a Live restart (Bass MT went from 127 to 111). Resolve ids again on every
run, and never carry them over from before a restart.

**Device facts (Live 12)**

| Device | Fact |
|---|---|
| Core Library presets | Mixed `.adv` / `.adg`. `live.browse` returns 50 items unless given `limit` |
| Audio effects | Must go after the instrument: `insert_device` without an index |
| Utility | Gain is `Output` |
| Drift | `LP Res` displays 0–1 |
| Saturator | Has `Bass Shaper` |
| EQ Eight | Filter types are `High Pass 48dB`, `Low Pass 12dB`, `High Shelf`, … |
| Simpler | Velocity-to-volume is `Vol < Vel`, at 35% by default, so ghost notes play nearly full level. Raise it to about 70% |
| Mixer pan | Displays `50L` and `50R`, which the display search cannot tell apart. Use `live.set_track_pan` (-1..1) |

**Live 12 Standard device facts (camelbone, 124 BPM A minor)**

| Fact | Detail |
|---|---|
| No Wavetable, no Operator | Standard has Analog, Collision, Drift, Electric, Tension, Simpler, the DS series. `insert_device` returns `Device Wavetable not available`. Use **Drift** for sub and bass. |
| Saturator has no `Bass Shaper` | That name is not in Live 12's Saturator. The low-end control is the **Color** section: `Color Amt Low`, `Color Freq`, `Color Width`. `Pre Dc Filter` is still there and should be On. |
| Utility gain is linear in dB | `Output` native maps -1..1 to -35..+35 dB, so **native = dB / 35**. Probed across 11 values; exact. This makes Utility the right thing to automate for a duck, unlike mixer volume. |
| Utility does bass-mono | `Bass Mono` + `Bass Freq` enforces mono below a frequency - a one-device way to hold low-end correlation at +1.0. |
| Simpler `Vol < Vel` is `Vol < Vel` | The MCP `set_device_parameter` tool HTML-escapes `<` in the name; call `live.set_device_parameter_display` directly instead. |

**Read the preset files before emulating a synth.** The TPS x CamelPhat pack
ships Diva presets as **plain ASCII** (`.h2p`): every oscillator, filter and
envelope value is readable with no plugin installed. Parsing them gave the
house style outright, and it contradicted what had been built by ear:

| Measured across the Diva presets | Bass (16) | Lead+pluck (29) | Pad (15) |
|---|---|---|---|
| Filter resonance = 0 | 16/16 | 22/29 | 10/15 |
| Filter envelope routed to cutoff | 16/16 | 29/29 | 15/15 |
| ...with that envelope's sustain at 0 | 13/16 | 28/29 | 11/15 |
| High-pass frequency | 30 Hz | 30 Hz | 30 Hz |
| Filter-env depth (median) | 46 | 36 | 18 |

So the house sound is **zero resonance and a per-note filter envelope that
snaps shut** - none of which needs the plugin. Drift reproduces both (its
filter Mod 1 source is Env 2). A bass built with 100% sustain, 22% resonance
and no filter envelope was wrong on every count, and the fix changed the
character without moving the measured spectrum: the capture stayed PASS at the
same LUFS, with PLR landing on the reference median.

**Leads are not plucks.** The table above first lumped them together, with an
amp-sustain median of 0% - and every lead built from that number came out
plinky, on every track from camelbone to Threshold. Measured by category the
pack says the opposite for leads:

| Amp sustain (median, share >= 30%) | Leads | Plucks | Synths / pads | Bass |
|---|---|---|---|---|
| Diva (`LD` 16, `PL` 15, `SY` 13, `BS` 16) | 20%, 4/16 | **0%**, 0/15 | 49%, 10/13 | 27%, 5/16 |
| Serum 2 (`LD` 18, `PL` 14, `SY` 13, `BS` 15) | **80%**, 13/18 | **0%**, 2/14 | 76%, 11/13 | 50%, 10/15 |

The plucked amp envelope belongs to plucks only. A CamelPhat lead (medians of
the 18 Serum leads) is Juno or Minimoog saw wavetables, two oscillators with
one an octave up, a sub, **6-9 unison voices** on 10 of 18, amp attack 1-20 ms,
**sustain 0.8, release ~0.3 s**, a Moog-ladder low-pass with ~10 % resonance
and 15-20 % drive, then chorus -> delay -> compressor. It is played **low** -
the demo melodies sit around MIDI 50-65 and let the octave layer and sub fill
the top and bottom - and the pack's lead MIDI (34 files, medians) is 4.6 notes
a bar, **one note for ~half the line**, 67 % of onsets on the **3-3-2** steps
(`x..x..x.x..x..x.`; 14 of 34 strictly), notes about **two-thirds of the gap**
to the next (gate 0.67), in MIDI 55-64. The hook is rhythm and tone, not contour. Ours were one thin oscillator, an octave or
two higher, tracing arpeggios.

Serum 2 presets (`.SerumPreset`) are **not** opaque. After the `XferJson`
header (a u64 length and a JSON header) come a u32 size, a u32 format, and a
**zstd frame** (magic `28 B5 2F FD`) holding **CBOR** with every parameter -
oscillators and wavetable paths, envelopes, filters, mod matrix, FX racks -
and each preset's demo melody in `MidiClip0` (notes, lengths, velocities,
macro automation). Unset parameters are stored as `"default"`. Node 22.15+
has zstd in `zlib`; on older Node, `fzstd` and `cbor-x` decode it.

**`set_automation` writes stepped ramps at `step` resolution** (default 0.25
beats). Between two breakpoints it interpolates linearly in steps of `step`, and
anything finer than `step` is lost: points at 0 and 0.09 beats with the default
step held the first value and jumped. So pass a small `step` for fast shapes (a
duck needs 0.0625 or less), and remember the interpolation cuts both ways - a
duck drawn as "recovered at 0.75, kick at 1.0" **fades out across the last
quarter beat** instead of holding. Add a hold point one step before the next kick
(`next - step`, same value) wherever a shape should stay put. Threshold's ducks
all faded before every kick until they got one.

**A clip envelope plays a remembered value at beat 0, not the step written
there.** Live gives each clip envelope an opening value; `value_at_time(0)` -
and the first audio block of playback - use it, and from about 0.005 beats on
the written steps take over. `envelope.clear()` keeps that value, and so does
rewriting. On Threshold the shimmer bloom asked for 0.05 at beat 0 but played
0.8, so the first grain of every event peaked ~20 dB hot (-14.0 dB instead of
-36.4); the first kick of every growl, sub and melody clip went unducked.
`live.set_automation` now removes the envelope (`clip.clear_envelope`) and
creates it with the parameter parked on the first point, and reports
`value_at_start` - what Live will really play there. That takes on most writes
but not all (Live's rule for the opening value is not fully understood), and it
failed every time for a first point at the parameter's exact **minimum** (a
Utility at -inf): ask for -34 dB instead. So **always check `value_at_start`
against the first point**, and retry with `live.clear_automation` (which now
removes the envelope) and a separate write until it matches.

**Sample role rules must match words, not substrings.** `/hats?/` matched the
"P**hat**" in "CamelPhat", so a pack whose every file is named
"TPS x CamelPhat - ..." indexed 221 hi-hats, including all its risers, drones
and impacts. Leading `` on every drum rule fixed it; see
`bridge/tests/sample-classify.test.ts`.

**A browser Place cannot be added through the API.** A new sample folder is
invisible to `live.browse` until the user adds it in Live's browser by hand.
Check `find_sounds user_folders` before planning to load from a folder.

**Sidechain ducking**

The API cannot route a compressor's sidechain. Draw the duck as clip automation on the synth's
Volume, built from the kick clip's own notes. Use -12 dB on main kicks, -5 dB on secondary kicks
and no duck where a beat is dropped. **Redraw it whenever the kick changes.**

**Stutter**

Live's stutter was its audio output (MME to an HDMI monitor), not the CPU, which sat at about 4%.
Resampled captures were clean, so short captures stay valid for measurement. Switching off the
devices on muted tracks saves CPU.

**Transient errors**

Heartbeat drops reconnect within a second. `EBUSY` on a fresh capture file clears within seconds.
Retry both a few times before failing.

## Measuring a mix

- **Measure soloed tracks with the master dynamics bypassed.** Take `master.checkpoint`, switch the
  Glue, Saturator and Limiter off, capture 4 bars per solo, then switch them back on. Use LUFS for
  balance between parts and band RMS for spectrum. Measure in the busiest section; Plateau d had
  every part.
- **Balances that read well** in melodic techno, relative to the kick in LUFS:

  | Part | Relative to the kick |
  |---|---|
  | Clap | -4 |
  | Hats | -11 to -13 |
  | Lead | -10 |
  | Pads | -12 to -15 |
  | Counter melody | about -20 |
  | Polymetric percussion | -18 to -20 |

  The sub reads -9 because the loudness weighting cuts lows. Judge the sub against the
  reference's sub band instead.
- **Gain-stage before limiting.** Cutting Limiter gain from 6 to 2 dB left the output unchanged,
  because the mix reached the chain hot and the Saturator and Limiter were clamping it. Trim the
  input with Utility at the head of the chain first.
- **DC and sub-30 Hz rumble came from sources.** A kick sample carried the rumble, and a synth
  carried DC. The Saturator, with Pre-DC off, made the DC four times worse by clipping the lopsided
  kick. High-pass at the source, and turn Pre-DC on.
- **Raising a quiet part can expose clutter.** Bringing the polymetric percussion up by about
  10 dB made its density and timing problems audible. Re-audit the drums after big fader moves.
- **A build section will REVIEW against a whole-song reference.** It is missing parts by design.
  Judge the plateau and peak sections against the reference.
- **Where it landed:** -12.9 to -13.0 LUFS (Cowgirl -12.9), true peak -1.2 dBTP, PLR about 11.8 dB
  (Cowgirl 13.1), every band within 3 dB. The master chain was input trim -6 dB, Glue at threshold
  0, Saturator 3 dB with Pre-DC on, and Limiter gain 0 with a -1.2 dB ceiling.

## Harmony audits and atmosphere (camelbone)

- **Model a drone by its measured pitch content, not as one MIDI note.** A
  drone sample named "C" held C in several octaves, so an audit that modelled
  it as a single note missed a semitone clash with a B four octaves of the
  register away. Measure each drone's chroma first: of ten pack drones all
  named "C", one had a C♯ at −8 dB.
- **The bridge cannot tell you Simpler's playback mode.** In One-Shot,
  `Trigger Mode: Trigger` ignores note-off, so a note that "ends" keeps
  sounding. Wherever a stop matters, set `Gate` and a `Fade Out`; it is correct
  in either mode.
- **Judge width per band, not by whole-mix correlation.** In a drop the mono
  kick and bass dominate correlation, which barely moved even when the mid and
  presence bands widened by 1-5 dB. And a pure tone placed centre *narrows*
  its band: it adds mid with no side. Decorrelate it (chorus, delay) first.

## Drums

- **One swing for everything on the off-16ths.** The hats swung 54% (about 9 ms late), while the
  polymetric rim and toms, the kick pickups and the clap ghosts played straight. Every coincidence
  became a near-flam, 195 of them per 16 bars. Anchors (main kicks, the backbeat) stay on the
  grid. Every other off-16th takes the hats' swing.
- **A loop shorter than the phrase cannot be swung per position.** In a 5-step loop, a note falls
  on even and odd 16ths in turn. Write it out over the phrase, then swing it.
- **Polymetric percussion stays off the quarter beats and the open-hat steps.** When rotating
  cycles land on the kick and clap, the backbeat thickens for a beat and then clears, which was
  heard as "short messy moments". If a rule would delete most of a part, **move the part by a
  16th** instead. The rim lost 19 of 21 hits to the open-hat rule. Moved to the "a" of the beat,
  it kept them all.
- **No random chance on any hit** in a groove someone is judging. It reads as messiness.
- **Phrase ends need steady footing.** Two-hit ornaments stacked at a phrase turn sound like
  tripping: flams on a roomy clap, ratchets next to an open hat, or a variant that moves the open
  hat onto an off-16th. Let the phrase turn come from the kick, bass and fill. Keep the hats where
  they always are.
- **Variation must relate to the bass.** Kick variations placed in one bassline's gaps became
  random once the bass changed. Tie kick pickups to harmony changes (the last 16th before the bass
  moves), and drop a beat where the bass glides or the fill plays.
- **The generator's variant bars were too timid.** One B bar differed from A by a single hat.
  Compose the variation explicitly instead: a density arc across the phrase, one ornament per
  phrase point, a fill that resolves on the downbeat.
- **Audit the timeline, not the grid.** Lay every drum track's notes on one 16-bar timeline. Count
  hits 6–30 ms apart between parts (smears) and hits per beat (pile-ups), and print the densest
  beats with their contents. That found every problem the user heard.

## Bass and harmony

- **"Fake 303" was rejected.** A resonant, sequenced acid line on a 303 preset did not suit this
  user. They wanted round first, then deep and dramatic (Jon Hopkins). The approach that worked:
  - long notes on a slow minor progression (i–♭VI–♭VII … ♭VI–V);
  - glides between chords (overlapping notes, legato);
  - a saw plus a sine an octave down, through Saturator's Bass Shaper;
  - a filter that opens across each 16-bar phrase;
  - ducking drawn from the kick.
- **When the bass starts moving, re-audit every part written over the old static bass.** About 430
  minor-2nd and minor-9th rubs appeared, none of them against the bass itself:
  - **A held drone:** its D ground against the lead's E♭. Make drones follow the harmony.
  - **Pad 9ths:** the pads' A sat under the lead's B♭.
  - **Lead and counter in one octave:** the two melodic lines rubbed against each other.
- **Resolve rubs with the main idea fixed.** The lead arp stays as written. Each rubbing note in
  the other parts moves to the nearest scale tone that rubs with nothing it overlaps. Major 7ths are
  soft and can stay. A ♯11 over ♭VI is a colour, not a clash.
- **Frequency ownership.** The sub's saw sat on G at 98 Hz, and the pad's pedal note and the drone
  doubled it in the same octave. Gentle 12 dB/oct high-passes left them only 9 dB down. Use steep
  48 dB/oct high-passes just above each part's job.

## Process

- **Dry-run every change.** Print the grid or the plan, run the checks, then write. Read back note
  counts after every write, and Arrangement placements after every re-tile.
- **Keep a snapshot or the original clip.** Write fitted versions to new slots, and leave the
  originals in place for comparison and undo. Snapshots do not survive a bridge restart.
- **Commit only staged files.** A `git add -A` once committed an unread file. README edits must
  assert on their anchors: a missing anchor once dropped six sections silently.
- **Tools still to promote out of scratch scripts.** These were the most useful checks of the
  project and should become `agent/src` or `qc/src` functions with tests:
  - the drum timeline audit (smears, pile-ups, densest beats);
  - the harmonic rub audit against the moving bass;
  - the smallest-move rub resolver;
  - ducking drawn from kick notes.

## Mastering (camelbone)

- **Live's Limiter in True Peak mode still measures 0.1-0.2 dB over its ceiling** on the QC's 4x
  true-peak meter. For a -1 dBTP delivery set the ceiling to -1.2 and re-measure.
- **Once the limiter is pinned by the kick, more drive buys nothing.** +1 dB of limiter gain gave
  +0.1 LU and the same PLR; a +1 dB low-bass bell was removed the same way. The remaining loudness
  is in the kick/sub peak structure, at source.
- **Read the EQ band's filter type before trusting its role name.** The "30 Hz" band was a low shelf
  at 0 dB, not a high-pass, so nothing was trimming infra.
- **A whole-song capture outlasts fetch.** Node's fetch drops a request after 300 s without response
  headers; the CLI and the MCP HTTP client now use `postJson` (`bridge/src/http-post.ts`), which has
  no client-side timeout.

## Outros and clip copies (camelbone)

- **`live.duplicate_clip` copies notes, not clip envelopes**, and it is
  bridge-side, so it cannot run inside a transaction. Duplicate first, then
  redraw any automation (the duck) in the transaction.
- **Shortening a copy:** `live.set_clip_loop` with `end` makes an 8-bar
  version of a 16-bar clip; `place_clip_in_arrangement` then places 8 bars.
- **A fade drawn on a device parameter persists after the clip.** Clips
  without that envelope never reset it. End the note first, let the release
  finish, then return the parameter to its normal value inside the same clip.
- **Arrangement captures from `start_beat` began two bars late** on the
  outro capture (silence arrived two bars early in the file). Locate a
  capture by a known event - the end of the song, a drop - before reading
  bar numbers off it. Still true after the fix: on Black Glass (2026-10-05) a
  Drop B capture began 1.0 beat late by cross-correlation with the render; a
  capture from beat 0 lined up exactly.
- Pedal notes: moving every note of a chain to one pitch merges any that
  overlapped at the old glides (96 -> 94 notes). Harmless, but expect it.

## Re-voicing and re-keying a part (camelbone)

- **`live.remove_notes` renumbers every note in that clip**, so an update
  later in the same transaction that names an id read beforehand fails with
  `NOTE_NOT_FOUND`. Remove in one step, re-read, then update.
- **A new MIDI track arrives armed.** Disarm it; a forgotten arm reaches
  exports and MIDI keyboards.
- **Track meters read 0 during Arrangement playback** here, even on tracks that
  were sounding. To prove a part plays, solo it and capture a few bars.
- **Moving a lead down into the pad's register buries it.** Its own pitch bins
  are dominated by the pad, so a fader change barely shows there. Judge its
  level by soloed LUFS against the mix (about 6-10 LU under is typical), not
  by a band reading.
- **Key is set by emphasis, not the scale.** Am-F-C-G with a lead on C-E-G,
  phrase endings off the tonic and a G-major cadence reads as C major. A in the
  Am voicing, the phrase landing on A and an E-major (V) cadence read as A minor.

## Auditing with automation missing (Black Glass)

- **A measurement taken with a part's automation off judges the wrong track.**
  With the arp's filter sweeps overridden, it sat wide open in the breakdown, so it
  measured +4.5 dB over the strings and "fused" with them. An octave lift was
  approved on that number. With the automation restored the arp is a filtered
  texture 3.4 dB under the rest, as its TRACK.md says, and the lift put it above
  its own closed filter: the breakdown lost 2.3 dB and its top end, and nothing in
  Rupture or Release moved more than 0.6 dB. Reverted.
- **Check a capture against the last render on a section nobody touched** before
  trusting any before/after. The untouched intro matched `blackglass.flac` to
  0.1 dB, which made every other difference attributable.
- **A Simpler filter set above where the sample has energy does nothing.** At 3 kHz
  the arp measured identical to its open-filter self. At 1.1 kHz with +26 st of
  envelope its brightness falls 9 % over a note's first 60 ms (it rose 24 % before);
  velocity barely reached brightness (x0.93 -> x0.97) because the track's Auto
  Filter dominates. Measure a patch change on the part alone, not only in the mix.

## Swapping a baked AF101 sample for the live synth (Black Glass)

- **Rebuild a lost patch by measurement, statically first.** Match harmonics 2-12 at
  20 ms and the amp envelope over 0-300 ms with `render_note` and a grid search, then
  add expression and re-check that the average brightness has not moved. Measure the
  sample's real length too: the arp's 1.19 s file was silent after ~300 ms.
- **AF101 unison combs a static match.** Two voices start at offset phases, so their
  harmonics partly cancel (2nd harmonic -11 dB instead of -3; 5.9 dB average error).
  Copy a sample's width some other way, or not at all.
- **AF101's velocity to amp is gentler than Simpler's.** At full it gives 3.8 dB
  between velocities 112 and 68 (Simpler at 45 % gave ~8 dB in context). Keep an
  accent pattern's contrast by rewriting its velocities in place.
- **An asymmetric pulse carries DC** (width 0.4: -21 dB re RMS). A normalised render
  hid it; live, QC flagged it. Turn on the track Utility's DC Filter.
- **Display targets for times are in ms.** `live.set_device_parameter_display` takes
  0.16 s as `target: 160`, because `parse_display` normalises seconds to ms; 0.16
  wrote 0.16 ms. Read every parameter back, with a tolerance tighter than the values.

## Finding why automation did not play (Cathedral)

- **Test the tool on a scratch track before writing a rule.** An empty, muted track and
  a 16-beat ramp settled in six 4-bar captures what a day of inference had got wrong:
  placing keeps envelopes; a parameter write overrides them; Back to Arrangement leaves
  the override; Re-Enable Automation clears it.
- **Confirm a bypass by reading it back.** `live.set_device_active` takes `enabled`; a call
  with `active` failed validation silently (output discarded), so Black Glass's "master
  dynamics bypassed" captures ran through the master chain. Comparisons were like for
  like, so their conclusions held, but the claim was wrong.
- **Back to Arrangement lands a tick later**: straight after the call
  `session_overrides_arrangement` can still read true.

