# Mastering workflow

The practical guide to the mastering tools. `MIXING.md` explains why they
work this way; `agent/prompts/mastering.md` is the agent's version of the
same rules.

There are two halves:

- **QC** (`ableton-agent qc`) measures an exported file and judges it against
  references and the rules. It runs locally on any WAV/AIFF/FLAC; it needs
  ffmpeg but neither Live nor the bridge.
- **Master chain control** (`ableton-agent master ...`) adjusts a mastering
  chain on Live's Master track by role, within safe ranges, with every change
  logged.

## 1. Set up the template chain

**Live 12.3+ (verified on 12.4.6 Standard): one command.**

```bash
npm run cli -- master build            # insert what is missing + apply the clean preset
npm run cli -- master build --no-preset
npm run cli -- master preset clean     # re-apply the starting values at any time
```

`master build` inserts only the devices that are missing, after anything
already on Master, then applies `clean`, MIXING.md's "Club Master - Clean"
starting values:

| Device | Setting |
| ------ | ------- |
| Utility | Output 0 dB, Width 100 %, Bass Mono off |
| Glue Compressor | 2:1, 30 ms attack, Auto release, Range 2 dB, threshold 0 dB, soft clip off |
| Saturator | Analog Clip, Drive +1 dB, Output -1 dB |
| Limiter | **True Peak** mode, 3 ms lookahead, Input Gain 0 dB, Ceiling -1.0 dB |

EQ Eight is left flat at Live's defaults.

Every `master` command takes `--track <id>`, which builds and tests a chain on
a scratch track without touching your mix.

**Live 11: by hand.** The agent cannot add devices there, so drag these onto
the **Master** track, in this order:

1. **Utility** — input trim and width
2. **EQ Eight** — corrective tonal work
3. **Glue Compressor** (or **Compressor** if Glue is unavailable in your edition)
4. **Saturator** — optional peak conditioning
5. **Limiter** — last, always

Start them neutral, as `MIXING.md` recommends: Utility 0 dB / 100 %; EQ bands
flat with the high-pass off; Glue 2:1, 30 ms attack, auto release; Saturator
Analog Clip with Drive about +1 dB and Output about -1 dB, Hi-Quality on;
Limiter ceiling -1.0 dB.

Then check what the agent sees:

```bash
npm run bridge
npm run cli -- master chain
```

Every role shows its current value and safe range. Warnings flag a missing
device, a chain in the wrong order, a Limiter that isn't last, or the Live 11
Limiter's missing True Peak mode.

Save this as your own default Set or template so you don't have to repeat it.

## 2. Collect references

Pick **3–5 lossless masters** from the same subgenre and era. One reference
can carry an unusual tonal choice that QC would otherwise treat as a genre
rule. Local lossless files only; streamed or loudness-normalised copies give
misleading levels.

## 3. Capture or export, then measure

### Capture (agentic)

No Live version can export through its API, but Live can record its own
output. `--capture` does that in one step:

```bash
npm run cli -- qc --capture --bars 16 --scene <scene_id> --ref a.wav --ref b.wav --ref c.wav --chain
```

It creates (or reuses) an audio track called **TM Capture**, sets its input to
**Resampling** (everything reaching the Master, *after* the Master chain), turns
monitoring off so nothing feeds back, launches the scene, records the requested
length, and runs QC on the resulting WAV. `master capture` records without
running QC.

Afterwards it removes the recorded clip from the capture track. Live loops a
freshly recorded Session clip straight into playback, which would feed back
into the Master, and it holds the file locked while the clip is loaded. The
WAV stays in the project's `Samples/Recorded` folder. Playback is stopped and
the track disarmed, even if the capture fails.

Capture runs in real time (16 bars at 124 BPM is about 31 s) at Live's
recording format (Preferences → Record, 24-bit WAV by default) and the audio
device's sample rate. That is right for judging a mix. For the delivery file,
still use a real export: it renders offline, at the delivery bit depth, with
dither once.

### Export (delivery)

In File → Export Audio/Video:

- **24-bit WAV** at the project sample rate, with dither on (once, at the
  final reduction) for the deliverable;
- **32-bit float** with dither off for an archive or a file that will be
  processed further.

Then measure the exported file:

```bash
npm run cli -- qc mixdown.wav \
  --ref refs/a.wav --ref refs/b.wav --ref refs/c.wav \
  --profile techno --sample-rate 48000 --bit-depth 24 --chain
```

`--chain` adds the master-chain rules (limiter drive, EQ size, reversals) and
needs the bridge running. The exit code is 0 PASS, 1 REVIEW, 2 FAIL. `--json
out.json` saves everything.

Each file is analysed in two passes:

| Measurement | How |
| ----------- | --- |
| Integrated / short-term loudness, LRA | ffmpeg `ebur128` (ITU-R BS.1770) |
| True peak, sample peak | ffmpeg `ebur128` |
| PLR | true peak minus integrated loudness |
| Band energy, mid and side, 9 bands | 4th-order Butterworth band-pass filters on the decoded PCM |
| Correlation and mono loss, full band and below 120 Hz | decoded PCM |
| Clipping (runs of 3+ full-scale samples), DC offset, silent channel | decoded PCM |

Spectrum and stereo are compared over the **loudest 30 seconds** (the drop) by
default, or over `--section start:duration`, so you compare drop to drop
rather than whole tracks, whose averages depend on the arrangement. Tonal
balance is compared as each file's band level *relative to its own overall
level*, which makes the comparison independent of loudness.

The band filters are built for comparison against references, not
lab-grade measurement: adjacent bands overlap by a few dB. References go
through the same filters, so the comparison holds.

Reference analyses are cached in `.troublemaker/qc-cache/`, so re-runs only
re-analyse the target.

## 4. Try a change: A/B at matched loudness

The preferred way to change the chain. One command runs the whole
experiment `MIXING.md` describes:

```bash
npm run cli -- ab limiter_gain 4 --reason "mix sits at -15 LUFS, under the window" \
  --bars 16 --scene <id> --ref a.wav --ref b.wav --ref c.wav
```

1. checkpoint the chain;
2. capture **A** (the chain as it is);
3. apply the change;
4. capture **B**;
5. compare the two **at matched loudness**;
6. **keep the change only if B wins**, otherwise restore the checkpoint.
   `--keep` keeps it anyway, for when you have decided by ear.

If the second capture fails, the change is reverted.

The comparison uses only measures that loudness can't fake, because a
louder version always seems better:

| Measure | Counts for B when |
| ------- | ----------------- |
| Technical failures (true peak, clipping) | B has fewer; decides on its own |
| Peak-to-loudness ratio | B keeps ≥ 1 dB more punch |
| Low-end mono loss | B is ≥ 0.5 dB more mono-safe |
| Tonal distance to the references | B is ≥ 0.5 dB closer |
| Tonal shift from a *dynamics* change | counts **against** B from 1.5 dB |
| Loudness | **only** while A is below the working window, for at most 3 dB of PLR, and never below the PLR floor |

The PLR floor is the reference median minus 2 dB, or the profile minimum
without references (deep 9, house 7.5, techno 7, dnb 6 dB, a heuristic). It
stops a run of trials from each spending "only" 3 dB. With no measurable
difference, A is kept: the best move can be no move.

Every trial also writes **loudness-matched listening copies** to
`.troublemaker/ab/<time>/`: A as captured, and B gain-adjusted to A's loudness,
written as 32-bit float so it can't clip. Judge by ear too. The numbers are
evidence, not the verdict.

`compare <a.wav> <b.wav>` does steps 5 and 6's analysis for any two files.

## 5. Adjust directly, one change at a time

```bash
npm run cli -- master checkpoint "before limiter work"
npm run cli -- master set limiter_ceiling -1.5 --reason "true peak 0.4 dB over; Live 11 limiter has no TP mode"
```

Every change:

- is in **engineering units** — the bridge converts to whatever internal
  scaling the device uses, by matching Live's own displayed value;
- must be inside the role's **safe range** (`--mix-repair` widens EQ to ±6 dB,
  `--allow-widen` lets width go to 130 %);
- needs a **reason**, logged to `.troublemaker/decisions.jsonl`;
- is **read back** and reported before → after, with any threshold warnings.

If a control reverses direction twice, further changes are refused with
`STOP_AND_REVIEW`: the loop is chasing a room anomaly or itself. Get
independent evidence (headphones, mono, another room), then `--override`, or
`master reset` to start the next job's log.

`master restore <checkpoint_id>` puts every chain parameter back exactly.

Re-export, re-run `qc`, and keep a change only if the evidence supports it.

## Live 12 upgrade notes

The code checks what the running Live can do rather than assuming, so an
upgrade needs no code changes. What changes:

| Capability | Live 11 Intro | Live 12.3+ |
| ---------- | ------------- | ---------- |
| Insert devices via API | No; drag them in by hand | `master build` inserts the template chain (native devices only) — verified on 12.4.6 |
| Limiter True Peak mode | Not available; QC enforces the ceiling on the export | `limiter_mode` role sets it; the clean preset turns it on — verified |
| Max for Live | Not available | Available, but not needed: the Remote Script stays the bridge |
| Macro Variations | Not in Intro | Racks can carry A/B snapshots; `master checkpoint` still works |
| Track limit | 16 | Edition-dependent |

After upgrading:

1. Run `npm run install-remote-script` again. The User Library folder is
   shared, but reinstalling makes sure the copy is current.
2. Restart Live and reselect **TroubleMaker** as the Control Surface. A new
   major version gets fresh preferences, as the 11.3.43 update showed.
3. Run `npm run test:live` and `npm run cli -- capabilities`;
   `device_insertion` should read `true` on 12.3+.
4. Run `npm run cli -- master chain`. If a future Live renames a parameter,
   the role shows as missing and needs another candidate name in
   `bridge/src/mastering/roles.ts`.

What Live 12.4.6 changed, as read from the real devices (handled; Live 11
names kept as fallbacks):

| Device | Live 12 | Live 11 |
| ------ | ------- | ------- |
| Utility | gain is `Output`; adds `Bass Mono` / `Bass Freq` | `Gain` |
| Glue Compressor | makeup is `Output`; Release shows bare seconds (`.6`) or `A` for auto; Attack is unitless ms | `Makeup` |
| Limiter | `Input Gain`, `Mode` (Standard / True Peak), `Lookahead` 1.5 / 3 / 6 ms; new defaults ceiling -0.3 dB | `Gain`, no mode |
| Saturator | `Type`, `Pre Dc Filter`; no Hi-Quality parameter exposed | |

Live 12 embeds a newer Python than 11's 3.7. The Remote Script avoids
anything version-specific, so it should load unchanged.
