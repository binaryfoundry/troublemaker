# -*- coding: utf-8 -*-
"""Arrangement View placement and return tracks.

The composition workflow builds sections as Session scenes and then lays them
out on the Arrangement timeline. Live 11+ can copy a Session clip into the
Arrangement at a beat position; these commands expose that, mechanically.
Which section goes where is decided by the agent.
"""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_float, opt_str


def place_clip_in_arrangement(ctx, args):
    """Copy the clip in a Session slot onto the Arrangement at a beat."""
    track, slot, clip = lom.resolve_clip(ctx, req_int(args, "track_id"), req_int(args, "clip_slot"))
    beat = req_float(args, "beat")
    if beat < 0:
        raise errors.InvalidArgument("Arrangement position must be >= 0 beats.")
    if not hasattr(track, "duplicate_clip_to_arrangement"):
        raise errors.Unsupported("This Live version cannot place clips in the Arrangement via the API.")
    try:
        track.duplicate_clip_to_arrangement(clip, beat)
    except Exception as exc:
        raise errors.LiveError("Live refused to place the clip at beat %g: %s" % (beat, exc))
    return {"track_id": ctx.registry.handle_for(track), "beat": beat, "length_beats": float(clip.length)}


def get_arrangement_clips(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    clips = lom.safe(lambda: list(track.arrangement_clips), None)
    if clips is None:
        raise errors.Unsupported("This Live version does not expose Arrangement clips.")
    return {
        "track_id": ctx.registry.handle_for(track),
        "clips": [
            {
                "name": lom.safe(lambda: c.name, ""),
                "start": lom.safe(lambda: float(c.start_time), None),
                "end": lom.safe(lambda: float(c.end_time), None),
                "length_beats": lom.safe(lambda: float(c.length), None),
                "is_midi_clip": lom.safe(lambda: bool(c.is_midi_clip), None),
            }
            for c in clips
        ],
    }


def clear_arrangement(ctx, args):
    """Delete every Arrangement clip on a track. Destructive."""
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    clips = lom.safe(lambda: list(track.arrangement_clips), None)
    if clips is None or not hasattr(track, "delete_clip"):
        raise errors.Unsupported("This Live version cannot delete Arrangement clips via the API.")
    removed = 0
    for clip in clips:
        try:
            track.delete_clip(clip)
            removed += 1
        except Exception:
            pass
    return {"track_id": ctx.registry.handle_for(track), "removed": removed}


def create_return_track(ctx, args):
    song = ctx.song
    if not hasattr(song, "create_return_track"):
        raise errors.Unsupported("This Live version cannot create return tracks via the API.")
    before = len(song.return_tracks)
    try:
        song.create_return_track()
    except Exception as exc:
        raise errors.LiveError("Live refused to create a return track: %s" % (exc,))
    returns = list(song.return_tracks)
    if len(returns) <= before:
        raise errors.LiveError("Live reported success but no return track was added.")
    track = returns[-1]
    name = opt_str(args, "name")
    if name:
        track.name = name
    return lom.serialize_track(ctx, track, song, with_clips=False, with_devices=True)


COMMANDS = {
    "live.place_clip_in_arrangement": place_clip_in_arrangement,
    "live.get_arrangement_clips": get_arrangement_clips,
    "live.clear_arrangement": clear_arrangement,
    "live.create_return_track": create_return_track,
}
