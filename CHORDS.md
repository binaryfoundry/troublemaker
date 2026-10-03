# Ableton Live Chord Progression Expert Agent — Research Deliverable

## Executive summary

The completed knowledge base specifies an **expert chord-progression agent for Ableton Live** that can teach harmony, generate progressions, analyse existing MIDI, reharmonise melodies, optimise inversions and voice leading, design modulations, integrate rhythm/groove, and translate all of that musical reasoning into concrete Ableton workflows.

The specification is deliberately **version-aware rather than tied to one release**. Its baseline workflow uses editable MIDI clips and stock MIDI effects, while Live 12-specific branches take advantage of scale awareness and MIDI Tools. Ableton documents Live 12’s ability to propagate scale context to relevant MIDI devices, and its Stacks generator can create individual chords or progressions within the selected scale. citeturn20search1turn20search3 Expressive Chords is treated as an optional performance/ideation layer: Ableton currently specifies Live 12.2 or later and 52 included presets/chord sets. citeturn20search5turn20search7

The agent is designed around a central principle: **generation is only the beginning**. Whether harmony comes from Stacks, MIDI effects, Max for Live, a third-party plugin or a chord pack, the recommended production cycle is to generate or perform ideas, expose/capture them as editable MIDI, inspect the actual notes, repair voice leading and register, establish an independent bass strategy, add groove, then create arrangement variants. Ableton’s own documentation supports the underlying MIDI-editing, groove, MIDI-effect and scale-aware workflows. citeturn20search10turn20search40

## Research scope and source status

One discrepancy in the brief is documented explicitly: it refers to **five YouTube links, but six URLs were supplied**. All six are preserved individually in the knowledge base as highest-priority primary inputs.

Direct retrieval/transcript extraction from those particular YouTube pages was not reliable in this research environment. Rather than infer titles or falsely attribute techniques to videos I could not verify, the knowledge base marks each as **unextracted primary evidence** and supplies a timestamped ingestion protocol for incorporating the videos once their transcripts/content can be reliably accessed. This is an intentional evidential limitation, not a substitution of unrelated material for the requested sources.

The verified technical foundation therefore relies primarily on:

- Ableton’s current Reference Manual and Help Centre for MIDI editing, scale awareness, MIDI Tools, MIDI effects, Grooves, Racks, audio-to-MIDI and Max for Live. Live’s MIDI Note Editor provides note, velocity and chance editing, while Live 12 adds the current scale as a shared context for compatible devices. citeturn20search40turn20search17
- Ableton’s official tutorials on generative harmonic workflows. Ableton describes ELPHNT’s approach as using basic MIDI devices and routing to create controllable streams of chord, bass and melody ideas; newer official tutorial material likewise covers chord generation and MIDI-effect-based composition. citeturn20search22turn20search35
- Official third-party documentation. Scaler 3 currently advertises voice grouping, range-aware/drop voicings and several modulation approaches; Cthulhu describes chord memorisation/playback and MIDI chord import; Captain Chords documents editable progressions, voicing tools and Ableton integration. citeturn21search0turn21search2turn21search1turn21search32turn21search42
- Primary or publisher-hosted harmony literature, especially Tymoczko’s geometric treatment of chords and efficient voice leading, with neo-Riemannian theory, tonal pitch space and music-cognition literature included as deeper theoretical foundations.

## What the knowledge base contains

The Markdown file is approximately **62 KB** and is organised as a practical agent specification rather than merely a list of chord-theory notes. It includes:

**Agent architecture and behaviour.** The agent persona is a senior harmony tutor, producer and Ableton workflow specialist. Its input model accounts for Live version/edition, Max for Live availability, key, mode, tempo, metre, bar count, melody and bass constraints, genre, mood, harmonic rhythm and permitted plugins. Missing details must be declared as assumptions instead of silently invented.

**Generation and analysis logic.** The document defines a reusable progression-scoring model combining harmonic fit, melody compatibility, style, common tones, contour and novelty against voice-motion, register, clash and repetition penalties. The voice-leading procedure explicitly enumerates inversions and octave placements, preserves fixed melody notes, rewards common tones and penalises unnecessary crossing. This reflects the broader scholarly conception of efficient voice leading as small paths between chord configurations.  

**Ableton-specific production workflows.** There are step-by-step procedures for:

- writing chord progressions directly in MIDI clips;
- Live 12 scale/mode handling and older-version fallbacks;
- Stacks/generative-MIDI ideation followed by manual clean-up;
- `Chord → Random → Scale` controlled generation;
- inversions and systematic voice leading;
- conservative, colourful and “outside” reharmonisation;
- secondary dominants, modal interchange, diminished approaches, pedal points, tritone substitutions and chromatic-mediant relationships;
- pivot, dominant, common-tone, modal and direct modulation;
- chord rhythm, stabs, anticipations, arpeggiation and Groove Pool integration;
- polyphonic audio-to-MIDI transcription followed by harmonic correction;
- Session/Arrangement-style progression variation and section development.

Ableton confirms that Groove Pool workflows can alter clip timing/velocity feel and that Harmony-to-MIDI converts polyphonic audio into a new MIDI representation for further editing. citeturn7search1turn7search2

**Device and plugin comparison tables.** The comparison covers stock Chord, Scale, Arpeggiator, Random, Stacks, Expressive Chords, Scaler 3, Captain Chords Epic, Cthulhu, Chordjam and Tuple, with best use, strengths, cautions, dependencies and official-source links. Max for Live licensing is handled explicitly: Ableton currently bundles it with Suite and offers it as an add-on for Standard. citeturn20search0turn20search4

**Chord-pack guidance.** Chord packs are deliberately positioned below editable MIDI and generative/theory-aware workflows: useful as source material, but never assumed to be correctly voiced or contextually appropriate simply because the notes can be dragged into Live.

**Mermaid diagrams.** Two diagrams are embedded directly in the Markdown: an agent decision flow from user intent through harmonic analysis, voice leading and Ableton implementation, and a MIDI/signal-flow diagram covering clip input, MIDI effects, instrument/Rack, audio effects, Groove Pool and Live 12 scale context.

**Eight MIDI-clip templates**, exceeding the requested six, span distinct harmonic languages and production contexts:

| Template | Style / mood | Core progression |
|---|---|---|
| H01 | Deep / melodic house | `F#m9 – Dmaj7 – Aadd9 – E6/9sus4` |
| H02 | Neo-soul / R&B | `Ebmaj9 – Gm7 – Cm9 – Abmaj9` |
| H03 | Dark trap | `Cm(add9) – Abmaj7 – Fm9 – Gsus4→G` |
| H04 | Liquid drum & bass | `Dmaj9 – F#m7 – Bm9 – Gmaj9` |
| H05 | Cinematic | `Am(add9) – Fmaj7 – C/E – Gsus4→G` |
| H06 | Gospel / jazz | `Cmaj9 – A7alt – Dm9 – G13 – Cmaj9` |
| H07 | Synthwave | `Em9 – Cmaj7 – G6 – Dadd9` |
| H08 | Modal techno | `Dm9 – G/D – Cmaj7/D – Dm11` |

Each template includes tempo, key/mode, precise MIDI-note arrays, register, chord symbols, harmonic interpretation, rhythmic/arrangement guidance and a suggested Instrument Rack. MIDI note numbers are made canonical using `C4 = 60`, preventing octave-naming conventions from undermining reproducibility.

The document also contains proposed Rack designs—such as **Velvet Keys**, **House Chord Layer**, **Glass & Fog**, **Piano + Strings**, **Warm Poly**, **Chord Stab** and **Gospel Keys**—while explicitly warning that individual Ableton instruments can be edition-dependent. Instrument Racks themselves support parallel chains and Macro-oriented organisation, making the general architecture portable even when the exact instrument changes. citeturn7search3

Finally, there is an extensive troubleshooting matrix covering “in-key but random” harmony, mud, bad voice leading, overextended chords, melody clashes, scale-aware remapping of borrowed chords, generator-to-MIDI capture, duplicate MIDI paths, overly strong grooves, audio-to-MIDI errors and ambiguous Roman-numeral analysis.

## Download

[**Download the complete Markdown agent specification and knowledge base**](sandbox:/mnt/data/ableton_chord_progression_expert_agent_kb.md)

The file is self-contained and uses ordinary Markdown tables, YAML-style MIDI-template blocks, Mermaid diagrams and direct official-source links, making it suitable for ingestion into an agent knowledge base, repository, documentation system or retrieval pipeline.