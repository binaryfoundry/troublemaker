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

## Mastering for the club (Threshold, Cathedral, Black Glass)

- **The masters lost in a real club.** Played after Pryda's "Level 99", the user rated them 3-4/10.
  Against five Eric Prydz / Pryda references the loudest 30 s were 4.5-6.2 LU short (-10.8 to -12.5
  LUFS against -6.3), PLR 11.6-12.2 dB against 10.0 (8.5 for Level 99), infra +7 to +12 dB, and the
  top end 4-12 dB short (presence, brilliance, air). In the club the DJ gains a quiet track up, and
  the boom and the dullness come up with it.
- **QC saw all of it and passed it as REVIEW.** Loudness under the window was `INFO` ("staying
  quieter is allowed"), tone was `REVIEW`, and Cathedral's own audit logged its 4 LU gap and moved
  on. A gap to the club references is a release blocker: QC now FAILS it, and the user's rule is
  that real club tracks are the authority over any guide's number.
- **Integrated loudness misleads on extended mixes.** The references' integrated median was -9.6
  LUFS but their drops ran at -6.3: long DJ intros pull integrated down. Judge the loudest section.
- **Exports were 16-bit FLAC.** A club master is 24-bit PCM; make lossy and 16-bit copies from it.
- **The fix is mostly in the mix**, as the camelbone lesson above already said: the infra and sub
  excess eat the headroom the limiter needs, and the top end is missing at its sources. Then
  staged peak control (`master preset club`), measured against the references after each step.

## Re-mastering against the club references (Black Glass, 2026-10-08)

- **Measure every part alone before touching a fader.** Solo each track over the drop with the
  master's dynamics bypassed, capture, and read its bands, peak and crest. Then solve for the fader
  moves that bring the mix's tonal shape to the references' (least squares on band power, a cost per
  dB moved, the kick held as the anchor). One solve took every band from up to 6 dB off to within 2.
  This is now `balance` (CLI and MCP); replayed on the same captures it predicts 5.6 -> 2.1 dB.
- **One part can eat the headroom.** The growl peaked at -2.4 dBFS on a -20.5 LUFS body (crest 18
  dB); the master limiter was spending its drive on those spikes. A Limiter on the growl's own track
  took about 5 dB off them.
- **Check the meter before believing it.** Three QC readings were wrong on short captures and were
  fixed: the short-term meter's 3 s warm-up dragged a drop's loudness down 4 LU; the band filter
  read the sub's 41 Hz fundamental as infra (QC now uses a brick-wall FFT); and density was compared
  against the references' whole tracks instead of their drops (~7 dB, not 10).
- **A premaster capture clips at 0 dBFS.** Lower the master's input trim 6 dB to read its real
  peaks; Black Glass's drop had a 15.4 dB crest against the references' 7.
- **When the limiter is pinned, drive stops paying.** 3 dB more drive bought 0.8 LU; taking the
  kick down 1.5 dB lost 0.6 LU, because the limiter had been riding it. The references get more
  loudness per peak from sustained mid content under the drums - an arrangement difference, not a
  mastering one.
- **Listening copies are matched down, never up.** Matching a quiet master up to a loud one pushed
  it past 0 dBFS and clipped the copy.

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

## A staged build and a sample-exact game loop (Alien Breed v5, 2026-10-08)

- **Measure "protect the peak" in absolute levels, not shares.** The first master's swarm measured
  level with the build in every absolute band (within 0.3 dB) although it had the stab, crashes and
  denser drums. Band *shares* lied: the Regroup read brightest and widest only because the sub and
  bass had left. The fix that mattered was the earliest failing check of NEW-TRACK-DETAILED 33 -
  low end removed before the drop (sub out, downbeat kicks only, under the riser) - not more layers.
- **A riser can be the loudest thing in the track.** A noise riser at fader 0 made bars 25-32 3 dB
  louder than the peak. Measure per 8 bars after adding transition FX.
- **One part can still eat the master limiter.** A once-per-2-bars stab hit peaked at -0.8 dBFS alone
  (a ~17 dB crest per hit); a limiter on its own track, not more master limiting.
- **Live's Limiter in True Peak mode under-reads QC's true peak by 0.3-0.4 dB.** Set the ceiling
  below the target (-3.4 for a -3 dBTP limit) and measure the render.
- **Pick tempos that make whole bars.** At 115.2 BPM a bar is 91,875 samples at 44.1 kHz and
  100,000 at 48 kHz, so a 64-bar loop is sample-exact at both rates and resamples 160/147 exactly.
- **Wrap tails by capturing two passes and keeping the second.** Align the passes on the hats band:
  AF101's unison and drift make each pass's waveform different (whole-signal correlation 0.03), but
  the drums repeat exactly. Resample a loop as three tiled copies and keep the middle one, so the
  seam is filtered as continuous audio. This machine's ffmpeg has no soxr; SciPy's `resample_poly`
  does it exactly.
- **A Drum Rack inside an Instrument Rack hides its pads.** "Break Lab Kit" could not be mapped
  (`live.get_drum_pads`: not a Drum Rack); use a kit that is a Drum Rack at the top level.
- **A long capture can come back short from outside.** One 128-bar capture stopped at 96.6 bars
  (not a code limit); the retry was exact. Check the length of every render.
- **Ask which instruments the reference uses before choosing the palette.** Stage 0 recommended "synths,
  no orchestra" from tone numbers alone; The Colony's menace is strings. Two rounds of harmony and pad
  changes made no audible difference (the user: "chill easy listening") because the pad sat 4-5 dB
  under the drums and bass - the part being fixed was not the part being heard. Measure each stem's
  level before deciding which part carries a complaint.
- **Measure continuity, not just tone.** Band envelope floors (p10 of a 10 ms envelope against its
  mean) separated a menacing reference from a chill mix where the tilt did not: The Colony's mids sat
  2.8 dB under their mean at their quietest, ours 5-7 dB. `balance` fits average tone and kept the
  strings too quiet to form a bed; set sustained layers by their floor, then let the solver trim.
- **Live will not play into an unconnected output.** To capture without the user hearing it: Driver
  Type "Windows Audio" on the normal device, and mute Ableton in the Windows Volume Mixer.


## Checking the Serum and Diva conversions without either synth (2026-10-09)

- **A sample pack's loops are the synth's own renders.** Rendering a preset's demo MIDI
  through AF101 (`render_note --events`) and comparing it with the loop the synth made from
  the same MIDI turned "the timbre is unverified" into a band error per preset, for 13
  Serum and 8 Diva presets (`analogfoundry/tools/pack_loops.py`).
- **Match a loop by exact pitch, not pitch class and rhythm.** Chroma plus onsets put Synth
  Loop 13 on Serum's SY - Patterns. A semitone spectrogram against each clip's notes and
  harmonics showed it is Diva's SY - Black (0.84 against 0.71), and two conversion rules
  fitted to it were backwards: the unison octave stack goes up, not down, and Basic Mini's
  first frame is a saw, not a triangle. Fit a rule only after the pair is pinned down, and
  keep it only when every pair it touches agrees.
- **One improving preset can hide the real cause.** SY - Following got closer with a triangle
  in place of Basic Mini only because that hid excess brightness coming from elsewhere.
  Test a variant on the preset where the part plays alone.
- **Find ground truth for every guessed id.** The Serum mod-source codes had been read off the
  pack's usage and were off by one: source 1 is the mod wheel, so the leads' "amp envelope
  -> cutoff" was the mod wheel and every envelope route read the next envelope's shape.
  A fixture saved with one route per source settled it, and the pack confirmed it: every
  pitch-envelope route lands on a 7-28 ms envelope under the right numbering, and on an
  untouched default one under the wrong one. CAMELPHAT.md 6b was measured on the wrong
  numbering and has been corrected, and with it the *Leads* advice in AGENTS.md.
- **A stored value is evidence about the default.** Serum stores only values that differ
  from its default, so the synced LFO rates the converter thought absent were there all
  along (100 * knob^4, a knob position Serum snaps to a division), and "Free" being stored
  397 times means the unstored mode is the other one, Trig. An unstored filter type is MG
  Low 12, not 24: SY - Desire rendered 46 dB too dark above 5 kHz at 24 dB and within 1.6 dB
  band error at 12. But a value converted from Serum 1 is stored when it differs in the last
  bit, so it says little about the default.
- **A consistent offset across presets is a unit error.** Six of eight Diva presets fitted
  best with the cutoff one octave lower, at Freq values from 62 to 104: the knob is a note
  number an octave below MIDI's, not a note number.
- **Some things a long-term spectrum cannot see.** An LFO's shape on the cutoff did not show
  in the brightness over time either: a render with no LFO at all correlated with the loop
  as well as any wave, because each note's envelope dominates. Read such things from the file
  and say they are unmeasured.

## Rebuilding a track in stages (Threshold v3, 2026-10-09)

- **Simpler loads a sample at -12 dB.** Kick 30 sat 12 dB under every synth until its
  Simpler Volume went to 0 dB; the first `balance` run held that quiet kick as the anchor
  and solved everything around it. Measure each part alone in LUFS against the kick before
  solving, and gain-stage at the source first.
- **The converted AF101 patches are hot; Live's orchestral racks and the 909 kit are not.**
  Calibrated to Serum's demo loudness, the lead alone read -6.9 LUFS at fader 0, the
  strings -26.6 and the 909 clap -28.8 (its kit Gain macro sits at -7.5). Take the synths
  down at the fader and bring the racks up at their Volume macro (+6 max), then the
  fader, then an EQ Eight's output.
- **`balance` fits tone, not hierarchy.** With the kick held, it raised the growl 4 dB and
  buried the hook 9-10 dB under the rest in the hook's own bands. Hold the hook as an
  anchor too, then measure the hook against the rest (HOOKS 22) after every solve.
- **A missing band can be a sample, not a fader.** Air 6.5 dB under the references, with
  the 909 hats pinned at +6, closed to +2.3 by swapping in pack hats with 7-10 dB more air
  relative to presence - measured from the WAVs before loading them.
- **Choke by note length.** Two Simplers in Gate mode, the open hat's note ending at the
  next closed hat, reproduce a Drum Rack choke the API cannot set.
- **The limiter hides the peak.** At club loudness the drop, Peak A and Peak B landed
  within 0.3 LU of each other; protect the peak with notes, width and tone, and check per
  8 bars on the master, not only on the mix.
- **A section's clip can quietly undo the arrangement.** Peak A and B reused the plateau's
  lead clip, darker than the drop's; only the per-section read of the final master showed it.
- **The CamelPhat and Prydz references disagree on tone** by about 8 dB of infra and 5 dB
  of mids and top. A master cannot pass both; name which set owns tone in the brief.
