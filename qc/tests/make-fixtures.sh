#!/usr/bin/env bash
# Synthetic club-style fixtures for QC tests: a 128 BPM kick with a sub tail,
# offbeat-ish hats from filtered noise, and a chord pad. Deterministic, so the
# tests can assert on measured properties.
#
#   bash qc/tests/make-fixtures.sh <out-dir> [seconds]
set -euo pipefail
OUT="${1:?usage: make-fixtures.sh <out-dir> [seconds]}"
SECS="${2:-40}"
mkdir -p "$OUT"
BEAT=0.46875

# kick: 50 Hz body with a fast pitch drop and exponential decay, every beat.
KICK="0.9*sin(2*PI*(48+120*exp(-40*mod(t,$BEAT)))*mod(t,$BEAT))*exp(-7*mod(t,$BEAT))"
PAD="0.06*(sin(2*PI*220*t)+sin(2*PI*261.6*t)+sin(2*PI*329.6*t))"

render() { # name, right-channel bass expression, extra top-end gain dB, limiter input gain dB, codec
  local name="$1" right_kick="$2" top_db="$3" drive_db="$4" codec="${5:-pcm_s24le}"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "aevalsrc=exprs='$KICK+$PAD'|'$right_kick+$PAD':s=48000:d=$SECS" \
    -f lavfi -i "anoisesrc=color=white:seed=7:a=0.05:r=48000:d=$SECS" \
    -filter_complex "[1:a]highpass=f=6000,highpass=f=6000,volume=${top_db}dB,aformat=channel_layouts=stereo[h];[0:a][h]amix=inputs=2:normalize=0,volume=${drive_db}dB[m];[m]alimiter=limit=0.89:level=false:attack=2:release=40[o]" \
    -map "[o]" -c:a "$codec" "$OUT/$name.wav"
}

render ref1 "$KICK" 0 6
render ref2 "$KICK" 1 7
render ref3 "$KICK" -1 6.5
render good "$KICK" 0 6.3
# bad: bass partly out of phase on the right, a hot top end, and driven into
# hard clipping by a final gain stage the limiter cannot catch.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "aevalsrc=exprs='$KICK+$PAD'|'-0.8*($KICK)+$PAD':s=48000:d=$SECS" \
  -f lavfi -i "anoisesrc=color=white:seed=7:a=0.05:r=48000:d=$SECS" \
  -filter_complex "[1:a]highpass=f=6000,highpass=f=6000,volume=9dB,aformat=channel_layouts=stereo[h];[0:a][h]amix=inputs=2:normalize=0,volume=10dB[o]" \
  -map "[o]" -c:a pcm_s16le "$OUT/bad.wav"
echo "fixtures in $OUT"
