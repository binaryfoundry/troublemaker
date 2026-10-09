"""Compare a synth's render with a reference render of the same notes, in detail.

The pack-loop check (`pack_loops.py`) compares six long-term bands: it catches a
brightness or balance error and nothing finer. This measures what a listener
hears, with both files playing the same note list:

  1. tone        - 31 third-octave bands, 40 Hz-16 kHz, over the whole file
  2. over time   - the same bands in 23 ms frames (filter sweeps, envelopes, LFOs)
  3. per note    - harmonics 1-16 of every note at its start, middle and end
  4. width       - side against mid per band, and L/R correlation
  5. movement    - level and pitch wobble inside held notes (LFOs, vibrato, chorus)
  6. noise       - the energy between the harmonics, per band

and writes a level-matched A/B file that alternates the two every two bars, for
the ear. The files are aligned by their onset envelopes first, so a reference
captured from Live (which starts on a bar line) lines up with an offline render.

    python analogfoundry/tools/synth_compare.py REF.wav TEST.wav EVENTS.txt BPM [--ab OUT.wav] [--json OUT.json]

EVENTS is a render_note events file ("beat length note velocity" per line). Needs
numpy, scipy and soundfile.
"""

from __future__ import annotations

import argparse
import json
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

THIRD_OCTAVES = [40 * 2 ** (k / 3) for k in range(0, 31)]  # 40 Hz .. ~16 kHz centres
FRAME = 1024  # 23 ms at 44.1 kHz


def load(path: str) -> tuple[np.ndarray, int]:
    x, sr = sf.read(path, always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x[:, :2].astype(np.float64), sr


def band_edges(sr: int, n: int) -> list[tuple[int, int]]:
    f = np.fft.rfftfreq(n, 1 / sr)
    edges = []
    for c in THIRD_OCTAVES:
        lo, hi = c * 2 ** (-1 / 6), c * 2 ** (1 / 6)
        edges.append((int(np.searchsorted(f, lo)), max(int(np.searchsorted(f, lo)) + 1, int(np.searchsorted(f, hi)))))
    return edges


def band_frames(x: np.ndarray, sr: int, n: int = FRAME) -> np.ndarray:
    """Energy per third-octave band per frame (frames x bands), from a 4n FFT of each hop."""
    N = 4 * n
    win = np.hanning(N)
    edges = band_edges(sr, N)
    out = []
    for i in range(0, max(1, len(x) - N), n):
        S = np.abs(np.fft.rfft(x[i:i + N] * win)) ** 2
        out.append([S[a:b].sum() for a, b in edges])
    return np.array(out) + 1e-20


def onset_envelope(x: np.ndarray, sr: int) -> np.ndarray:
    hop = 256
    e = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x) - hop, hop)])
    d = np.maximum(0, np.diff(np.log(e + 1e-6)))
    return d


def first_sound(x: np.ndarray) -> int:
    e = np.abs(x)
    return int(np.argmax(e > e.max() * 0.05))


def align(ref: np.ndarray, test: np.ndarray, sr: int, refine_s: float = 0.03) -> int:
    """Samples to drop from the start of `ref` (positive) or `test` (negative) so they line up.

    The first sound in each file sets the offset; onset correlation only refines it
    within +/-30 ms. Correlation alone locks onto the wrong note when the notes are
    long (it was 157-238 ms out on held leads)."""
    coarse = first_sound(ref.mean(1)) - first_sound(test.mean(1))
    a, b = onset_envelope(ref.mean(1), sr), onset_envelope(test.mean(1), sr)
    n = min(len(a), len(b))
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    c, m = int(round(coarse / 256)), int(refine_s * sr / 256)
    best = max(range(c - m, c + m + 1), key=lambda k: float(np.dot(a[max(0, k):n + min(0, k)], b[max(0, -k):n - max(0, k)])))
    return best * 256


def harmonic_profile(x: np.ndarray, sr: int, f0: float, n: int = 16) -> np.ndarray:
    N = len(x)
    if N < 256:
        return np.full(n, np.nan)
    S = np.abs(np.fft.rfft(x * np.hanning(N), 4 * N))
    f = np.fft.rfftfreq(4 * N, 1 / sr)
    H = []
    for h in range(1, n + 1):
        band = (f > f0 * h * 0.97) & (f < f0 * h * 1.03)
        H.append(S[band].max() if band.any() and f0 * h < sr / 2 else 1e-12)
    H = 20 * np.log10(np.array(H) + 1e-12)
    return H - H[0]


def interharmonic_floor(seg: np.ndarray, sr: int, f0: float, lo: float, hi: float) -> float:
    """Energy between partials against energy on them, in lo..hi, in dB."""
    N = len(seg)
    S = np.abs(np.fft.rfft(seg * np.hanning(N), 2 * N)) ** 2
    f = np.fft.rfftfreq(2 * N, 1 / sr)
    m = (f >= lo) & (f < hi)
    if not m.any():
        return np.nan
    pos = (f[m] / f0) % 1.0
    on = (pos < 0.08) | (pos > 0.92)
    between = (pos > 0.35) & (pos < 0.65)
    if not on.any() or not between.any():
        return np.nan
    return float(10 * np.log10(S[m][between].mean() / (S[m][on].mean() + 1e-20) + 1e-20))


def held_movement(x: np.ndarray, sr: int, notes: list[tuple[float, float, float]]) -> dict:
    """Level wobble (1-4 kHz) and pitch wobble inside held notes, attack and release excluded.

    `notes` are (start s, end s, f0, sounds alone). Only notes of 0.5 s or more count, from 120 ms after
    the onset to 50 ms before the note-off, so the notes' own rhythm cannot show up as
    movement (it did: a whole-file measure read 2.07 Hz, one beat at 124 BPM)."""
    sos = butter(4, [1000, 4000], btype='band', fs=sr, output='sos')
    y = sosfilt(sos, x) ** 2
    hop = int(sr / 100)
    levels, pitches = [], []
    for t0, t1, f0, alone in notes:
        if t1 - t0 < 0.5:
            continue
        a, b = int((t0 + 0.12) * sr), int((t1 - 0.05) * sr)
        if b - a < 0.3 * sr or b > len(x):
            continue
        e = 10 * np.log10(np.array([y[i:i + hop].mean() for i in range(a, b - hop, hop)]) + 1e-12)
        k = np.arange(len(e))
        e = e - np.polyval(np.polyfit(k, e, 1), k)  # a decay is not movement
        levels.append(float(np.std(e)))
        if not alone:
            continue
        # pitch: the strongest peak within a semitone of the fundamental, 46 ms frames
        N = 2048
        cents = []
        for i in range(a, b - N, hop * 2):
            S = np.abs(np.fft.rfft(x[i:i + N] * np.hanning(N), 8 * N))
            f = np.fft.rfftfreq(8 * N, 1 / sr)
            m = (f > f0 * 2 ** (-1 / 12)) & (f < f0 * 2 ** (1 / 12))
            if m.any():
                cents.append(1200 * np.log2(f[m][np.argmax(S[m])] / f0))
        if len(cents) > 4:
            c = np.array(cents)
            pitches.append(float(np.std(c - np.polyval(np.polyfit(np.arange(len(c)), c, 1), np.arange(len(c))))))
    return {'notes': len(levels), 'level_wobble_db': round(float(np.median(levels)), 2) if levels else None,
            'pitch_wobble_cents': round(float(np.median(pitches)), 1) if pitches else None}


def modulation(x: np.ndarray, sr: int, lo: float, hi: float) -> tuple[float, float]:
    """Dominant fluctuation rate (Hz) and depth (dB) of a band's level, 1-20 Hz.

    Changes slower than half a second (notes, phrases) are removed first, so what is
    left is LFO, vibrato, tremolo and chorus movement."""
    sos = butter(4, [lo, min(hi, sr / 2 * 0.95)], btype='band', fs=sr, output='sos')
    y = sosfilt(sos, x) ** 2
    hop = int(sr / 100)  # 10 ms
    e = 10 * np.log10(np.array([y[i:i + hop].mean() for i in range(0, len(y) - hop, hop)]) + 1e-12)
    e = e - np.convolve(e, np.ones(51) / 51, mode='same')
    e = e[25:-25]
    E = np.abs(np.fft.rfft(e * np.hanning(len(e))))
    f = np.fft.rfftfreq(len(e), 0.01)
    m = (f >= 1) & (f <= 20)
    k = np.argmax(E[m])
    return float(f[m][k]), float(np.std(e))


def compare(ref_path: str, test_path: str, events: list[tuple[float, float, int, float]], bpm: float, ab_path: str | None = None) -> dict:
    ref, sr = load(ref_path)
    test, sr2 = load(test_path)
    if sr2 != sr:
        raise SystemExit(f'sample rates differ: {sr} and {sr2}')
    shift = align(ref, test, sr)
    if shift > 0:
        ref = ref[shift:]
    elif shift < 0:
        test = test[-shift:]
    n = min(len(ref), len(test))
    ref, test = ref[:n], test[:n]
    # level-match on the mid signal
    g = np.sqrt(np.mean(ref.mean(1) ** 2) / (np.mean(test.mean(1) ** 2) + 1e-20))
    test = test * g
    rm, tm = ref.mean(1), test.mean(1)
    rs, ts = (ref[:, 0] - ref[:, 1]) / 2, (test[:, 0] - test[:, 1]) / 2
    report: dict = {'align_ms': round(1000 * shift / sr, 1), 'level_match_db': round(20 * np.log10(g), 2)}

    # 1. tone, long term
    Rf, Tf = band_frames(rm, sr), band_frames(tm, sr)
    Rl, Tl = 10 * np.log10(Rf.sum(0)), 10 * np.log10(Tf.sum(0))
    tone = Tl - Rl
    audible = Rl > Rl.max() - 50  # ignore bands with nothing in them
    report['tone_error_db'] = round(float(np.mean(np.abs(tone[audible]))), 2)
    report['tone_by_third_octave'] = {f'{c:.0f}': round(float(t), 1) for c, t, a in zip(THIRD_OCTAVES, tone, audible) if a}

    # 2. over time: frames where the reference sounds, bands weighted by its energy
    m = min(len(Rf), len(Tf))
    R, T = 10 * np.log10(Rf[:m]), 10 * np.log10(Tf[:m])
    loud = R.max(1) > R.max() - 40
    w = Rf[:m][loud] / Rf[:m][loud].sum(1, keepdims=True)
    report['spectrogram_error_db'] = round(float(np.sum(np.abs(T[loud] - R[loud]) * w, 1).mean()), 2)
    centroid = lambda F: (F * np.array(THIRD_OCTAVES)).sum(1) / F.sum(1)
    cr, ct = np.log2(centroid(Rf[:m][loud])), np.log2(centroid(Tf[:m][loud]))
    report['brightness_offset_oct'] = round(float(np.mean(ct - cr)), 2)
    report['brightness_track_corr'] = round(float(np.corrcoef(cr, ct)[0, 1]), 3)
    lr, lt = 10 * np.log10(Rf[:m].sum(1)), 10 * np.log10(Tf[:m].sum(1))
    report['level_track_corr'] = round(float(np.corrcoef(lr[loud], lt[loud])[0, 1]), 3)

    # 3. per note: harmonics at start (20-60 ms), middle, and the last 60 ms before the note-off
    spb = 60 / bpm
    stages = {'start': [], 'middle': [], 'end': []}
    noise = []
    for beat, length, note, _ in events:
        t0 = beat * spb - shift / sr if shift > 0 else beat * spb
        t1 = t0 + length * spb
        if t1 * sr > n or length * spb < 0.15:
            continue
        f0 = 440 * 2 ** ((note - 69) / 12)
        win = 0.04
        seg = lambda a: (int(a * sr), int((a + win) * sr))
        for name, a in (('start', t0 + 0.02), ('middle', (t0 + t1) / 2 - win / 2), ('end', t1 - win - 0.02)):
            i, j = seg(a)
            hr, ht = harmonic_profile(rm[i:j], sr, f0), harmonic_profile(tm[i:j], sr, f0)
            stages[name].append(ht - hr)
        i, j = seg((t0 + t1) / 2 - 0.05)
        j = i + int(0.1 * sr)
        nr = interharmonic_floor(rm[i:j], sr, f0, 2000, 8000)
        nt = interharmonic_floor(tm[i:j], sr, f0, 2000, 8000)
        if np.isfinite(nr) and np.isfinite(nt):
            noise.append(nt - nr)
    report['harmonics_vs_ref_db'] = {
        k: ([round(float(v), 1) for v in np.nanmedian(np.array(s), 0)] if s else None) for k, s in stages.items()
    }
    report['harmonic_error_db'] = {
        k: (round(float(np.nanmean(np.abs(np.nanmedian(np.array(s), 0)[1:]))), 2) if s else None) for k, s in stages.items()
    }
    report['noise_floor_vs_ref_db'] = round(float(np.median(noise)), 1) if noise else None
    report['notes_measured'] = len(stages['middle'])

    # 4. width
    Rs, Ts = band_frames(rs, sr).sum(0), band_frames(ts, sr).sum(0)
    wr = np.maximum(10 * np.log10(Rs / Rf.sum(0)), -40)
    wt = np.maximum(10 * np.log10(Ts / Tf.sum(0)), -40)
    report['width_side_vs_mid_db'] = {'ref': round(float(np.median(wr[audible])), 1), 'test': round(float(np.median(wt[audible])), 1)}
    report['width_error_db'] = round(float(np.mean(np.abs((wt - wr)[audible]))), 2)
    report['lr_correlation'] = {'ref': round(float(np.corrcoef(ref[:, 0], ref[:, 1])[0, 1]), 3) if np.std(ref[:, 1]) > 0 else 1.0,
                                'test': round(float(np.corrcoef(test[:, 0], test[:, 1])[0, 1]), 3) if np.std(test[:, 1]) > 0 else 1.0}

    # 5. movement inside held notes (LFOs, vibrato, chorus), not the notes' own rhythm
    held = []
    for beat, length, note, _ in events:
        # pitch is only tracked on a note that sounds alone: a chord's other notes fool it
        alone = not any(b2 < beat + length and beat < b2 + l2 and (b2, l2, n2) != (beat, length, note) for b2, l2, n2, _ in events)
        t0 = beat * spb - (shift / sr if shift > 0 else 0)
        held.append((t0, t0 + length * spb, 440 * 2 ** ((note - 69) / 12), alone))
    report['held_movement'] = {'ref': held_movement(rm, sr, held), 'test': held_movement(tm, sr, held)}

    # A/B for the ear: two bars each, level-matched, with 10 ms crossfades
    if ab_path:
        block = int(8 * spb * sr)
        out = np.zeros_like(ref)
        fade = int(0.01 * sr)
        for k, start in enumerate(range(0, n, block)):
            src = ref if k % 2 == 0 else test
            seg = src[start:start + block].copy()
            seg[:fade] *= np.linspace(0, 1, fade)[:, None][:len(seg[:fade])]
            seg[-fade:] *= np.linspace(1, 0, fade)[:, None][-len(seg[-fade:]):]
            out[start:start + len(seg)] = seg
        peak = np.abs(out).max()
        sf.write(ab_path, out / peak * 0.7 if peak > 0.7 else out, sr, subtype='PCM_24')
        report['ab_file'] = ab_path
        report['ab_order'] = 'reference first, then the test, alternating every two bars'
    return report


def summary(name: str, r: dict) -> str:
    h = r['harmonic_error_db']
    mv = r['held_movement']
    return (f"{name}: tone {r['tone_error_db']:.1f} dB (1/3-oct) | over time {r['spectrogram_error_db']:.1f} dB, "
            f"brightness {r['brightness_offset_oct']:+.2f} oct, tracks {r['brightness_track_corr']:+.2f}, level tracks {r['level_track_corr']:+.2f} | "
            f"harmonics start/mid/end {h['start']}/{h['middle']}/{h['end']} dB | noise {r['noise_floor_vs_ref_db']} dB | "
            f"width {r['width_side_vs_mid_db']['test']} vs {r['width_side_vs_mid_db']['ref']} dB | "
            f"held notes ({mv['ref']['notes']}): level wobble {mv['test']['level_wobble_db']} vs {mv['ref']['level_wobble_db']} dB, "
            f"pitch wobble {mv['test']['pitch_wobble_cents']} vs {mv['ref']['pitch_wobble_cents']} cents")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('ref')
    ap.add_argument('test')
    ap.add_argument('events')
    ap.add_argument('bpm', type=float)
    ap.add_argument('--ab')
    ap.add_argument('--json')
    ap.add_argument('--name', default='')
    a = ap.parse_args()
    events = [tuple(map(float, l.split()[:4])) for l in open(a.events, encoding='utf-8') if l.strip() and l[0] != '#']
    events = [(b, d, int(n), v) for b, d, n, v in events]
    r = compare(a.ref, a.test, events, a.bpm, a.ab)
    print(summary(a.name or a.test, r))
    if a.json:
        json.dump(r, open(a.json, 'w'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
