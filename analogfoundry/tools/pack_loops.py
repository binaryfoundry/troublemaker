"""Check the Serum and Diva -> AF101 conversions against audio the real synths made.

Neither synth is installed here, but the TPS x CamelPhat pack ships loops that
Serum and Diva played from its presets' demo MIDI. Matching each loop to a clip by
its exact pitches (a semitone spectrogram against each clip's notes and their
harmonics, every octave offset tried) found 21 that clearly belong to one preset
(README, "Checked against the synths' own audio"). This renders each clip through
AF101 with the converted patch and compares the long-term spectrum with the loop's,
band by band.

A loop includes the synth's effects and the converted patch does not, so this is
a tone check, not a null test. Each pair carries the band error measured when the
conversion was last changed; the check fails if any pair gets worse by more than
MARGIN_DB, so a converter change has to be measured here before it is kept.

Needs numpy and soundfile, the converted patches (`npm run convert-preset --
<pack>/...Serum 2 Presets <pack>/...Diva Presets`) and render_note.

    python analogfoundry/tools/pack_loops.py [--pack DIR] [--converted DIR] [--exe PATH]
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import struct
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

PACK = "D:/samples/TPS x CamelPhat - Producer Pack/TPS x CamelPhat - Producer Pack"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# loop, synth, preset, clip offset in beats, band error (dB) measured 2026-10-09
PAIRS = [
    ("Synth Loop 02 Fmin", "serum", "SY - Desire", 0, 1.6),
    ("Synth Loop 03 Bmin", "serum", "SY - Dimension", 0, 4.0),
    ("Synth Loop 04 Cmin", "serum", "SY - Following", 0, 7.0),
    ("Synth Loop 05 C ", "serum", "SY - Instead", 0, 2.0),
    ("Synth Loop 06 Cmin", "serum", "SY - Lines", 0, 2.4),  # 1.5 before S16; see README
    ("Synth Loop 07 A#min", "serum", "SY - Magician", 0, 6.9),
    ("Synth Loop 08 Fmin", "serum", "SY - Page", 0, 3.6),
    ("Synth Loop 09 Amin", "serum", "SY - Patterns", 0, 1.6),
    ("Synth Loop 10 A#", "serum", "SY - Plans", 0, 1.1),
    ("Synth Loop 11 D#min", "serum", "SY - Smear", 8, 1.6),
    ("Bass Loop 12 D#min", "serum", "BS - Coast", 0, 0.7),
    ("Bass Loop 18 Emin", "serum", "BS - Listener", 0, 1.2),
    ("Bass Loop 20 D#", "serum", "BS - Kinetic", 0, 2.1),
    ("Synth Loop 12 Amin", "diva", "SY - Milk", 0, 1.8),
    ("Synth Loop 13 Amin", "diva", "SY - Black", 0, 0.9),
    ("Synth Loop 15 Amin", "diva", "SY - Impactful", 0, 1.7),
    ("Synth Loop 18 Fmin", "diva", "SY - Trying", 0, 1.0),
    ("Synth Loop 19 Amin", "diva", "SY - Using", 0, 4.3),
    ("Synth Loop 20 Fmin", "diva", "SY - Waiting", 0, 0.9),
    ("Bass Loop 07 Fm", "diva", "BS - Tops", 0, 4.7),
    ("Bass Loop 10 F ", "diva", "BS - Life", 0, 9.5),
]
BANDS = [40, 120, 300, 800, 2000, 5000, 12000]
MARGIN_DB = 0.5


def read_midi(path: str) -> list[tuple[float, float, int, float]]:
    """Notes of a Standard MIDI File as (beat, length, note, velocity 0..1)."""
    data = open(path, "rb").read()
    division = struct.unpack(">H", data[12:14])[0]
    pos = 8 + struct.unpack(">I", data[4:8])[0]
    notes = []

    def varlen(p: int) -> tuple[int, int]:
        v = 0
        while True:
            b = data[p]
            p += 1
            v = (v << 7) | (b & 0x7F)
            if b < 0x80:
                return v, p

    while pos < len(data) and data[pos:pos + 4] == b"MTrk":
        end = pos + 8 + struct.unpack(">I", data[pos + 4:pos + 8])[0]
        p, t, status, held = pos + 8, 0, 0, {}
        while p < end:
            dt, p = varlen(p)
            t += dt
            if data[p] == 0xFF:
                length, p = varlen(p + 2)
                p += length
                continue
            if data[p] in (0xF0, 0xF7):
                length, p = varlen(p + 1)
                p += length
                continue
            if data[p] & 0x80:
                status = data[p]
                p += 1
            kind = status & 0xF0
            if kind in (0xC0, 0xD0):
                p += 1
                continue
            d1, d2 = data[p], data[p + 1]
            p += 2
            if kind == 0x90 and d2 > 0:
                held.setdefault(d1, []).append((t, d2))
            elif kind in (0x80, 0x90) and held.get(d1):
                t0, velocity = held[d1].pop(0)
                notes.append((t0 / division, (t - t0) / division, d1, velocity / 127))
        pos = end
    return sorted(notes)


def clip_notes(converted: str, pack: str, synth: str, preset: str) -> list[tuple[float, float, int, float]]:
    """Serum: the clip the converter exported from the preset. Diva: the pack's MIDI file."""
    if synth == "serum":
        lines = open(os.path.join(converted, "serum", preset + ".clip.txt"), encoding="utf-8")
        return [(float(b), float(l), int(float(n)), float(v)) for b, l, n, v in (x.split() for x in lines if x[0] != "#" and x.strip())]
    return read_midi(os.path.join(pack, "TPS x CamelPhat - MIDI Files", "Diva Presets", preset + ".mid"))


def transpose_of(patch: str) -> int:
    m = re.search(r"transpose the clip (-?\d+) octave", open(patch, encoding="utf-8").read())
    return int(m.group(1)) * 12 if m else 0


def band_shares(x: np.ndarray, sr: int) -> np.ndarray:
    """Each band's share of the 40 Hz-12 kHz energy, in dB, from a long-term spectrum."""
    n = 8192
    win = np.hanning(n)
    spectrum = np.zeros(n // 2 + 1)
    for start in range(0, max(1, len(x) - n), n // 2):
        seg = x[start:start + n]
        spectrum += np.abs(np.fft.rfft(np.pad(seg, (0, n - len(seg))) * win)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    energy = np.array([spectrum[(f >= lo) & (f < hi)].sum() for lo, hi in zip(BANDS[:-1], BANDS[1:])]) + 1e-20
    return 10 * np.log10(energy / energy.sum())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--pack", default=PACK)
    parser.add_argument("--converted", default=os.path.join(ROOT, "analogfoundry/presets/converted"))
    parser.add_argument("--exe", default=os.path.join(ROOT, "analogfoundry/build/Release/render_note.exe"))
    args = parser.parse_args()
    wavs = glob.glob(os.path.join(args.pack, "**", "*.wav"), recursive=True)

    worse = 0
    for stem, synth, preset, offset, recorded in PAIRS:
        loop = next(w for w in wavs if stem in os.path.basename(w))
        y, sr = sf.read(loop, always_2d=True)
        y = y.mean(axis=1)
        bpm = float(re.search(r"\((\d+) BPM", loop).group(1))
        seconds = len(y) / sr
        patch = os.path.join(args.converted, synth, preset + ".txt")
        # Diva's MIDI is the source's own; a Serum clip.txt already carries the transpose.
        shift = transpose_of(patch) if synth == "diva" else 0
        notes = clip_notes(args.converted, args.pack, synth, preset)
        beats = max(4.0, float(np.ceil(max(b + l for b, l, _, _ in notes) / 4) * 4))
        total = seconds * bpm / 60
        lines = [f"{b + k * beats - offset} {l} {n + shift} {v}" for k in range(int(total // beats) + 2)
                 for b, l, n, v in notes if 0 <= b + k * beats - offset < total]
        handle, events = tempfile.mkstemp(suffix=".txt")
        with os.fdopen(handle, "w") as f:
            f.write("\n".join(lines) + "\n")
        handle, wav = tempfile.mkstemp(suffix=".wav")
        os.close(handle)
        try:
            subprocess.run([args.exe, "--preset", patch, "--events", events, "--bpm", str(bpm),
                            "--seconds", f"{seconds:.4f}", "--rate", str(sr), "--out", wav], check=True, capture_output=True)
            x, _ = sf.read(wav, always_2d=True)
        finally:
            os.remove(events)
            os.remove(wav)
        diff = band_shares(x.mean(axis=1), sr) - band_shares(y, sr)
        error = float(np.mean(np.abs(diff)))
        verdict = "ok" if error <= recorded + MARGIN_DB else "WORSE"
        worse += verdict != "ok"
        print(f"{synth:5s} {preset:15s} band error {error:5.2f} dB (recorded {recorded:4.1f})  {verdict:5s}"
              f"  AF101 - source by band: {' '.join(f'{d:+5.1f}' for d in diff)}")
    print(f"bands (Hz): {BANDS}")
    return 1 if worse else 0


if __name__ == "__main__":
    sys.exit(main())
