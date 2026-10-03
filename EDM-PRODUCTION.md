# Expert Codex Agent for Electronic Music Production in Ableton Live

## Deliverable

I built the production agent as **`AGENTS.md` rather than `agent.md`**, because `AGENTS.md` is the filename Codex natively discovers and loads as project guidance before it begins work. Codex can layer a global instruction file with repository and subdirectory-specific instructions, with more local guidance taking precedence. citeturn26view1turn26view2

**[Download the finished Ableton Electronic Music Production `AGENTS.md`](sandbox:/mnt/data/AGENTS.md)**

The file is **28,740 bytes**. That is deliberate: Codex's default `project_doc_max_bytes` limit is **32 KiB**, so this version fits below the default cap when used as the principal project-level instruction file. OpenAI also documents that the limit can be raised or instructions split across nested directories if a larger hierarchy is needed. citeturn26view0turn26view3

This is not simply a generic "act like a music producer" prompt. It is an operational production system covering composition, rhythm, harmony, arrangement, synthesis, layering, low end, mixing, mastering, Ableton-native workflow, generated MIDI patterns, racks/macros, project hygiene and verification.

## Research synthesis

One important correction emerged from researching your source list: **the supplied videos are not all EDMProd videos**. The collection is better understood as an electronic-production curriculum centred on EDMProd but supplemented by specialist creators. For example, the supplied `JE3QM_9sljI` is Red Means Recording's *Fundamentals of Rhythm for Electronic Music*, while `JcjT7zgs6cs` is Underdog Electronic Music School's *Music Theory for Techno*. citeturn28search3turn22search0 Another supplied source, `BsGCGB_LZAo`, is an EDM Tips sound-design tutorial rather than EDMProd. citeturn4search1 I therefore avoided falsely attributing every technique to EDMProd.

EDMProd's own material points towards a particularly useful philosophy for an autonomous production agent: **learn by completing music rather than collecting disconnected tricks**. Its course catalogue is organised around songwriting, sound design, workflow, mixing, mastering and finishing, while its Foundations programme emphasises constructing complete tracks from an empty project through arrangement and final polish. The specific production skills highlighted include tension and release, transitions and automation, drum layering, variation between repeated sections, working around vocals, group processing and the "last 10%" of finishing. citeturn3search0turn3search3turn3search4

That is why the agent's highest-level hierarchy is:

> **idea → groove → harmony/melody → arrangement → sound design → balance → processing → automation → master**

This prevents Codex from behaving like a plug-in recommendation bot. It is instructed to solve musical problems before technical ones: a weak motif gets rewritten before being compressed; a crowded arrangement gets simplified before being surgically EQ'd; poor kick/bass interaction gets addressed through rhythm, envelope and selection before limiting.

EDMProd's current Ableton training also supports treating Live as an end-to-end production environment rather than merely a mixing host. Its beginner course moves through Session versus Arrangement, track and mixer architecture, Drum Rack, warping, MIDI timing and velocity, 808s, Scale Mode, chords and melodies, effects, transitions, automation, audio recording, vocal processing, arrangement, mixing, export and project management. citeturn4search2 Its composition material separately emphasises drum variation, bassline writing, piano-roll technique, hooks, melody writing and a **rhythm-first** approach to melodies. citeturn4search8

I encoded those concepts as a production decision tree rather than reproducing tutorial steps verbatim.

## Musical intelligence encoded in the agent

### Rhythm and groove

The strongest source here was Red Means Recording's supplied rhythm tutorial and accompanying first-party transcript. It treats rhythm as placement of sound in time, distinguishes structurally strong beats from offbeats and weaker subdivisions, explains swing as displacement of underlying subdivisions, and shows how percussion occupying different subdivisions can define groove. citeturn28search3

The particularly useful idea for an agent is **phrase-level repetition with controlled variation**. The tutorial describes an A/B/A/C-style progression of small variations and a larger phrase-ending variation, with fills or deliberate emptiness used to shape anticipation. citeturn28search3

The resulting `AGENTS.md` tells Codex to construct rhythm in layers:

**pulse → backbeat/anchor → offbeat movement → bass interaction → syncopation → phrase variation**

It also explicitly prevents a common AI-production failure: random "humanisation". Timing and velocity are changed only when they contribute to feel. A groove is supposed to survive after melodic and atmospheric layers are muted.

### Harmony, melody and techno

The agent treats music theory as a **constraint and vocabulary rather than a rule-enforcement system**. This is especially important for electronic music, where repetitive motifs, modal ambiguity, timbral development and dissonance often perform jobs that would be carried by harmonic progression in other genres.

The supplied Underdog *Music Theory for Techno* material specifically frames conventional theory in relation to techno while exploring scales, intervals, dissonance, ostinato/repetition, harmonic architecture and repetitive riff strategies. citeturn22search0

Accordingly, the agent knows that a one- or two-note ostinato is not automatically "too simple". Its job is to ask whether the surrounding timbre, rhythm, automation and arrangement make the repetition meaningful.

For more melodic material, it uses a compact-hook model: establish a short motif, make its **rhythm identifiable**, then vary a controlled dimension such as final note, octave, articulation, harmony, timbre or call-and-response. That is deliberately compatible with EDMProd's rhythm-first melody and hook-oriented composition teaching. citeturn4search8

### Sound design

The supplied sound-design material reinforced a very useful sequence: **decide what the synth is supposed to do before designing it**. The surfaced tutorial `BsGCGB_LZAo` progresses from defining the sound's job and foundation through movement, velocity/LFO modulation, aggression, width/layering, effects, reverb/delay, ambience ducking, mono checking and mix fit. citeturn4search1

The agent therefore uses this sound-design chain:

> **job → source → register → amplitude envelope → spectral shape → modulation → character → size → space → mix fit**

That ordering matters. It discourages the "eight voices of unison + huge reverb + random distortion" approach to making something sound expensive.

The layering rules are equally strict. A layer must provide a function such as transient, body, sub, harmonic richness, stereo width, noise/air or acoustic texture. If muting it does not materially weaken the target sound, the agent is instructed to delete or redesign it.

### Arrangement and finishing

EDMProd's full-track methodology strongly influenced the arrangement section. Its course material puts explicit emphasis on tension/release, automation-based transitions, drum layering, variation, creating a distinct later drop, full-track construction and final polish. citeturn3search4

Consequently, the agent thinks in terms of an **energy map**, not a list of standard EDM sections.

For each section it considers focal element, low-end density, drum density, harmonic density, brightness, width, ambience, rhythmic activity and the transition into the next state.

A particularly important rule is:

> **Before adding something for contrast, test subtracting something.**

Removing the kick, sub, hats, width, reverb, final beat or hook can generate considerably more tension than another riser or layer. That principle is built directly into the arrangement protocol.

The second drop/chorus is also not allowed to become a mindless copy. The file asks for at least one deliberate development—drum turnaround, changed hook ending, octave shift, altered voicing, counter-line, texture, ambience or automation state—while retaining enough of the original identity for recognition.

## Ableton-native implementation

The agent is designed around Live rather than around abstract DAW terminology.

Ableton officially distinguishes MIDI effects, instruments and audio effects according to signal type, and its Racks can package combinations of devices into reusable structures. citeturn23search6 Live's Rack system includes Instrument, Drum, Audio Effect and MIDI Effect Racks, supports parallel chains, and lets Macro Controls address multiple parameters. Macro Variations can store and recall different macro states. citeturn23search2

Those capabilities become explicit agent behaviours. It knows when to propose:

| Production need | Preferred Ableton construct |
|---|---|
| Drum kit and per-hit processing | Drum Rack |
| Layered synth/instrument | Instrument Rack |
| Parallel dry/wet or character processing | Audio Effect Rack |
| Reusable note-processing system | MIDI Effect Rack |
| Simplified performance control | Rack Macros |
| Verse/build/drop states | Macro Variations |
| Shared ambience | Return tracks |
| Arrangement development | Automation |
| Kick/bass or foreground/background separation | Sidechain dynamics |

Live's automation system can record changes to practically all mixer and device controls, including tempo. citeturn23search3 Rather than treating that merely as a technical feature, the agent treats automation as an **arrangement instrument**: filter state, send level, delay feedback, reverb, distortion, timbre, width and transition processing become ways to change musical energy over time.

The rack-design section is particularly suited to Codex because it translates complex chains into specifications that can later be implemented through a compatible Live-control/Max for Live/MCP/OSC bridge. Macros are named by outcome rather than device jargon:

```text
BRIGHTNESS
BITE
BODY
MOVEMENT
WIDTH
SPACE
DELAY THROW
PUMP
DIRT
BUILD
RELEASE
```

It also encourages useful Macro Variations such as:

```text
CLEAN
VERSE
BUILD
DROP
WIDE
DRY
BREAKDOWN
```

The key design rule is that a macro should create a **musically meaningful move**, not simply conceal a parameter.

## Codex behaviour and safeguards

The most important architectural decision was to separate **production expertise from imaginary DAW control**.

A text agent can easily fall into the trap of saying "I've EQ'd your bass" merely because it wrote instructions describing an EQ. This `AGENTS.md` explicitly forbids that. Codex must distinguish between:

**Observed** — something it actually inspected or measured.

**Changed** — something it actually modified using an available interface.

**Proposed** — an Ableton action it recommends but has not executed.

**Inferred** — a conclusion supported by project information without direct listening or measurement.

This makes the agent suitable for gradually extending into genuine Ableton automation. It can work conservatively today with MIDI, audio files, notes, scripts, device specifications and rack plans, while using an actual Max for Live, OSC, MCP or other control layer later if one exists in the project. It must never claim a `.als` Set changed merely because it generated a text description.

I also avoided hard-coding dubious universal production numbers. The agent states that parameter values are **hypotheses to test**, not commandments. It therefore will not automatically say "high-pass everything at 100 Hz", "sidechain by exactly 6 dB", or "master every track to the same LUFS figure". Instead it has to identify the reason for the processing, provide a starting point where useful and specify how to verify it.

Its mixing order is deliberately conservative:

> **static balance → kick/bass relationship → placement → corrective EQ → dynamics → saturation → space → automation → master**

It includes level-aware referencing, mono checks, kick/sub verification, ambience-tail checks and explicit export settings.

For broad prompts such as *"make this track better"*, it uses a **weakest-link method**. It finds the single highest-leverage problem, fixes or proposes that first, and reassesses instead of stacking ten speculative plug-ins.

The response contract inside the agent gives future Codex sessions a consistent structure:

```markdown
### Production diagnosis
What is actually holding the track back?

### Action plan
What are the smallest high-impact changes?

### Ableton moves
Exactly what should happen in Live?

### Verification
How do we know the change worked?

### Files changed
What did Codex really create or modify?
```

That is intentionally closer to an engineering workflow than an inspirational chatbot.

## Using the agent in Codex

Place the downloaded file at the root of the repository or working directory you use for the Ableton project:

```text
your-music-project/
├── AGENTS.md
├── Ableton/
├── MIDI/
├── Renders/
├── Stems/
├── Presets/
├── Racks/
├── References/
├── Notes/
└── Scripts/
```

Codex reads `AGENTS.md` automatically before it works. OpenAI's current discovery rules walk from the project root towards the current working directory, checking for `AGENTS.override.md`, then `AGENTS.md`, and allowing more local instructions to override broader ones. citeturn26view1

That means the file I created can serve as your **global production brain**, while later projects can have narrower overrides. For example, a techno project could add a local file with artist references and sound palette, while a drum-and-bass project could specify its BPM range, break workflow and bass instruments without rewriting the main producer agent.

The agent already contains adaptations for house, techno, drum and bass, dubstep/bass music, UK garage, melodic bass/future bass/electronic pop and ambient/downtempo, while explicitly treating genre conventions as priors rather than laws.

OpenAI also documents a direct verification method: ask Codex to summarise the active instructions or report which instruction sources it loaded. citeturn26view0 A practical first invocation after placing the file is therefore:

```text
Read the active AGENTS.md and act as my Ableton production director.

Audit this project before changing anything.
Identify the weakest link in:
1. core idea
2. groove
3. harmony/melody
4. arrangement
5. sound design
6. low end
7. mix
8. finishing

Give me the highest-impact intervention first.
Do not claim you changed or heard anything you cannot actually access.
```

Then, once audio/MIDI or a genuine Live-control interface is available, a more operational request can be:

```text
Analyse the current drop against the preceding build.

Preserve the core hook, but make the drop feel materially larger through
arrangement, rhythm, sound design and contrast before resorting to loudness.

Create any MIDI or supporting artefacts you can create directly.
For Ableton changes you cannot execute, give exact Live actions and a
verification test.
```

## Research coverage and limitations

The final agent incorporates **all twenty-five supplied YouTube IDs in its research-basis section**, so the original study set remains attached to the instruction file.

For the deeper synthesis, I used material that could be verified reliably through indexed video metadata, creator material and associated first-party resources, then cross-checked the Ableton-specific implementation against Ableton's official Live documentation and the Codex packaging against OpenAI's current documentation. EDMProd's official material was especially useful for complete-track workflow, finishing and Ableton structure; Red Means Recording supplied a particularly detailed first-party rhythm transcript; the Underdog material supplied techno-specific theory; and the surfaced sound-design material supplied the role-first synthesis/layering perspective. citeturn3search3turn3search4turn4search2turn28search3turn22search0turn4search1

I could **not verify a complete transcript for every one of the twenty-five YouTube URLs through the available web index**, so I have not pretended that every sentence of every video was ingested. Where a supplied video did not expose reliable transcript-level material, I used it as part of the research corpus but did not invent specific teachings for it. That is why the resulting file is a synthesis of the strongly supported recurring production principles rather than a fabricated video-by-video transcript summary.

The result is a **28.7 KB production operating system for Codex**, rather than a collection of tutorial notes: it tells the agent how to diagnose, compose, arrange, design, mix, verify and finish music in an Ableton-centred workflow while remaining honest about what it can actually manipulate.

**[Download `AGENTS.md`](sandbox:/mnt/data/AGENTS.md)**