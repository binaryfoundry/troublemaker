# -*- coding: utf-8 -*-
"""Project-level commands: capabilities, state summary, tempo, transport, undo."""

from .. import errors
from .. import lom
from ..dispatch import req_float, req_int, opt_bool

MIN_TEMPO = 20.0
MAX_TEMPO = 999.0


def _has_extended_note_api():
    try:
        import Live

        return hasattr(Live.Clip.Clip, "get_notes_extended") and hasattr(
            Live.Clip, "MidiNoteSpecification"
        )
    except Exception:
        return False


def _has_clip_automation_api():
    try:
        import Live

        return hasattr(Live.Clip.Clip, "automation_envelope")
    except Exception:
        return False


def _has_device_insertion():
    try:
        import Live

        return hasattr(Live.Track.Track, "insert_device")
    except Exception:
        return False


def _has(path, attribute):
    try:
        import Live

        target = Live
        for part in path:
            target = getattr(target, part)
        return hasattr(target, attribute)
    except Exception:
        return False


def ping(ctx, args):
    """Cheap liveness probe. The bridge heartbeat uses this."""
    return {
        "pong": True,
        "tempo": float(ctx.song.tempo),
        "is_playing": bool(ctx.song.is_playing),
    }


def get_capabilities(ctx, args):
    """What this Live install can actually do. The agent must consult this
    rather than assuming an API exists."""
    app = ctx.app
    version = None
    if app is not None:
        version = "%d.%d.%d" % (
            app.get_major_version(),
            app.get_minor_version(),
            app.get_bugfix_version(),
        )
    extended_notes = _has_extended_note_api()
    return {
        "live_version": version,
        "transport": True,
        "tempo": True,
        "tracks": True,
        "track_creation": True,
        "scenes": True,
        "scene_creation": True,
        "clip_creation": True,
        "midi_notes": True,
        "note_ids": extended_notes,
        "note_probability": extended_notes,
        "device_parameters": True,
        "device_loading": False,
        # Live 12.3+: native devices can be inserted through the API.
        "device_insertion": _has_device_insertion(),
        "arrangement_placement": _has(("Track", "Track"), "duplicate_clip_to_arrangement"),
        "return_track_creation": _has(("Song", "Song"), "create_return_track"),
        "clip_automation": _has_clip_automation_api(),
        "arrangement_editing": False,
        "audio_warping": False,
        "audio_clip_editing": False,
        "undo": True,
        "selection": True,
    }


def get_project_state(ctx, args):
    """Compact overview. Deliberately excludes notes and device parameters -
    those are fetched per object so context stays small."""
    song = ctx.song
    include_devices = opt_bool(args, "include_devices", True)
    include_return_tracks = opt_bool(args, "include_return_tracks", False)
    ctx.registry.prune()

    tracks = [
        lom.serialize_track(ctx, t, song, with_clips=True, with_devices=include_devices)
        for t in song.tracks
    ]
    state = {
        "tempo": float(song.tempo),
        "time_signature": [int(song.signature_numerator), int(song.signature_denominator)],
        "playing": bool(song.is_playing),
        "current_song_time": float(song.current_song_time),
        "scene_count": len(song.scenes),
        "track_count": len(song.tracks),
        "tracks": tracks,
        "scenes": [lom.serialize_scene(ctx, s, i) for i, s in enumerate(song.scenes)],
    }
    if include_return_tracks:
        state["return_tracks"] = [
            lom.serialize_track(ctx, t, song, with_clips=False, with_devices=include_devices)
            for t in song.return_tracks
        ]
        state["master_track"] = lom.serialize_track(
            ctx, song.master_track, song, with_clips=False, with_devices=include_devices
        )
    return state


def get_tempo(ctx, args):
    return {"bpm": float(ctx.song.tempo)}


def set_tempo(ctx, args):
    bpm = req_float(args, "bpm")
    if bpm < MIN_TEMPO or bpm > MAX_TEMPO:
        raise errors.InvalidArgument(
            "Tempo %.3f is outside Live's range." % (bpm,), min=MIN_TEMPO, max=MAX_TEMPO
        )
    ctx.song.tempo = bpm
    return {"bpm": float(ctx.song.tempo)}


def get_time_signature(ctx, args):
    return {
        "numerator": int(ctx.song.signature_numerator),
        "denominator": int(ctx.song.signature_denominator),
    }


def set_time_signature(ctx, args):
    numerator = req_int(args, "numerator")
    denominator = req_int(args, "denominator")
    if numerator < 1 or numerator > 99:
        raise errors.InvalidArgument("Time signature numerator must be 1-99.")
    if denominator not in (1, 2, 4, 8, 16):
        raise errors.InvalidArgument(
            "Time signature denominator must be one of 1, 2, 4, 8, 16."
        )
    ctx.song.signature_numerator = numerator
    ctx.song.signature_denominator = denominator
    return get_time_signature(ctx, {})


def get_transport(ctx, args):
    song = ctx.song
    return {
        "playing": bool(song.is_playing),
        "record_mode": bool(song.record_mode),
        "current_song_time": float(song.current_song_time),
        "tempo": float(song.tempo),
        "metronome": bool(song.metronome),
        "loop": bool(song.loop),
    }


def play(ctx, args):
    ctx.song.start_playing()
    return get_transport(ctx, {})


def stop(ctx, args):
    ctx.song.stop_playing()
    return get_transport(ctx, {})


def continue_playing(ctx, args):
    ctx.song.continue_playing()
    return get_transport(ctx, {})


def set_song_time(ctx, args):
    beat = req_float(args, "beat")
    if beat < 0:
        raise errors.InvalidArgument("Song position must be >= 0 beats.")
    ctx.song.current_song_time = beat
    return {"current_song_time": float(ctx.song.current_song_time)}


def stop_all_clips(ctx, args):
    ctx.song.stop_all_clips()
    return {"stopped": True}


def set_metronome(ctx, args):
    enabled = opt_bool(args, "enabled", None)
    if enabled is None:
        raise errors.InvalidArgument("Missing required argument 'enabled'.")
    ctx.song.metronome = enabled
    return {"metronome": bool(ctx.song.metronome)}


def undo(ctx, args):
    if not ctx.song.can_undo:
        raise errors.Unsupported("There is nothing to undo in this Live Set.")
    ctx.song.undo()
    return {"undone": True, "can_undo": bool(ctx.song.can_undo)}


def redo(ctx, args):
    if not ctx.song.can_redo:
        raise errors.Unsupported("There is nothing to redo in this Live Set.")
    ctx.song.redo()
    return {"redone": True, "can_redo": bool(ctx.song.can_redo)}


COMMANDS = {
    "ping": ping,
    "live.get_capabilities": get_capabilities,
    "live.get_project_state": get_project_state,
    "live.get_tempo": get_tempo,
    "live.set_tempo": set_tempo,
    "live.get_time_signature": get_time_signature,
    "live.set_time_signature": set_time_signature,
    "live.get_transport": get_transport,
    "live.play": play,
    "live.stop": stop,
    "live.continue_playing": continue_playing,
    "live.stop_all_clips": stop_all_clips,
    "live.set_song_time": set_song_time,
    "live.set_metronome": set_metronome,
    "live.undo": undo,
    "live.redo": redo,
}
