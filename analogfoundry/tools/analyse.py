"""Measurement and reference-matching tools for AnalogFoundry 101.

Milestone 7 asks for oscillator spectra, filter sweeps, envelope fitting,
resonance tuning and level-dependent comparison. This provides those as
measurements on rendered WAVs, so a claim about the model is always backed by
a number rather than an opinion - which ANALOG_SYNTH_AGENT.md requires
("never claim a circuit behaviour has been matched merely because it sounds
good on one preset").

Deliberately dependency-free: standard library only, so it runs anywhere the
renderer does. The DFT is a direct Goertzel-style correlation at the specific
frequencies asked about, which is far cheaper than a full FFT when the
question is "how much energy is at this partial".

Usage
-----
    python analyse.py spectrum  render.wav --f0 110
    python analyse.py envelope  render.wav
    python analyse.py sweep     --exe build/Release/render_note.exe
    python analyse.py compare   ours.wav reference.wav --f0 110
"""

from __future__ import annotations

import argparse
import cmath
import json
import math
import struct
import subprocess
import sys
import wave


# ----------------------------------------------------------------- wav input

def read_wav(path):
    """Return (mono samples as floats, sample rate). Handles 16/24/32-bit PCM."""
    with wave.open(path, "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())

    if width == 2:
        count = len(frames) // 2
        values = struct.unpack("<%dh" % count, frames)
        scale = 1.0 / 32768.0
    elif width == 3:
        values = []
        for i in range(0, len(frames) - 2, 3):
            v = frames[i] | (frames[i + 1] << 8) | (frames[i + 2] << 16)
            if v & 0x800000:
                v -= 0x1000000
            values.append(v)
        scale = 1.0 / 8388608.0
    elif width == 4:
        count = len(frames) // 4
        values = struct.unpack("<%di" % count, frames)
        scale = 1.0 / 2147483648.0
    else:
        raise SystemExit("unsupported sample width: %d bytes" % width)

    mono = []
    for i in range(0, len(values) - channels + 1, channels):
        mono.append(sum(values[i:i + channels]) * scale / channels)
    return mono, rate


# ------------------------------------------------------------- measurements

def magnitude_at(samples, hz, rate):
    """Magnitude of one frequency component. Both quadratures, so a component
    in quadrature is not silently reported as zero."""
    w = 2.0 * math.pi * hz / rate
    acc = 0j
    for n, x in enumerate(samples):
        acc += x * cmath.exp(-1j * w * n)
    return abs(acc) / max(1, len(samples))


def rms(samples):
    if not samples:
        return 0.0
    return math.sqrt(sum(x * x for x in samples) / len(samples))


def db(x, reference=1.0):
    return 20.0 * math.log10(max(x, 1e-12) / max(reference, 1e-12))


def harmonic_spectrum(samples, f0, rate, count=16):
    """Level of each harmonic relative to the fundamental, in dB."""
    nyquist = rate * 0.5
    fundamental = magnitude_at(samples, f0, rate)
    out = []
    for h in range(1, count + 1):
        hz = f0 * h
        if hz >= nyquist:
            break
        out.append((h, hz, db(magnitude_at(samples, hz, rate), fundamental)))
    return out


def inharmonic_energy(samples, f0, rate):
    """Energy that is not at a harmonic of f0: aliasing and noise."""
    nyquist = rate * 0.5
    total = 0.0
    hz = 300.0
    while hz < nyquist - 300.0:
        ratio = hz / f0
        if abs(ratio - round(ratio)) >= 0.08:
            m = magnitude_at(samples, hz, rate)
            total += m * m
        hz += 37.0
    return math.sqrt(total)


def envelope_fit(samples, rate):
    """Extract attack/decay/sustain/release timings from a rendered note."""
    # Rectify and smooth into an amplitude envelope.
    window = max(1, int(rate * 0.002))
    env, acc = [], 0.0
    coeff = 1.0 / window
    for x in samples:
        acc += coeff * (abs(x) - acc)
        env.append(acc)

    peak = max(env) if env else 0.0
    if peak <= 0.0:
        return {"error": "silent render"}

    peak_index = env.index(peak)
    # Attack: first crossing of 90 % of the peak.
    attack_index = next((i for i, v in enumerate(env) if v >= peak * 0.9), peak_index)
    # Release: after the peak, time from the last point above 50 % to below 1 %.
    tail = env[peak_index:]
    last_half = max((i for i, v in enumerate(tail) if v >= peak * 0.5), default=0)
    end = next((i for i, v in enumerate(tail) if i > last_half and v <= peak * 0.01), len(tail) - 1)
    sustain_level = env[int(len(env) * 0.5)] / peak if peak > 0 else 0.0
    return {
        "peak": round(peak, 6),
        "attack_ms": round(attack_index / rate * 1000.0, 2),
        "release_ms": round((end - last_half) / rate * 1000.0, 2),
        "sustain_ratio": round(sustain_level, 4),
    }


# ------------------------------------------------------------------ commands

def cmd_spectrum(args):
    samples, rate = read_wav(args.wav)
    # Skip the attack so the measurement sees steady state.
    body = samples[int(rate * 0.2):int(rate * 0.2) + (1 << 15)]
    if not body:
        body = samples
    harmonics = harmonic_spectrum(body, args.f0, rate, args.harmonics)
    result = {
        "file": args.wav,
        "sample_rate": rate,
        "f0": args.f0,
        "rms_dbfs": round(db(rms(body)), 2),
        "harmonics_db": [{"n": h, "hz": round(hz, 1), "db": round(level, 2)}
                         for h, hz, level in harmonics],
        "inharmonic_db": round(db(inharmonic_energy(body, args.f0, rate),
                                  magnitude_at(body, args.f0, rate)), 2),
    }
    print(json.dumps(result, indent=1))


def cmd_envelope(args):
    samples, rate = read_wav(args.wav)
    result = envelope_fit(samples, rate)
    result["file"] = args.wav
    result["sample_rate"] = rate
    print(json.dumps(result, indent=1))


def cmd_sweep(args):
    """Render a filter sweep and report the measured corner at each setting.

    This is the filter-sweep measurement Milestone 7 asks for: it renders the
    real engine rather than modelling it, so the numbers describe what ships.
    """
    import os
    import tempfile

    exe = os.path.abspath(args.exe)
    if not os.path.isfile(exe):
        raise SystemExit("renderer not found: %s (build it first)" % exe)

    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for cutoff in args.cutoffs:
            for resonance in args.resonances:
                out = os.path.join(tmp, "s.wav")
                cmd = [exe, "--out", out, "--note", str(args.note),
                       "--seconds", "1.2", "--gate", "1.0", "--saw", "1.0",
                       "--cutoff", str(cutoff), "--res", str(resonance),
                       "--attack", "0.001", "--decay", "0.001", "--sustain", "1.0",
                       "--env-cutoff", "0.0", "--no-normalise"]
                proc = subprocess.run(cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    raise SystemExit("render failed: %s" % proc.stderr.strip())
                samples, rate = read_wav(out)
                body = samples[int(rate * 0.3):int(rate * 0.3) + (1 << 15)]
                f0 = 440.0 * (2.0 ** ((args.note - 69) / 12.0))
                rows.append({
                    "cutoff": cutoff,
                    "resonance": resonance,
                    "rms_dbfs": round(db(rms(body)), 2),
                    "fundamental_db": round(db(magnitude_at(body, f0, rate)), 2),
                    "at_cutoff_db": round(db(magnitude_at(body, cutoff, rate)), 2),
                })
    print(json.dumps({"sweep": rows}, indent=1))


def cmd_compare(args):
    """Compare our render against a reference recording, like for like."""
    ours, rate_a = read_wav(args.ours)
    theirs, rate_b = read_wav(args.reference)
    if rate_a != rate_b:
        raise SystemExit("sample rates differ: %d vs %d" % (rate_a, rate_b))

    def body(x):
        start = int(rate_a * 0.2)
        return x[start:start + (1 << 15)] or x

    a, b = body(ours), body(theirs)
    # Loudness-match before comparing timbre, or the comparison is meaningless.
    ra, rb = rms(a), rms(b)
    if ra > 0:
        a = [x * (rb / ra) for x in a]

    ha = dict((h, level) for h, _, level in harmonic_spectrum(a, args.f0, rate_a, args.harmonics))
    hb = dict((h, level) for h, _, level in harmonic_spectrum(b, args.f0, rate_a, args.harmonics))
    rows, worst, total = [], 0.0, 0.0
    for h in sorted(set(ha) & set(hb)):
        delta = ha[h] - hb[h]
        rows.append({"n": h, "ours_db": round(ha[h], 2), "reference_db": round(hb[h], 2),
                     "delta_db": round(delta, 2)})
        worst = max(worst, abs(delta))
        total += delta * delta
    print(json.dumps({
        "ours": args.ours,
        "reference": args.reference,
        "harmonics": rows,
        "worst_delta_db": round(worst, 2),
        "rms_delta_db": round(math.sqrt(total / max(1, len(rows))), 2),
    }, indent=1))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("spectrum", help="harmonic content of a render")
    p.add_argument("wav")
    p.add_argument("--f0", type=float, required=True)
    p.add_argument("--harmonics", type=int, default=16)
    p.set_defaults(func=cmd_spectrum)

    p = sub.add_parser("envelope", help="fit attack/release timings")
    p.add_argument("wav")
    p.set_defaults(func=cmd_envelope)

    p = sub.add_parser("sweep", help="render and measure a filter sweep")
    p.add_argument("--exe", required=True)
    p.add_argument("--note", type=int, default=45)
    p.add_argument("--cutoffs", type=float, nargs="+", default=[200, 800, 3000, 8000])
    p.add_argument("--resonances", type=float, nargs="+", default=[0.0, 0.5, 0.9])
    p.set_defaults(func=cmd_sweep)

    p = sub.add_parser("compare", help="compare a render against a reference")
    p.add_argument("ours")
    p.add_argument("reference")
    p.add_argument("--f0", type=float, required=True)
    p.add_argument("--harmonics", type=int, default=16)
    p.set_defaults(func=cmd_compare)

    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
