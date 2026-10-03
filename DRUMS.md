# Drum-Machine Pattern Programming in Ableton Live: An Agent Guide to TR-808 and TR-909 Styles

## Executive summary

This guide defines an **execution-oriented method for an AI agent to design, program, vary, arrange and mix electronic drum patterns in Ableton Live**, with the Roland TR-808 and TR-909 as the primary stylistic reference points. It is deliberately version-agnostic: the core procedure relies on long-established Live concepts—MIDI clips, Drum Racks, sample playback, routing and audio effects—while features that may depend on Live edition or generation, such as per-note probability or Max for Live, are treated as optional enhancements rather than assumptions. In current Live documentation, Drum Racks provide note-specific chains, choke groups, per-chain effects and internal sends; dropping a sample onto an empty pad automatically creates a Simpler chain. citeturn15view0turn15view1

The **808 and 909 should be understood as different rhythmic and timbral languages, not merely two sets of drum samples**. The original TR-808 synthesised its percussion through analogue circuitry, yielding deliberately electronic kicks, snares, hats, rimshots, cowbells and percussion; the TR-909 followed with a hybrid architecture, combining analogue-generated core drum sounds with early digital sampling for hats/cymbals. citeturn17search4turn17search1turn17search0 Their sequencing concepts also matter: the TR-808 established a highly influential step-programming workflow, while the TR-909 added conspicuous performance-oriented functions such as shuffle and flam. Roland's original manuals document the step-based programming model; the 808 manual, for example, illustrates a 16-step 4/4 pattern in which the quarter-note beats divide into sixteenths, while the 909 manual explicitly covers shuffle and flam. citeturn2view1turn3view1

For practical production, the useful distinction is:

| Reference | Rhythmic tendency | Sonic tendency | Particularly natural uses |
|---|---|---|---|
| **TR-808** | Sparse, syncopated, often spacious; strong relationship between kick and bass | Deep/decaying kick, synthetic snare, dry hats, rim, clap, cowbell/congas | Hip-hop, trap, electro, Miami bass and hybrid electronic styles. Roland documents the 808's foundational role in hip-hop and electro. citeturn19search2turn19search4 |
| **TR-909** | Four-to-the-floor foundations, offbeat hats, shuffled percussion, flam/ghost detail | Punchier kick, cutting clap/snare, bright hats, crash/ride; highly effective when driven | House and techno are especially strongly associated with the 909 in Roland's historical material and production literature. citeturn17search19turn18search1turn18search8 |
| **Modern hybrid** | Any combination; often 909 transient drums around an 808-derived low end | Layered or processed sounds rather than historical purity | Contemporary house/techno, experimental club music and modern hip-hop/trap. This is a production strategy rather than a claim about the original machines. |

An expert agent should work in the following order:

**groove intent → pattern skeleton → sound selection/tuning → dynamics/accent → microtiming → variation → routing/processing → arrangement → validation.**

That order matters. A weak rhythm rarely becomes convincing merely through aggressive compression or saturation. Conversely, a very simple four-to-the-floor pattern can become compelling through small differences in velocity, sample decay, swing, ghost notes and arrangement. House examples from Ableton and Attack demonstrate how basic quarter-note kicks, backbeat claps and offbeat hats can form a complete rhythmic foundation, while techno examples show how a similarly simple 909 skeleton acquires movement through ghosts, saturation and timing differences. citeturn18search0turn18search1turn18search2

**Agent success criterion:** after receiving a request such as “make a dirty 909 warehouse-techno groove” or “make a sparse electro 808 pattern”, the agent should be able to produce a playable MIDI design, state its tempo and loop length, map each instrument, specify velocities and microtiming, construct an appropriate Drum Rack, provide processing/routing instructions, create variations, and explain what to change when the result sounds weak, crowded, robotic or stylistically wrong.

## Learning objectives, competencies and environment

By the end of this guide, the agent should be competent in five connected areas: **rhythm construction, drum-machine idiom, Ableton execution, sonic treatment, and musical variation**. These competencies are more important than reproducing any particular historical pattern exactly.

**Rhythm construction.** The agent should translate musical language into a step grid. In 4/4 on a sixteenth-note grid, use this invariant:

```text
Beat:        1              2              3              4
16th step:   1  2  3  4 |  5  6  7  8 |  9 10 11 12 | 13 14 15 16
Subdivision: 1e &  a    |  2e &  a    |  3e &  a    |  4e &  a
```

Therefore:

```text
Quarter-note kick: 1, 5, 9, 13
Backbeat 2 & 4:    5, 13
Offbeat eighths:   3, 7, 11, 15
Eighth notes:      1, 3, 5, 7, 9, 11, 13, 15
Sixteenths:        1–16
```

This mapping directly corresponds to the classic 16-step programming logic documented for the TR-808. citeturn2view1

**Drum-machine idiom.** The agent should know when to use sparse 808 syncopation versus the stronger four-to-the-floor grammar associated with 909 house and techno, but must not treat genre conventions as rigid laws. Roland's histories trace the 808 through hip-hop and electro and the 909 through house/techno; actual records frequently hybridise machines, samples and processing. citeturn19search2turn17search19

**Ableton execution.** The agent must be able to turn a textual pattern into a MIDI clip, assign samples to Drum Rack pads, shape one-shots with Simpler or more complex sample sets with Sampler, construct choke relationships, use Groove Pool timing, set note velocities/probabilities where supported, and route individual chains or whole drum groups for processing. Ableton documents all of these as native workflows; Simpler's One-Shot mode is specifically designed for monophonic drum hits and short sampled phrases. citeturn15view0turn20view2turn20view1

**Sound treatment.** The agent should distinguish corrective processing from creative processing. EQ should solve spectral conflicts; saturation should deliberately alter harmonics/transients; compression should control dynamic relationships or glue groups; sidechain compression should create space when the kick and bass compete. Ableton explicitly describes Compressor sidechaining as a method for making bass or mixes move out of the way of a kick, while Drum Buss combines distortion, transient shaping and low-end enhancement for drums. citeturn15view2turn20view3

**Variation and performance.** The agent should be able to turn one bar into a structured musical system rather than allowing the same loop to repeat indefinitely. Live supports groove-based timing and velocity variation, per-note probability in current versions, clip launch quantisation and Follow Actions; these mechanisms can support controlled variation without destroying the core rhythmic identity. citeturn21view0turn21view2turn13search1

### Required environment

The minimum environment is deliberately modest:

| Component | Requirement | Agent guidance |
|---|---|---|
| Ableton Live | Any edition/version containing the devices required for the chosen workflow | Do **not** assume a particular release. Check whether Drum Buss, Sampler, probability or Max for Live is available before depending on it. Use equivalent native/third-party processing when it is not. |
| Drum sounds | 808/909 one-shots, an Ableton kit, or an instrument/plugin modelling those machines | Ableton's official **Drum Machines** Pack contains sampled classic machines as Drum Racks plus presets and MIDI clips. citeturn16search2 |
| Monitoring | Headphones or monitors | Evaluate low-frequency decay carefully; an 808-style kick can consume substantial low-end space. |
| Audio interface | Recommended, not conceptually mandatory | Required when recording or routing external hardware. |
| MIDI pad/keyboard/controller | Optional | Useful for finger-drumming, velocity capture, clip launching and live automation. |
| TR-808/TR-909 hardware or modern TR instrument | Optional | Authentic hardware is unnecessary for learning the rhythm grammar; samples or Roland's official software recreations are valid alternatives. Roland currently offers software TR-808/TR-909 instruments with DAW integration and pattern drag-and-drop. citeturn17search2turn17search0turn16search0turn16search1 |
| Max for Live | Optional | Use only for generative/probabilistic systems not conveniently handled by standard MIDI editing. Max for Live is Ableton's integrated environment for custom MIDI/audio devices and tools. citeturn20view4 |

### Internal MIDI mapping contract

For agent-generated instructions, use **MIDI note numbers as the authoritative identifier** because octave labels can differ between hosts/controllers. The following is a practical internal convention, not a claim that every 808/909 plugin uses these exact assignments:

| Voice | MIDI no. | Agent label |
|---|---:|---|
| Kick / bass drum | 36 | BD |
| Rim | 37 | RS |
| Snare | 38 | SD |
| Clap | 39 | CP |
| Closed hi-hat | 42 | CH |
| Low tom | 45 | LT |
| Open hi-hat | 46 | OH |
| Mid tom | 47 | MT |
| Crash/cymbal | 49 | CY |
| High tom | 50 | HT |
| Ride, especially 909 kits | 51 | RD |
| Cowbell | 56 | CB |

When using a Roland plugin, imported kit or hardware interface, **inspect its actual note map and remap deliberately rather than assuming this table**. The Roland Cloud TR software, for example, supplies defined DAW/MIDI mappings and can place its pattern data into a DAW as MIDI. citeturn16search0turn16search1

## Core rhythmic and sonic model

The agent should treat a programmed drum groove as the interaction of **where, how hard, how late/early, how long and how often** each voice plays.

**Rhythm** is the discrete placement of events. Begin with the minimum pattern that communicates the genre before adding decoration. A 909 house beat can function with quarter-note kick, clap on beats two and four and offbeat hats; Ableton's own Learning Music material presents a classic house beat on a 16-step grid at 120 BPM, and production examples repeatedly use that same skeleton. citeturn18search0turn18search6

**Quantisation** means bringing notes towards a rhythmic grid. Full grid-lock is useful when establishing the skeleton; partial quantisation or selective manual displacement is preferable when retaining played feel. Live also allows groove-based non-destructive quantisation, so an agent can audition timing treatment before committing it. citeturn21view2

Do not equate **quantised** with **bad**. Many classic electronic patterns derive strength from machine precision. Humanisation should therefore answer a musical problem rather than operate as an automatic randomiser.

**Swing** changes the temporal relationship between subdivisions, commonly by delaying alternating subdivisions. Swing is especially important for 909-derived house and shuffled techno, and for many hip-hop grooves. The original TR-909 specifically provides shuffle; contemporary Live offers the Groove Pool, whose timing, random and velocity parameters can reshape MIDI clips non-destructively. citeturn3view1turn21view2turn21view3

A critical convention issue: some production tutorials state swing as a ratio in which **50% means straight**—for example, Attack's techno tutorial specifies 50–65% under exactly that convention. That number is **not automatically equal to a Live Groove Pool control value**. Treat percentages from external tutorials as descriptions of feel, then audition the corresponding groove in Live rather than copying numbers blindly. citeturn18search2

**Velocity** is a per-note MIDI value, conventionally 1–127, but it changes audible loudness only to the extent that the instrument is velocity-sensitive. A sample with no velocity-to-volume or velocity-to-filter mapping can sound virtually identical whether its MIDI velocity is 50 or 120. Simpler provides velocity-related response controls, so configure the instrument before relying on velocity as the mechanism for accents or ghosts. citeturn20view2

Use a simple working hierarchy:

```text
120–127  exceptional accent / fill peak
105–119  strong principal hit
 85–104  normal hit
 65–84   light supporting note
 35–64   ghost note
```

These ranges are **production starting points, not Roland specifications**.

**Accent is not synonymous with velocity.** On Roland-style sequencers, accent can be a shared step-level performance behaviour. Roland's software TR-909 documentation, for example, states that its accents apply on the same step across instruments; software implementations also expose concepts including weak beats, flam, substeps, last-step settings and shuffle. citeturn16search1 In a Live Drum Rack, recreate the *musical result* with velocity, instrument gain/envelopes, MIDI modulation or separate accented samples rather than pretending generic MIDI velocity is electrically identical to the original machine's accent circuit.

**Pattern length** determines how often rhythmic information repeats. Begin with one bar for highly repetitive dance foundations, two bars when kick/snare syncopation needs a call-and-response shape, and four bars only when the additional information is musically justified. At a sixteenth-note resolution in Live:

```text
16 steps = 1 bar of 4/4
32 steps = 2 bars of 4/4
64 steps = 4 bars of 4/4
```

This is a Live-grid convention. Historical TR machines had their own scale/prescale and pattern-length mechanisms; the original 808 manual, for example, also documents extended programming with first/second pattern parts rather than simply being a DAW-style linear clip. citeturn2view1turn3view3

Where supported, **different per-voice lengths** can deliberately produce phasing. A 15-step percussion voice against a 16-step kick shifts its alignment on each loop. Modern Roland software explicitly implements per-instrument LAST STEP behaviour; in Live, the same musical result can be created with independent MIDI clips/tracks, clip envelopes, sequencer devices or MIDI tools. citeturn16search1

**Probability** should be reserved principally for ornamental notes. In current Live, the Chance Editor can assign 0–100% triggering probability to MIDI notes and can form probability groups. citeturn21view0 Recommended logic:

```text
Structural kick / principal snare: 100%
Main hats:                         90–100%
Secondary percussion:             70–95%
Ghost notes:                      40–80%
Fills / unusual accents:          20–60%
```

Do not put a genre-defining backbeat at 50% probability unless instability itself is the artistic intention. On versions without note Chance, create deterministic A/B/C clip variations instead.

**Ghost notes** are quieter supporting events whose job is motion rather than emphasis. They work especially well immediately before or after a snare, between techno kick pulses, or as quiet syncopated kicks in hip-hop. Attack's techno programming example explicitly employs off-grid ghost kicks to introduce human rhythmic nuance. citeturn18search2

**Fills** should signal form. Use them before a new 4-, 8-, 16- or 32-bar phrase, not constantly. Viable 808/909 fill materials include snare flams, tom runs, hat bursts, extra kicks, crashes, open-hat changes and one-beat dropouts. Roland's 909 sequencer heritage includes flam, while the original 808 architecture included automatic fill-related functionality. citeturn3view1turn17search3

**Layering** should assign each layer a job. For example:

```text
Kick layer A: low body / fundamental
Kick layer B: short mid/high transient
Clap: width/noise body
Snare: centre impact
Hat A: pulse
Hat B: occasional brighter accent
```

Do not simply stack three full-band kicks at equal level. Shorten or high-pass a transient layer where appropriate, line up important attacks, listen in mono, and avoid allowing multiple long low-frequency tails to occupy the same rhythmic space. Attack demonstrates a deliberately complementary short/long kick layering strategy in a 909-style house pattern rather than using two redundant full-spectrum kicks. citeturn18search1

**808 bass versus 808 kick.** In modern hip-hop/trap vocabulary, “an 808” often means a long, pitched bass-drum-derived sub/bass part rather than only an unpitched one-shot. Roland's historical writing describes how producers exploited extended 808 kick decay until it became a dominant low-frequency musical element, and modern trap practice develops this further through tuned sustained notes. citeturn19search1turn19search2 Treat such a part as **bass instrumentation**: tune it, give it deliberate note lengths, and manage its overlap with any separate kick.

## Ableton Live execution workflows

The following procedures are the agent's default implementation path.

**Build the 808/909 Drum Rack.**

1. Create a MIDI track and load **Drum Rack**.
2. Drag the chosen kick, snare, clap, closed hat, open hat and percussion samples to deliberately assigned pads. Live automatically creates a Simpler chain when a sample is dropped on an empty pad. citeturn15view1
3. For drum one-shots, use **Simpler → One-Shot** unless there is a reason to require looped/polyphonic playback. One-Shot mode is expressly optimised for monophonic one-shot hits and short phrases. citeturn20view2
4. Trim silence at sample starts and set envelopes before adding effects. A groove with sloppy sample start points cannot be fixed reliably by MIDI quantisation.
5. Put closed and open hats in the same **Drum Rack Choke group** so that triggering the closed hat can cut off the open one. Live provides sixteen choke groups and explicitly cites open/closed hats as a use case. citeturn15view0
6. Establish useful velocity response. For ghost-note-heavy patterns, ensure a lower incoming velocity genuinely reduces the output and, where desirable, slightly changes timbre.
7. Tune the kick and toms to the track context. For long 808-derived bass sounds, tuning is mandatory rather than decorative.

**Alternative: use Sampler.** Choose Sampler when the agent needs multiple velocity layers, multisamples, more elaborate key/velocity zoning or extended modulation. Sampler is Live's more comprehensive multisampling instrument, whereas Simpler is intentionally direct. citeturn20view2 For ordinary one-shot 808/909 programming, Simpler inside a Drum Rack is usually the faster solution.

**Program the MIDI clip.**

Set the clip grid to sixteenth notes and select a loop length. Start with a one-bar 16-step clip for house/techno or two bars for hip-hop/trap/electro patterns requiring longer syncopation.

Use a three-pass method:

```text
Pass A — skeleton
Kick + principal snare/clap only.

Pass B — pulse
Closed/open hats, ride or shaker.

Pass C — detail
Ghosts, percussion, flam, probability, fill notes.
```

Do not introduce groove randomisation during Pass A. First determine whether the pattern works when mechanically quantised.

For a **909 house skeleton**, programme:

```text
BD: 1, 5, 9, 13
CP: 5, 13
OH: 3, 7, 11, 15
```

This is the familiar four-to-the-floor/offbeat-hat structure described in house teaching and 909 production material. citeturn18search0turn18search6turn18search1

For an **808 electro skeleton**, keep snare/clap on 2 and 4 but syncopate the kick around them rather than putting the kick on all four beats. Attack's 808-based electro example uses 125 BPM, straight timing as its initial specification and snare/clap on every second and fourth beat. citeturn19search0

**Apply swing and humanisation.**

Live's Groove Pool can change timing, random timing and velocity while remaining non-destructive until the groove is committed. Low Random settings are explicitly documented as a means of adding subtle humanisation to highly quantised electronic loops. citeturn21view2

Agent rule:

```text
Never randomise the entire kit equally by default.

Kick:      usually least timing randomisation
Backbeat:  small or zero timing shift unless style calls for drag
Hats:      strongest swing candidate
Perc:      moderate swing/randomisation
Ghosts:    intentionally variable
```

For hip-hop, manually moving selected sixteenth notes later often sounds more controlled than globally swinging every event. Native Instruments' hip-hop tutorial demonstrates this relationship between off-grid sixteenths and groove. citeturn18search3

**Add probability only after the deterministic pattern works.**

Where the Live installation has the Chance Editor, assign probabilities to embellishments, not to essential beats. Live's current MIDI editor can set probability per note and randomise probability values within controlled ranges. citeturn21view0

A robust two-bar example:

```text
Principal snare: 100%
Offbeat open hat: 100%
Extra closed hat before beat 4: 65%
Ghost snare after beat 2: 55%
End-of-bar percussion: 40%
```

**Use per-pad and bus routing.**

Drum Rack chains support their own processing and can feed Rack return chains; Live also supports conventional return tracks for shared effects. citeturn15view0turn4search7 A disciplined layout is:

```text
MIDI Drum Rack
│
├─ Kick chain   → corrective EQ / optional saturation
├─ Snare chain  → EQ / saturation
├─ Clap chain   → EQ / optional short reverb send
├─ CH/OH        → HP/tonal EQ / optional saturation
├─ Toms/Perc    → individual shaping
│
├─ Rack Return A → short room/plate
└─ Rack Return B → parallel dirt
        │
        ▼
Drums Group
→ Drum Buss
→ broad EQ if required
→ bus compressor only if required
→ output
```

Do not insert every processor because it appears in the template. Bypass anything that is not solving a problem or creating an intentional effect.

**EQ workflow.**

First fix sound selection and envelope length. Then EQ. For 909-style kicks, remove unwanted mud only after judging the kick against the bass. For hats/percussion, remove genuinely unnecessary low-frequency information rather than applying extreme high-pass filtering automatically. For layered kicks, make each layer spectrally purposeful.

Attack's production tutorials repeatedly demonstrate this functional approach: low-frequency material is removed from clap or high percussion layers, while kick tone is carved only where necessary to leave space for surrounding elements. citeturn18search1turn18search2turn19search0

**Saturator workflow.**

Ableton's Saturator is a waveshaping processor whose curves range from relatively smooth saturation to hard digital clipping; current versions also include a Bass Shaper intended for low-end material such as 808 kicks and synth bass. citeturn20view3

For an agent:

```text
A/B at matched perceived loudness.
Increase Drive until the desired harmonics/transient density appear.
Reduce Output to compensate for gain.
Check low-end integrity.
Then choose Dry/Wet if parallel treatment is preferable.
```

For an 808 bass/kick, the objective is often **audibility on smaller speakers without replacing the fundamental with fuzz**. For 909 hats/claps, saturation can increase density and aggression, but excessive distortion can make the upper spectrum abrasive.

**Drum Buss workflow.**

Drum Buss combines drum-oriented compression, distortion, transient shaping and low-end enhancement; its Boom section can tune a resonant low-frequency enhancement, and its Transients control changes attack/sustain behaviour. citeturn20view3

A conservative starting strategy—not a fixed preset—is:

```text
Drive:       low, increase until character appears
Crunch:      minimal unless upper drums need aggression
Transients:  small positive move for attack, negative when tails are cluttered
Boom:        off initially; add only when the kit genuinely lacks low body
Dry/Wet:     use for intensity control
Output:      gain-match the bypassed signal
```

Do not automatically apply Boom to a kit already containing a long 808 sub.

**Compression workflow.**

Compression is optional. Use it for one of three explicit reasons:

```text
1. Control — contain an excessively dynamic voice.
2. Glue    — gently relate several drum layers.
3. Effect  — deliberately reshape or pump the envelope.
```

Ableton's Glue Compressor is designed principally for group/main-bus-style cohesion, while Drum Buss also contains its own fixed drum-oriented compressor. citeturn15view2turn20view3

For drum-bus glue, aim first for **small audible movement rather than maximal gain reduction**. Attack's 909 tutorial gives a real-world example of slow attack, fast release and roughly 2–3 dB bus gain reduction, but that should be treated as one production example rather than a universal setting. citeturn18search1

**Kick-to-bass sidechain workflow.**

1. Place Compressor on the bass/808-bass track—not on the kick.
2. Open the sidechain controls.
3. Select the kick or an appropriate kick routing point as the external trigger.
4. Lower Threshold until each kick produces the required ducking.
5. Set Ratio according to how obvious the duck should be.
6. Use sufficiently quick attack when the bass must clear the kick transient.
7. Set Release by groove: too short can chatter; too long can hold the bass down into the next musical event.
8. Gain-match and listen in context.

Live's documentation specifically recommends kick-triggered sidechain compression to make basslines or even larger mixes leave room for a dance-music kick. citeturn15view2

A practical starting window is roughly **1–10 ms attack and 50–200 ms release**, but this is an engineering starting point from this guide, not an Ableton specification; tempo, sample decay and desired pumping should determine the final values.

**Step sequencing with hardware/controllers.** If a compatible controller exposes a step sequencer, preserve the same conceptual stages: enter structural notes first, then accents/velocity, then per-step detail. With no dedicated controller, the MIDI editor is already a complete step sequencer. Do not make Push or any specific hardware a requirement.

## Genre pattern templates and MIDI diagrams

The templates below are **original teaching patterns**, not MIDI transcriptions of copyrighted recordings. Their purpose is to encode genre grammar into instructions an agent can execute and then modify.

Legend:

```text
X = strong note, roughly velocity 110–127
x = normal note, roughly velocity 85–109
g = ghost/light note, roughly velocity 40–75
o = open hi-hat
. = rest
R = fast roll/subdivision added at finer grid
```

Tempo ranges are deliberately broad. Ableton's canonical learning example places classic house at 120 BPM; Attack demonstrates 909 house around 120–125 BPM, techno examples around 120–132 BPM depending subtype, and an 808 electro example at 125 BPM. Native Instruments demonstrates hip-hop at 87–88 BPM and trap at 130 BPM, while noting the characteristic use of 32nd-note hat rolls in trap. citeturn18search0turn18search1turn18search2turn18search8turn18search3turn18search6turn19search0

| Genre | Useful starting tempo | Pattern length | Kick programming | Snare/clap | Hi-hats | Swing / timing | Typical treatment |
|---|---:|---:|---|---|---|---|---|
| **House** | 120–128 BPM | 1–2 bars | Four-to-floor: 1/5/9/13; occasional low-velocity pickup | Clap/snare on 5/13 | Open hats on 3/7/11/15; closed hats add sixteenth movement | Straight to noticeably swung depending subgenre; 909 grooves often benefit from hat/percussion swing | Mild saturation, short clap reverb, controlled kick, light bus glue. Ableton and Attack examples support this core structure. citeturn18search0turn18search1turn18search5 |
| **Techno** | 125–135 BPM | 1–2 bars | Usually four-to-floor; ghosts can anticipate/follow main kicks | 2/4 backbeat, reduced backbeat, or textural clap depending style | Repetitive 8ths/16ths; rides/open hats can mark intensity | Straight through shuffled; different parts need not share identical swing | Saturation/distortion, transient shaping, carefully controlled high end; optional send/reverb texture. citeturn18search2turn18search8turn18search9 |
| **Hip-hop** | 80–100 BPM | 2 bars | Syncopated around backbeat and sample/bass phrasing | Strong 2/4 commonly anchors groove | 8ths or 16ths with selected swung notes | Often deliberate swing or individually late notes rather than blanket randomisation | 808-derived low end, saturation, resampling/colour; leave space for sample/vocal. citeturn18search3turn18search6turn19search4 |
| **Trap** | 130–170 BPM, frequently perceived in half-time | 2 bars | Sparse, syncopated; kick and long “808” bass may interlock instead of duplicate each other | Half-time clap/snare commonly centred on beat 3 | 8ths/16ths plus 32nd/triplet rolls and velocity shapes | Main grid often tight; rolls and small note offsets supply detail | Tuned long 808/sub, saturation/clipping as required, rigorous low-end management and selective ducking. A 130 BPM example with beat-3 claps and 32nd hat rolls appears in NI's pattern guide. citeturn18search6 |
| **Electro** | 120–135 BPM | 1–2 bars | Broken/syncopated rather than four-to-floor | 2/4 remains a useful anchor | Crisp 8th/16th hats; open hats strategically placed | Often fairly straight, with targeted syncopation | 808 kick/snare/clap, cowbell/rim/conga colours, restrained saturation/drive. Attack's 808 electro example uses 125 BPM and straight timing. citeturn19search0turn19search2 |

### House: 909-oriented

```text
Step   01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16
BD      X  .  .  . |  X  .  .  . |  X  .  .  . |  X  .  .  .
CP      .  .  .  . |  X  .  .  . |  .  .  .  . |  X  .  .  .
OH      .  .  o  . |  .  .  o  . |  .  .  o  . |  .  .  o  .
CH      .  g  .  x |  .  g  .  x |  .  g  .  x |  .  g  .  x
```

Equivalent event specification:

| Voice | MIDI | Steps | Suggested velocities |
|---|---:|---|---|
| BD | 36 | 1, 5, 9, 13 | 118, 114, 116, 114 |
| CP | 39 | 5, 13 | 108, 112 |
| OH | 46 | 3, 7, 11, 15 | 94, 88, 98, 91 |
| CH | 42 | 2, 4, 6, 8, 10, 12, 14, 16 | alternate approximately 60–90 |

Put OH and CH in the same choke group. Apply swing mostly to the hat/percussion information rather than shifting all four kicks. The musical foundation reflects the classic house structure documented by Ableton and 909 tutorials; the exact velocities above are original recommendations. citeturn18search0turn18search1

### Techno: driven 909

```text
Step   01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16
BD      X  .  .  . |  X  .  .  . |  X  .  g  . |  X  .  .  .
SD/CP   .  .  .  . |  x  .  .  . |  .  .  .  . |  x  .  .  g
CH      x  g  x  g |  X  g  x  g |  x  g  x  g |  X  g  x  g
OH      .  .  o  . |  .  .  o  . |  .  .  o  . |  .  .  o  .
```

The ghost kick at step 11 should be substantially quieter and can be nudged a few milliseconds away from the grid. This follows a technique documented in Attack's analogue-techno example, where 909-based ghost kicks are deliberately shifted to introduce nuance against the rigid four-to-floor foundation. citeturn18search2

At higher energy, add a 909 ride on selected eighths or quarter notes rather than rewriting the kick pattern. Early/Detroit-style 909 production examples often gain complexity from interaction among rim, snare, hats and ride while keeping the kick intentionally functional. citeturn18search8

### Hip-hop: 808-oriented, two bars

```text
BAR A
Step   01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16
BD      X  .  .  g |  .  .  X  . |  .  .  g  . |  X  .  .  .
SD      .  .  .  . |  X  .  .  . |  .  .  .  g |  X  .  .  .
CH      x  .  x  . |  x  .  x  g |  x  .  x  . |  x  .  X  g

BAR B
Step   01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16
BD      X  .  .  . |  .  X  .  . |  g  .  .  X |  .  .  g  .
SD      .  .  .  . |  X  .  .  . |  .  .  .  g |  X  .  .  .
CH      x  .  x  . |  x  .  x  . |  x  g  x  . |  x  .  x  g
```

Start around 88–94 BPM. Apply timing displacement primarily to selected kicks and hats, not every note. Native Instruments' hip-hop demonstration uses 88 BPM and shows how sixteenth-note swing can be created by moving specific notes rather than making the whole pattern imprecise. citeturn18search3

For a more vintage feel, reduce the number of hats instead of adding more velocity randomisation. For a modern low end, extend/tune the 808 kick or use a separate long 808-bass instrument.

### Trap: 808 bass plus half-time snare

```text
BAR A — 16th-note structural grid
Step   01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16
BD      X  .  .  . |  .  x  .  . |  .  .  x  . |  .  .  X  .
CP      .  .  .  . |  .  .  .  . |  X  .  .  . |  .  .  .  .
CH      x  .  x  . |  x  .  x  . |  x  .  x  . |  x  .  x  R

BAR B
Step   01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16
BD      X  .  .  x |  .  .  .  . |  .  X  .  . |  .  .  x  .
CP      .  .  .  . |  .  .  .  . |  X  .  .  . |  .  .  .  .
CH      x  .  x  . |  x  .  x  R |  x  .  x  . |  x  .  x  R
```

For each `R`, temporarily change the editor grid to 1/32 or a triplet grid and replace one ordinary hat with a short roll. A reputable trap-pattern tutorial demonstrates exactly this method—two-bar eighth-note hats, beat-three claps and selective 32nd-note rolls with velocity shaping. citeturn18search6

Do **not** automatically put a separate kick beneath every long 808-bass note. Decide whether the bass sound already has enough transient. When both exist, align them only when reinforcement is required and use arrangement, envelope shaping or sidechain compression to prevent uncontrolled low-frequency overlap. Ableton documents kick-triggered bass ducking as a standard dance-music use of sidechain compression. citeturn15view2

### Electro: TR-808-oriented

```text
Step   01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16
BD      X  .  .  x |  .  .  X  . |  X  .  .  . |  .  X  .  .
SD      .  .  .  . |  X  .  .  . |  .  .  .  . |  X  .  .  .
CP      .  .  .  . |  x  .  .  . |  .  .  .  . |  X  .  .  .
CH      x  .  x  . |  x  .  x  . |  x  .  x  . |  x  .  x  .
OH      .  .  .  o |  .  .  .  . |  .  .  .  o |  .  .  .  .
CB      .  .  x  . |  .  .  .  . |  .  .  x  . |  .  .  .  .
```

Electro should feel **broken and syncopated without becoming rhythmically vague**. The rigid snare/clap gives the listener a reference while kick, cowbell, rim and hat material create counter-rhythm. Roland traces the 808 directly through foundational electro, and a modern Attack recreation of a Cybotron-inspired groove uses Ableton's 808 kit at 125 BPM with snare/clap on beats two and four. citeturn19search2turn19search0

### Quick pattern-generation algorithm for an agent

For an unfamiliar brief, use:

```text
INPUT:
  genre
  desired_energy ∈ {low, medium, high}
  machine_bias ∈ {808, 909, hybrid}
  tempo
  loop_bars

1. Choose structural grammar:
   house/techno → start with quarter kick
   hip-hop      → start with 2/4 backbeat, then syncopate kick
   trap         → start with half-time snare, then kick + 808 bass
   electro      → start with 2/4 snare and broken kick

2. Add pulse:
   8th hats → sparse/clear
   16th hats → driving
   offbeat OH → house/techno propulsion

3. Add at most 1–3 secondary motifs.

4. Establish velocity hierarchy.

5. Apply swing selectively.

6. Add maximum 1–2 probabilistic ideas per bar initially.

7. Duplicate to variation B.

8. Change only 10–25% of events in B.

9. Add fill C for phrase ending.

10. Process only after A/B/C groove works dry.
```

The numerical limits in this algorithm are editorial constraints designed to stop an agent from over-programming; they are not specifications of the Roland machines.

## Variation, arrangement, humanisation and performance

A successful drum-machine pattern should contain both **identity** and **controlled instability**. Identity comes from notes that almost never change—the principal kick/snare relationship, for example. Instability comes from hats, ghosts, fills, timbre and occasional omissions.

Use an **A/A′/B/F** pattern family rather than continually generating unrelated loops:

```text
A   = canonical groove
A′  = A + one or two subtle changes
B   = recognisable groove with a stronger rhythmic change
F   = fill/turnaround

Example 16-bar phrase:

Bars  1–4   A  A  A  A′
Bars  5–8   A  A  B  A′
Bars  9–12  A  A  A  B
Bars 13–16  A  A′ B  F
```

This keeps the listener oriented while allowing phrase-level development. In Live, these can be separate Session View clips or duplicated regions in Arrangement View. Clip launch quantisation and Follow Actions can automate controlled clip transitions, including probabilistic behaviour, where the installed Live version supports those features. citeturn13search1

**Vary density before replacing the fundamental rhythm.** Effective transformations include:

```text
Low energy:
kick + closed hat only

Medium:
+ clap/snare + open hats

High:
+ ride/shaker + more active 16ths

Peak:
+ crash, stronger accents, selected fills

Break:
remove kick or low end; retain clap/percussion cue

Drop:
restore kick and bass before reintroducing all decoration
```

For 909-based techno, adding a ride is often a more effective energy change than writing a new kick rhythm. For 808 hip-hop/electro, changing one syncopated kick or open-hat placement can create a larger perceived variation because the pattern is more spacious.

**Use silence as an event.** Removing the kick for the last sixteenth, eighth, quarter beat or whole bar before a section change can create a stronger arrival than adding a dense fill.

**Humanisation should be hierarchical.** Live's Groove Pool can introduce random timing and groove-derived velocity, and its documentation specifically recommends low Random amounts for subtle humanisation. citeturn21view2turn21view3 Nevertheless, randomisation should follow role:

| Element | Timing | Velocity | Probability |
|---|---|---|---|
| Main kick | Very stable | Small variation or none | 100% |
| Main snare/clap | Stable or deliberately laid-back | Moderate accents possible | Usually 100% |
| Closed hats | Good swing/microtiming target | Strong alternating pattern useful | Main hats high probability |
| Open hats | Moderately stable | Vary modestly | Some omissions can work |
| Ghosts | Freer | Low | Ideal probability target |
| Percussion | Freer still | Broad variation | Often 50–95% |
| Fill notes | Intentional, not random | Phrase-dependent | Can be conditional/low probability |

**Velocity is not a substitute for sample variation.** A quieter playback of one exact sample is still recognisably the same waveform. For a more organic result, layer alternative hits, subtly alter pitch/decay, or use two related samples in alternation. Conversely, historical machine character may benefit from *less* variation than acoustic-drum simulation.

**Microtiming should establish relationships.** A good humanisation instruction is “move this ghost snare 8 ms late relative to the backbeat”; a poor instruction is “randomise everything ±12 ms”. The latter can smear kick/clap transients and weaken groove.

**Layer timing intentionally.** A clap layered with a snare need not start at the exact same sample. Offsetting one by a few milliseconds can widen the apparent transient or create a flam-like event, but increasing the offset too far produces an obvious double hit. Native Instruments' producer material also describes slight offsets, envelope changes and small rhythmic details as useful mechanisms for house groove. citeturn7search6

**Fills should be contrastive.** Examples:

```text
909 house:
bar-end snare/clap grace note → crash on next downbeat

909 techno:
16th snare/tom run in final half-beat
or remove final kick then hit crash/ride at next bar

808 hip-hop:
kick pickup + open hat before next one

trap:
1/32 or triplet hat roll + pitch/velocity contour

electro:
tom/conga/cowbell exchange across last quarter beat
```

The original 909's flam capability and current Roland software's weak/flam/substep facilities make this kind of per-step detail historically consistent with the TR sequencing tradition. citeturn3view1turn16search5

**Live performance.** Build clips so that the performer can remove components as well as add them. A practical Session View layout is:

```text
Scene        Drums clip               Function
INTRO        HAT_A                    establish pulse
GROOVE_A     FULL_A                   main groove
GROOVE_A2    FULL_A_VARIANT           subtle change
GROOVE_B     FULL_B                   alternate kick/percussion
BREAK        NO_KICK                  transition
BUILD        BUILD_16                 denser hats / snare
FILL         FILL_1BAR                one-bar turnaround
DROP         FULL_A_RIDE              peak return
```

Set clip-launch quantisation so rhythmic clips enter at musically safe boundaries. Live's launch system exists precisely to synchronise clip triggering to defined rhythmic intervals. citeturn13search1

Map a controller to **mute/solo, Drum Buss Dry/Wet or Drive, reverb send, delay send, filter, hat decay and fill/clip launch controls**, but limit simultaneous macro changes. The goal of performance control is legible musical transformation, not continuous parameter activity.

When using probability live, preserve a deterministic emergency state: a clip containing the core kick/snare pattern at 100% probability. Random systems should be something the performer can exit instantly.

## Troubleshooting, template structure and recommended resources

The diagnostic principle is **fix the earliest cause in the signal chain**. Do not reach for master processing when the true problem is note placement or sample selection.

| Symptom | Likely cause | Corrective sequence |
|---|---|---|
| Groove feels robotic | Every voice has identical velocity/timing; hats lack hierarchy | First vary hat velocity; then add selective groove/microtiming; only then add tiny randomisation. Live supports separate timing/random/velocity groove controls. citeturn21view2turn21view3 |
| Groove feels sloppy | Too much random timing or swing applied to structural drums | Remove randomisation from kick/backbeat; reduce Groove Amount; reintroduce timing changes voice by voice. |
| House groove does not propel | Missing/off-balance offbeat hats; kick decay wrong; swing contradicts hats | Reinstate quarter kick and offbeat hats, tune hat decay/choke, then audition swing. This skeleton is documented in classic house examples. citeturn18search0turn18search6 |
| Techno lacks power | Kick sound/envelope weak; low-end overlap; too many decorative hits | Solo kick+bass, adjust sound/decay first, restore four-to-floor stability, then add layers. 909 techno examples commonly keep the kick deliberately straightforward. citeturn18search8turn18search2 |
| 808 is huge but indistinct | Excessively long decay; sub and kick overlap; saturation is obscuring transient | Shorten decay or note length; tune; remove unnecessary lows from competing parts; then use controlled saturation/sidechain. |
| Trap low end clicks or blurs | Overlapping long bass notes; bad sample start/end; excessive clipping | Correct envelopes/voice behaviour first, then tune notes and manage overlaps before processing. |
| Hats sound fake | Same sample, same velocity, same decay on every event | Alternate dynamics; use choke groups; vary decay or sample choice; swing selected events. Drum Rack choke groups are intended for hat interactions. citeturn15view0 |
| Hats smear together | Open hat is not being choked | Put open/closed hats into same Drum Rack choke group. citeturn15view0 |
| Snare/clap is too wide or hollow | Layer phase/timing mismatch | Solo layers; align or intentionally separate starts; test each alone and in mono; retain only layers with distinct jobs. |
| Drum bus is louder but not better | Processing is being judged with a level bias | Match processed output level to bypass; then decide whether Drum Buss/Saturator/compression actually improves tone. |
| Saturation destroys the sub | Too much low-frequency drive | Reduce Drive; use parallel processing or frequency-conscious saturation; current Saturator provides low-frequency-oriented shaping controls including Bass Shaper. citeturn20view3 |
| Sidechain pumps unnaturally | Release is mismatched to tempo; threshold/ratio excessive | Reduce gain reduction and set release so bass recovers musically between kick events. Live permits using the kick as an external compressor trigger. citeturn15view2 |
| MIDI velocity has little audible effect | Instrument has insufficient velocity response | Configure Simpler/Sampler velocity modulation or use level/filter/alternate-sample mapping. citeturn20view2 |
| Probability ruins the beat | Structural events have been made uncertain | Restore core kick/snare to 100%; reserve Chance for ornaments. Current Live supports per-note probability and grouped probability. citeturn21view0 |
| Project opens with missing drums | Samples remain external to the Project | Use Live's File Manager or **Collect All and Save**; Ableton says external audio is copied into `Samples/Collected`, while used Max devices are collected into `Presets`. Plug-ins themselves must still be installed separately. citeturn21view4turn21view5 |

### Recommended Ableton template structure

Use **one Live Project for the drum-programming system or song**, with related Set versions inside that project. Live defines a Project as the folder that keeps associated Sets, samples and presets together and supports subfolders within it. citeturn21view5

A robust agent-managed project might look like:

```text
TR_Drum_Agent_Project/
│
├── TR_Drum_Agent_Template.als
├── Sets/
│   ├── 808_Electro_v01.als
│   ├── 808_HipHop_v01.als
│   ├── 808_Trap_v01.als
│   ├── 909_House_v01.als
│   └── 909_Techno_v01.als
│
├── Samples/
│   ├── Imported/
│   │   ├── 808/
│   │   │   ├── Kick/
│   │   │   ├── Snare/
│   │   │   ├── Clap/
│   │   │   ├── Hats/
│   │   │   └── Perc/
│   │   └── 909/
│   │       ├── Kick/
│   │       ├── Snare/
│   │       ├── Clap/
│   │       ├── Hats/
│   │       ├── Toms/
│   │       └── Cymbals/
│   └── Collected/              ← Live may populate via Collect All and Save
│
├── Presets/
│   ├── Drum_Racks/
│   │   ├── 808_AGENT.adg
│   │   ├── 909_AGENT.adg
│   │   └── HYBRID_AGENT.adg
│   ├── Audio_Effects/
│   └── Max_MIDI/
│
├── MIDI/
│   ├── House/
│   ├── Techno/
│   ├── HipHop/
│   ├── Trap/
│   └── Electro/
│
└── Documentation/
    ├── kit_mapping.md
    ├── pattern_library.md
    └── processing_notes.md
```

Live's actual project-management system may create/manage certain directories itself; the hierarchy above is therefore a **logical organisational proposal**, not a requirement to override Live's automatic folder management. After moving samples or changing internal organisation outside Live, use its File Manager to confirm references. Live's documentation warns that external references can break if their source files move and provides Collect All and Save specifically to prevent this. citeturn21view5turn21view4

Inside the template Set, use a track hierarchy such as:

```text
DRUMS
├── TR DRUM RACK
├── 808 BASS            [when bass is separate from rack kick]
├── PERC EXTRA
├── PRINT / RESAMPLE
└── SIDECHAIN GHOST     [optional silent trigger pattern]

Returns
├── A SHORT ROOM
├── B LONG/FX REVERB
├── C DELAY
└── D PARALLEL DIRT
```

A silent or separately routed sidechain trigger can be useful when the audible kick pattern should change without changing the amount/timing of bass ducking. This is an advanced production technique rather than a Roland-specific requirement.

### Recommended samples, instruments and learning resources

**First choice: Ableton Drum Machines.** Ableton's official Drum Machines Pack contains meticulously sampled classic drum machines at 24-bit/96 kHz, packaged as Drum Racks with effects/routing plus MIDI patterns across electronic styles. It is particularly useful for an agent because it provides both sounds and examples of Live-native organisation. citeturn16search2

**First choice for an officially modelled Roland instrument: Roland Cloud TR-808 and TR-909.** Roland's software recreations model the original instruments and extend them with DAW-friendly features. Their manuals document pattern variations, shuffle, last-step controls and MIDI/audio drag-and-drop into a DAW. citeturn17search2turn17search0turn16search0turn16search1 These are preferable references when the objective is “Roland-style behaviour” rather than simply finding samples carrying an 808/909 label.

**High-quality third-party sample option: Samples From Mars.** Its catalogue currently includes dedicated 808 and 909 material as both WAV/sample and Ableton-oriented products; this is useful when a producer prefers recorded hardware samples to a modelled instrument. citeturn16search3 Treat it as a commercial third-party option, not as an authority on Roland specifications.

**Free experimental supplement: MusicRadar SampleRadar.** MusicRadar has published royalty-free processed and hardware drum-machine sets that include 808/909 material. These are more appropriate for colour and experimentation than for building a historically neutral reference kit. citeturn16news47turn16news50

**Pattern study: Ableton Learning Music.** Its browser-based classic-house lesson provides a simple 16-step visual reference and is unusually useful for validating basic MIDI-grid reasoning. citeturn18search0

**Pattern study: Attack Magazine's Beat Dissected.** Its 909 house, analogue-techno, Detroit-techno and 808 electro tutorials expose the actual grid, tempo, swing assumptions, sample decisions and processing sequence rather than discussing genre only in broad terms. citeturn18search1turn18search2turn18search8turn19search0

**Hip-hop/trap study: Native Instruments' drum programming material.** Its examples provide particularly clear descriptions of swing placement, trap's half-time clap relationship and 32nd-note hat-roll programming. citeturn18search3turn18search6

### Optional Max for Live extension

Use Max for Live only when standard Live probability, clip variants or grooves cannot express the desired system. For example, an agent might create a MIDI device that passes ghost notes according to a probability while always preserving structural notes. Ableton supports custom Max for Live MIDI devices and MIDI tools; Cycling '74 supplies the underlying Max MIDI programming documentation. citeturn20view4turn9search3turn9search6

A conceptual Max object flow is:

```text
incoming MIDI
    │
    ├── detect note number
    │
    ├── structural note?
    │      ├── yes ───────────────► pass unchanged
    │      │
    │      └── no
    │           │
    │        random 0–99
    │           │
    │        < probability
    │           │
    │           ├── true ─────────► pass note
    │           └── false ────────► suppress note
    │
    └── preserve correct note-on/note-off pairing
```

An implementation should use Max's MIDI parsing/formatting facilities and explicitly preserve note-on/note-off pairs; Cycling '74's MIDI documentation should be followed rather than constructing a device that can leave stuck notes. citeturn9search6 In current versions of Live that already expose per-note Chance, however, the native feature is usually the simpler choice. citeturn21view0

### Agent validation checklist

Before declaring a pattern finished, the agent should answer all of these questions:

| Test | Pass condition |
|---|---|
| **Genre read** | Can the groove's broad genre be inferred with effects bypassed? |
| **Machine read** | Does the 808/909 choice affect rhythm and envelopes, not only sample names? |
| **Structural clarity** | Kick and principal snare/clap remain intelligible without percussion. |
| **Hat logic** | Open/closed hat interaction sounds intentional; choke behaviour is correct where required. |
| **Dynamics** | Strong, normal and ghost events are audibly differentiated. |
| **Timing** | Swing/humanisation increases groove rather than merely reducing accuracy. |
| **Variation** | At least one subtle variation and one phrase-ending strategy exist. |
| **Low end** | Kick/808-bass tails do not obscure one another unintentionally. |
| **Processing** | Every device has an articulated purpose; level-matched bypass is not clearly better. |
| **Arrangement** | Density changes across musical sections rather than the full kit running constantly. |
| **Performance safety** | A deterministic core groove remains available if probabilities/generative behaviour become undesirable. |
| **Project portability** | Relevant samples have been collected and external plug-in dependencies documented. Ableton notes that Collect All and Save collects audio/Max devices but does not copy third-party plug-ins themselves. citeturn21view4 |

**Final agent principle:** the target is not “make the pattern complicated”. It is **make every event explainable**. The kick establishes weight, the snare/clap establishes orientation, hats establish subdivision, ghosts establish motion, fills establish form, and processing establishes character. The enduring usefulness of both TR machines comes partly from this economy: relatively restricted voice sets and step-oriented programming produced rhythmic systems that could be simple enough to understand immediately yet variable enough to underpin hip-hop, electro, house and techno. Roland's historical material and contemporary recreations document precisely that unusually durable relationship between a compact sequencer, distinctive synthesis and genre formation. citeturn17search4turn17search1turn19search2turn17search19

### Primary and recommended source links

| Source | Relevance |
|---|---|
| [Ableton Reference Manual — Instrument, Drum and Effect Racks](https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/) | Drum Rack chains, pads, choke groups, sends, Simpler creation. citeturn15view0turn15view1 |
| [Ableton Reference Manual — Editing MIDI](https://www.ableton.com/en/live-manual/12/editing-midi/) | MIDI note editing and current probability/Chance functionality. citeturn21view0 |
| [Ableton Reference Manual — Using Grooves](https://www.ableton.com/en/live-manual/12/using-grooves/) | Quantisation, groove timing, randomisation and velocity. citeturn21view2turn21view3 |
| [Ableton Reference Manual — Live Instrument Reference](https://www.ableton.com/en/manual/live-instrument-reference/) | Simpler, One-Shot, Sampler and sample playback. citeturn20view2 |
| [Ableton Reference Manual — Audio Effects](https://www.ableton.com/en/live-manual/12/live-audio-effect-reference/) | Drum Buss, Compressor, Glue Compressor, Saturator and sidechaining. citeturn20view3turn15view2 |
| [Ableton — Drum Machines Pack](https://www.ableton.com/en/packs/drum-machines/) | Official sampled classic-machine Drum Racks, effects and MIDI patterns. citeturn16search2 |
| [Ableton — Collect All and Save](https://help.ableton.com/hc/en-us/articles/209775645-Collect-All-and-Save) | Reliable project portability and sample collection. citeturn21view4 |
| [Ableton Reference Manual — Managing Files and Sets](https://www.ableton.com/en/live-manual/12/managing-files-and-sets/) | Live Project/file organisation. citeturn21view5 |
| [Roland — Original TR-808 Owner's Manual](https://cdn.roland.com/assets/media/pdf/TR-808_OM.pdf) | Original step-sequencer, pattern and fill workflow. citeturn2view1turn3view3 |
| [Roland — TR-808 Technical Specifications](https://support.roland.com/hc/en-us/articles/201963539-TR-808-Technical-Specifications) | Original voice set, controls and specifications. citeturn17search3 |
| [Roland — The TR-808 Story](https://www.roland.com/uk/promos/roland_tr-808/?lang=en-GB) | Analogue architecture and historical context. citeturn17search4 |
| [Roland — Original TR-909 Owner's Manual](https://cdn.roland.com/assets/media/pdf/TR-909_OM.pdf) | Original step writing, accent, shuffle and flam reference. citeturn3view1turn3view2 |
| [Roland — TR-909 Technical Specifications](https://support.roland.com/hc/en-us/articles/201921899-TR-909-Technical-Specifications) | Original 909 instrument/control specification. citeturn17search12 |
| [Roland — The TR-909 Story](https://www.roland.com/uk/promos/roland_tr-909/?lang=en-GB) | 909 hybrid analogue/digital design and historical context. citeturn17search1 |
| [Roland — TR-808 Software Rhythm Composer](https://www.roland.com/uk/products/rc_tr-808/) | Official modelled 808 software implementation. citeturn17search2 |
| [Roland — TR-909 Software Rhythm Composer](https://www.roland.com/uk/products/rc_tr-909/) | Official modelled 909 implementation and architecture. citeturn17search0 |
| [Ableton Learning Music — Rock and House](https://learningmusic.ableton.com/make-beats/rock-and-house.html) | Clear interactive classic-house grid. citeturn18search0 |
| [Attack Magazine — Driven 909](https://www.attackmagazine.com/technique/beat-dissected/driven-909/) | Detailed 909/Ableton house programming and processing. citeturn18search1 |
| [Attack Magazine — Grinding Analogue Techno](https://www.attackmagazine.com/technique/beat-dissected/grinding-analogue-techno/) | 909-style techno, ghost notes, swing and saturation. citeturn18search2 |
| [Attack Magazine — Motor City Techno](https://www.attackmagazine.com/technique/beat-dissected/motor-city-detroit-techno/) | 909-based Detroit-techno programming. citeturn18search8 |
| [Attack Magazine — Electro inspired by Cybotron's “Clear”](https://www.attackmagazine.com/technique/beat-dissected/how-to-make-an-electro-beat-inspired-by-cybotrons-clear/) | Ableton stock 808/electro example. citeturn19search0 |
| [Native Instruments — Hip-hop drums](https://blog.native-instruments.com/hip-hop-drums-101/) | Swing and hip-hop pattern construction. citeturn18search3 |
| [Native Instruments — Drum patterns](https://blog.native-instruments.com/drum-patterns/) | House, hip-hop and trap pattern examples including trap rolls. citeturn18search6 |
| [Samples From Mars](https://samplesfrommars.com/products/all-products-from-mars) | Third-party recorded 808/909 sample-library option. citeturn16search3 |
| [Cycling '74 — Max MIDI note management](https://docs.cycling74.com/learn/articles/midichapter02/) | Primary documentation for custom Max MIDI processing. citeturn9search6 |