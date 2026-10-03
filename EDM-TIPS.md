# EDM Tips Expert Pack for an Ableton Codex Agent

## Deliverable

The compiled expert context is ready:

**[Download `edm_tips_expert.md`](sandbox:/mnt/data/edm_tips_expert.md)**

The file is a **40 KB operational knowledge document**, written as instructions for an Ableton/Codex-style production agent rather than as ordinary tutorial notes. It converts the supplied material into decision trees, Ableton Live implementations, production priorities, anti-patterns, quality-control checks and a full provenance ledger.

The original input contains **20 YouTube entries representing 19 unique video IDs**, because `SGx9OalJLLU` appears twice. During research I could independently resolve and corroborate the bulk of the collection, including the melody, mixing, EQ, mastering, low-end, transitions, arrangement, layering and chord videos. For example, public indexing identifies `Vka87doQPlA` as EDM Tips' *How to EQ like a PRO – 11 EQ Mistakes That RUIN Your Mixes* and `hyLQx6mIbVg` as *Perfect Mastering Chain (How to Get Loud & Clean Masters Every Time)*. citeturn37youtube40turn37youtube41 The chord-progression video `jVzPdtesJJs` is likewise indexed as *How to Create EMOTIONS with CHORD PROGRESSIONS*. citeturn36youtube20

Three supplied IDs — `_g-MmazYc9o`, `tf3F707pdNM`, and `EdDmm4LT_dw` — did not expose reliable title/transcript metadata through the public indexes available in this research pass. Rather than infer their content, the `.md` explicitly retains those URLs in its source ledger and labels them unresolved. That is deliberate: an expert agent should distinguish evidence from guesses.

## Production knowledge distilled into the file

The strongest compositional rule across the melody material is to **separate musical quality from sound-design excitement**. EDM Tips recommends beginning with a simple instrument, defining the desired genre/emotion, selecting the scale, establishing bass and chords, then constructing the melody rhythm before assigning pitches. Its detailed melody guide specifically advocates a root-note rhythm sketch, subsequent emphasis on harmonically stable chord tones, repetition with controlled variation, contrasting counter-melodies and later humanisation through velocity and timing. citeturn35search0

The companion catchiness analysis places unusual emphasis on **rhythmic motifs and repetition**: stripping familiar melodies down to a single pitch exposes repeating rhythmic identities, after which pitch contour, motifs, predominantly stepwise motion with occasional leaps and a manageable melodic range create recognisability. It also recommends using underlying chord tones as structural melodic notes. citeturn35search1 The expert file consequently tells the agent that when asked to “make the melody catchier”, its first response should not be more notes, layers or effects; it should simplify to rhythm, find a recognisable motif, restore pitch around chord tones, introduce one controlled variation and check the loop's resolution.

For harmony, the document uses a progressive “complexity ladder”: begin with functional triads, then improve voice leading with inversions, then add sevenths, ninths, suspensions or other colour only when they strengthen the emotional purpose. EDM Tips' chord reference demonstrates triads, seventh/ninth extensions and inversions, while also assigning subjective emotional descriptions to different qualities. citeturn42view1 The `.md` deliberately labels those emotional associations as **creative prompts rather than objective acoustic laws**, preventing a coding agent from treating “major = happy” or “minor seventh = melancholic” as deterministic rules.

Arrangement is similarly converted from tutorial advice into an executable workflow. EDM Tips' recent fast-arrangement method distinguishes a **micro progression** — usually a small core set of chords — from the **macro arrangement**, where interest is created by changing which part of that progression appears, which instruments carry it, and the surrounding energy/density. The source explicitly advocates reference-track analysis and points out that one progression can sustain a track through changes in melody, automation and arrangement rather than constant harmonic replacement. citeturn27search1 Its longer song-structure guide treats intro, verse, build and drop as functional sections, recommends reference-derived structure, and shows 8/16-bar section lengths as common examples rather than immutable rules. citeturn27search2

That becomes a practical Codex instruction: when an eight-bar loop needs to become a track, first decide whether it represents a drop, breakdown, verse or intro; scaffold the whole timeline; create lower-energy sections chiefly through **subtraction and recontextualisation**; progressively restore elements; reserve the complete bass/drum/hook combination for the high-energy section; and develop the second major section with one meaningful variation rather than inventing an unrelated song.

## Low-end, mixing and transition intelligence

The low-end section is designed to stop an automated agent from immediately reaching for EQ. EDM Tips' more recent low-end guidance starts with the relationship between kick and bass, then progresses through ducking, frequency separation, phase consistency and finally gentle bus processing. It recommends, as one possible architecture, separating a clean sub region from a more textural mid-bass, applying heavier ducking to the sub, avoiding unnecessary unison/detune on that clean sub, making oscillator phase behaviour predictable, checking small timing offsets where phase cancellation actually occurs, and using only subtle low-end bus saturation/compression. citeturn32search2

The `.md` therefore gives the agent this diagnostic sequence:

> **source choice → low-frequency ownership → level → time overlap/ducking → phase if demonstrably problematic → mono compatibility → harmonics → bus processing**

That sequence is important because older EDM Tips material contains useful but much more prescriptive rules such as making bass below roughly 130 Hz mono, starting a kick around a particular level, targeting roughly -6 dB before mastering, and high-pass filtering almost everything. The same article itself cautions that its techniques form a toolkit and should not all be applied to every mix. citeturn32search1 The compiled expert therefore preserves the underlying principles while explicitly prohibiting blind templates such as “high-pass everything at 100 Hz”.

The gain-staging video/article receives similar treatment. EDM Tips defines gain staging as monitoring signal level through successive processing stages and proposes around -18 dB average as a convenient operating region in its analogue-modelled-plugin workflow, while later stating that -18 dB is not an exact requirement. It also advocates output compensation after processors so bypass comparisons are fair. citeturn38search0 The agent file consequently interprets -18 dB and approximately -6 dB of premaster peak headroom as **heuristics**, not mandatory digital-audio targets. Its operative rules are instead to avoid unintended clipping, feed level-sensitive processors sensibly, maintain downstream headroom, and level-match A/B comparisons.

Layering has likewise been reduced to a three-axis test. EDM Tips describes successful layers in terms of **frequency/timbre, transient/dynamics and stereo field**, recommends dealing with the first two before relying on stereo separation, and warns against simply stacking similar full-range sounds. It illustrates complementary frequency layers, different attack/release characteristics and shared group effects as ways to build a coherent compound sound. citeturn42view0 Thus the agent must be able to state what a layer contributes before keeping it.

The supplied transition video has also been represented as a reusable seven-part toolkit: reverse percussion, risers, reverse reverb, spatial wash-out, pitch-bend transitions, filter automation and “hook hints” that foreshadow material from the forthcoming section. An independent detailed breakdown of the exact EDM Tips video describes the first four techniques and their construction, including reverse-reverbed percussion and progressive reverb wash-outs. citeturn41view0 It documents the remaining pitch-bend, filter-automation and hook-hint techniques as well. citeturn41view1 These are encoded as optional transition families rather than effects the agent should indiscriminately place every eight bars.

## Ableton Live translation

The expert context is specifically grounded in **current Live 12 behaviour**, rather than assuming that an older tutorial's Ableton interface or device behaviour remains unchanged.

For MIDI composition, Live 12's MIDI editor supports Scale Mode, highlighted scale tones, Fold to Scale and Fit to Scale; Fold to Scale hides rows outside the chosen scale, while Fit to Scale can move selected notes onto the active scale. citeturn31view0 The expert therefore directs the agent to set a clip's scale and exploit these features during tonal composition while still permitting deliberate chromatic tension rather than mechanically forcing every note into-scale.

For arrangement work, Live's Arrangement View supports locators that can mark and navigate sections, and exposes automation lanes directly in Arrangement View. citeturn31view2turn31view3 The file recommends named structural locators such as `INTRO`, `BREAK`, `BUILD`, `DROP A`, `RESET`, `DROP B` and `OUTRO` so the agent can reason explicitly about macro energy.

For mixing, the mappings are grounded in Ableton's current audio-effect reference:

- **Utility** provides Gain, complete Mono conversion and a **Bass Mono** function with an adjustable 50–500 Hz cutoff, so the agent can audition and choose the appropriate low-frequency mono boundary instead of assuming 100 or 130 Hz. citeturn30view1
- **EQ Eight** provides up to eight parametric filters and an analyser, making it suitable for corrective filtering, tonal shaping and automated filter transitions. citeturn30view2
- **Compressor** can receive an external sidechain; Ableton's own manual specifically describes kick-triggered ducking of bass as a dance-music application. citeturn30view3
- **Saturator** is a nonlinear waveshaper with multiple shaping curves, Drive/Output controls and frequency-dependent colour facilities, so the expert maps harmonic enhancement and controlled colour to Saturator while insisting on output-matched comparison. citeturn30view5
- **Limiter** in current Live 12 provides Standard, Soft Clip and **True Peak** ceiling modes; Ableton states that True Peak mode prevents inter-sample peaks and recommends keeping Limiter last when it is being used to ensure the final output does not subsequently gain level. citeturn30view4

That last point allowed the research to improve on older mastering advice rather than fossilise it. EDM Tips' older mastering workflow remains useful at the conceptual level — reference, corrective EQ, dynamics, stereo/harmonic treatment and final limiting — but the expert document does **not** hard-code the old output-ceiling convention. citeturn42view2 It directs the agent to use the actual delivery specification and current Live 12 True Peak capability instead.

## Agent guardrails and quality controls

The `.md` contains explicit anti-patterns because translating human tutorial advice directly into automation can otherwise produce destructive behaviour. In particular, the agent is forbidden from automatically setting every channel to -18 dB, monofying everything below exactly 130 Hz, forcing a premaster to exactly -6 dB, high-passing almost every source, adding compression merely because a channel is important, widening the master to make a drop seem bigger, or using a fixed sidechain amount on every bass. Those restrictions reconcile EDM Tips' older numerical shortcuts with its own caveats and newer, more contextual low-end teaching. citeturn32search1turn38search0turn32search2

It also contains task-specific decision trees for requests such as **“make the melody catchier”, “make the drop bigger”, “fix the muddy mix”, “fix weak low end”, “make it wider” and “master it louder”**. Those trees intentionally move from composition, arrangement and source selection towards increasingly invasive processing, reflecting EDM Tips' emphasis on selecting compatible sounds before trying to rescue them in the mixer. citeturn35search0turn32search1

Finally, there is a full QA pass covering composition, arrangement, sound design, low end, mix and master. The agent is instructed to check whether changes remain effective in mono, whether processing survives level-matched bypass comparison, whether each layer has an identifiable job, whether the drop is genuinely contrasted from its build, and whether limiting is sacrificing kick impact or groove. Mono checking and level-conscious comparison are recurring recommendations in the EDM Tips mixing material, while Live's Utility provides the stock mechanism needed to perform those checks. citeturn32search1turn30view0turn30view1

## Research coverage

The result is deliberately more than a transcript digest. It combines the identifiable videos with EDM Tips' corresponding written material and then **cross-checks device-specific instructions against Ableton's present Live 12 documentation**. The melody corpus is supported by EDM Tips' detailed melody-writing and catchy-melody guides; arrangement by its song-structure and newer fast-arrangement guides; layering by its dedicated layering article; gain staging and low end by their matching EDM Tips articles; and Ableton implementation by the current Live manual. citeturn35search0turn35search1turn27search1turn27search2turn42view0turn38search0turn32search2turn30view1

The source ledger inside the `.md` preserves **every URL supplied in the request**, including the duplicate and the three unresolved IDs. It also records the EDM Tips written corroborating sources and the relevant official Ableton manual sections, so a future agent or researcher can trace a rule back to its provenance rather than treating this file as unqualified doctrine.

**[Download the completed `edm_tips_expert.md`](sandbox:/mnt/data/edm_tips_expert.md)**