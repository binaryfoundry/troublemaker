# -*- coding: utf-8 -*-
"""Track enumeration, creation and mixer control."""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_float, req_str, opt_str, opt_float, opt_bool


def get_tracks(ctx, args):
    song = ctx.song
    include_devices = opt_bool(args, "include_devices", False)
    include_clips = opt_bool(args, "include_clips", False)
    return {
        "tracks": [
            lom.serialize_track(
                ctx, t, song, with_clips=include_clips, with_devices=include_devices
            )
            for t in song.tracks
        ],
        "return_tracks": [
            lom.serialize_track(ctx, t, song, with_clips=False, with_devices=include_devices)
            for t in song.return_tracks
        ],
        "master_track": lom.serialize_track(
            ctx, song.master_track, song, with_clips=False, with_devices=include_devices
        ),
    }


def get_track(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    return lom.serialize_track(ctx, track, ctx.song, with_clips=True, with_devices=True)


def create_midi_track(ctx, args):
    song = ctx.song
    index = args.get("index")
    if index is None:
        index = len(song.tracks)
    else:
        index = req_int(args, "index")
        if index < 0 or index > len(song.tracks):
            raise errors.InvalidArgument(
                "Track index %d is out of range (0..%d)." % (index, len(song.tracks))
            )
    before = len(song.tracks)
    try:
        song.create_midi_track(index)
    except Exception as exc:
        # Live Intro caps a Set at 16 tracks; say so instead of failing opaquely.
        raise errors.LiveError(
            "Live refused to create a MIDI track: %s. Live Intro limits a Set to "
            "16 tracks - delete a track or use a larger edition." % (exc,),
            track_count=before,
        )
    track = song.tracks[index]
    name = opt_str(args, "name")
    if name:
        track.name = name
    return lom.serialize_track(ctx, track, song, with_clips=True, with_devices=True)


def rename_track(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    name = req_str(args, "name")
    if not name.strip():
        raise errors.InvalidArgument("Track name must not be empty.")
    track.name = name
    return {"track_id": ctx.registry.handle_for(track), "name": track.name}


def _set_mixer_parameter(ctx, param, args, label):
    """Accept either a native 'value' or a 0..1 'normalized' value."""
    minimum = float(param.min)
    maximum = float(param.max)
    if "normalized" in args and args["normalized"] is not None:
        normalized = req_float(args, "normalized")
        if normalized < 0.0 or normalized > 1.0:
            raise errors.InvalidArgument(
                "'normalized' must be between 0.0 and 1.0.", given=normalized
            )
        value = minimum + normalized * (maximum - minimum)
    elif "value" in args and args["value"] is not None:
        value = req_float(args, "value")
        if value < minimum or value > maximum:
            raise errors.InvalidArgument(
                "%s value %.4f is outside the parameter range." % (label, value),
                min=minimum,
                max=maximum,
            )
    else:
        raise errors.InvalidArgument(
            "Provide either 'value' (native units) or 'normalized' (0.0-1.0)."
        )
    param.value = value
    return lom.serialize_parameter(ctx, param)


def set_track_volume(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    param = track.mixer_device.volume
    return {
        "track_id": ctx.registry.handle_for(track),
        "volume": _set_mixer_parameter(ctx, param, args, "Volume"),
    }


def set_track_pan(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    param = track.mixer_device.panning
    if param is None:
        raise errors.Unsupported("This track has no panning parameter.")
    return {
        "track_id": ctx.registry.handle_for(track),
        "pan": _set_mixer_parameter(ctx, param, args, "Pan"),
    }


def set_track_send(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    send_index = req_int(args, "send_index")
    sends = list(track.mixer_device.sends)
    if send_index < 0 or send_index >= len(sends):
        raise errors.InvalidArgument(
            "Track '%s' has %d sends; send_index %d is out of range."
            % (track.name, len(sends), send_index),
            send_count=len(sends),
        )
    return {
        "track_id": ctx.registry.handle_for(track),
        "send_index": send_index,
        "send": _set_mixer_parameter(ctx, sends[send_index], args, "Send"),
    }


def _set_track_flag(attribute, label):
    def handler(ctx, args):
        track = lom.resolve_track(ctx, req_int(args, "track_id"))
        enabled = opt_bool(args, "enabled", None)
        if enabled is None:
            raise errors.InvalidArgument("Missing required argument 'enabled'.")
        try:
            setattr(track, attribute, enabled)
        except Exception as exc:
            raise errors.LiveError("Cannot set %s on '%s': %s" % (label, track.name, exc))
        return {
            "track_id": ctx.registry.handle_for(track),
            attribute: bool(getattr(track, attribute)),
        }

    return handler


COMMANDS = {
    "live.get_tracks": get_tracks,
    "live.get_track": get_track,
    "live.create_midi_track": create_midi_track,
    "live.rename_track": rename_track,
    "live.set_track_volume": set_track_volume,
    "live.set_track_pan": set_track_pan,
    "live.set_track_send": set_track_send,
    "live.set_track_mute": _set_track_flag("mute", "mute"),
    "live.set_track_solo": _set_track_flag("solo", "solo"),
    "live.set_track_arm": _set_track_flag("arm", "arm"),
}
