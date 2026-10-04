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

- **Arrangement clips are copies.** After editing a Session clip (notes or clip envelopes),
  re-place it in the Arrangement, or the old version keeps playing.
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
envelope value is readable with no plugin installed. Parsing all 60 gave the
house style outright, and it contradicted what had been built by ear:

| Measured across the presets | Bass (16) | Lead+pluck (29) | Pad (15) |
|---|---|---|---|
| Filter resonance = 0 | 16/16 | 22/29 | 10/15 |
| Filter envelope routed to cutoff | 16/16 | 29/29 | 15/15 |
| ...with that envelope's sustain at 0 | 13/16 | 28/29 | 11/15 |
| Amp sustain (median) | 27% | **0%** | 49% |
| High-pass frequency | 30 Hz | 30 Hz | 30 Hz |
| Filter-env depth (median) | 46 | 36 | 18 |

So the house sound is **zero resonance, a per-note filter envelope that snaps
shut, and a plucked amp envelope** - none of which needs the plugin. Drift
reproduces all three (its filter Mod 1 source is Env 2). A bass built with
100% sustain, 22% resonance and no filter envelope was wrong on every count,
and the fix changed the character without moving the measured spectrum: the
capture stayed PASS at the same LUFS, with PLR landing on the reference median.

Serum 2 presets (`.SerumPreset`) are a plain JSON metadata header followed by
a compressed binary blob - only the header is readable, and its tags
(`Wavetable`, `Embedded-Data`) name the one thing a stock Live synth cannot
reproduce: a bespoke wavetable. That gap is real for exposed leads and plucks;
it is close to irrelevant for a bass sitting under a 1.8 kHz low-pass, where
envelope and resonance decide the character.

**`set_automation` writes steps, not ramps.** Points at 0 and 0.09 beats did not
interpolate: the envelope held the first value and jumped. Draw any shape you
want to *hear* as explicit points. A 12 dB duck recovering over 40 ms took nine
points per kick (0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.085 beats), and
read back correctly through `live.get_automation`.

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
