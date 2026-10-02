# -*- coding: utf-8 -*-
"""Recording the Master output inside Live.

Live has no export API, but it can record its own output: an audio track
whose input is "Resampling" captures everything reaching the Master, after
the Master chain. That gives the agent a real file of the current mix to
measure, without GUI automation. These commands are the mechanical pieces;
the bridge sequences them and waits for the recording to finish.
"""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_float, req_str, opt_int, opt_str

MONITORING = {"in": 0, "auto": 1, "off": 2}
MONITORING_NAMES = dict((v, k) for k, v in MONITORING.items())


def create_audio_track(ctx, args):
    song = ctx.song
    index = opt_int(args, "index")
    if index is None:
        index = len(song.tracks)
    if index < 0 or index > len(song.tracks):
        raise errors.InvalidArgument(
            "Track index %d is out of range (0..%d)." % (index, len(song.tracks))
        )
    try:
        song.create_audio_track(index)
    except Exception as exc:
        raise errors.LiveError("Live refused to create an audio track: %s" % (exc,))
    track = song.tracks[index]
    name = opt_str(args, "name")
    if name:
        track.name = name
    return lom.serialize_track(ctx, track, song, with_clips=True, with_devices=True)


def _routing_names(track):
    return [str(r.display_name) for r in lom.safe(lambda: list(track.available_input_routing_types), [])]


def get_input_routing(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    current = lom.safe(lambda: track.input_routing_type, None)
    return {
        "track_id": ctx.registry.handle_for(track),
        "current": str(current.display_name) if current is not None else None,
        "available": _routing_names(track),
        "monitoring": MONITORING_NAMES.get(lom.safe(lambda: int(track.current_monitoring_state), -1)),
    }


def set_input_routing(ctx, args):
    """Choose a track's input by its display name, e.g. 'Resampling'."""
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    wanted = req_str(args, "routing").strip().lower()
    options = lom.safe(lambda: list(track.available_input_routing_types), [])
    if not options:
        raise errors.Unsupported(
            "Track '%s' exposes no input routings through the API." % (track.name,)
        )
    for option in options:
        if str(option.display_name).strip().lower() == wanted:
            track.input_routing_type = option
            return get_input_routing(ctx, {"track_id": args["track_id"]})
    raise errors.InvalidArgument(
        "Track '%s' has no input routing %r." % (track.name, args["routing"]),
        available_routings=[str(o.display_name) for o in options],
    )


def set_monitoring(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    state = req_str(args, "state").strip().lower()
    if state not in MONITORING:
        raise errors.InvalidArgument(
            "Monitoring must be one of in, auto, off.", available=sorted(MONITORING)
        )
    try:
        track.current_monitoring_state = MONITORING[state]
    except Exception as exc:
        raise errors.LiveError("Cannot set monitoring on '%s': %s" % (track.name, exc))
    return {"track_id": ctx.registry.handle_for(track), "monitoring": state}


def record_clip(ctx, args):
    """Start recording a fixed number of beats into an empty slot of an armed track."""
    track, slot = lom.resolve_clip_slot(ctx, req_int(args, "track_id"), req_int(args, "clip_slot"))
    length = req_float(args, "length_beats")
    if length <= 0:
        raise errors.InvalidArgument("length_beats must be greater than 0.")
    if not lom.safe(lambda: bool(track.can_be_armed), False):
        raise errors.InvalidArgument("Track '%s' cannot be armed for recording." % (track.name,))
    if not track.arm:
        raise errors.InvalidArgument("Arm track '%s' before recording into it." % (track.name,))
    if slot.has_clip:
        raise errors.InvalidArgument(
            "Slot %d on '%s' already holds a clip; record into an empty slot."
            % (req_int(args, "clip_slot"), track.name)
        )
    try:
        slot.fire(record_length=length)
    except TypeError:
        raise errors.Unsupported(
            "This Live version cannot record a fixed length through the API."
        )
    return {
        "track_id": ctx.registry.handle_for(track),
        "clip_slot": req_int(args, "clip_slot"),
        "length_beats": length,
        "started": True,
    }


def record_with_scene(ctx, args):
    """Launch a scene and start recording in the same tick.

    Sent as two commands, the scene starts at once from a stopped transport
    while the recording, arriving a moment later, waits for the next bar - so
    every capture missed the scene's first bar. Triggered together, both
    launch on the same quantised boundary.
    """
    track, slot = lom.resolve_clip_slot(ctx, req_int(args, "track_id"), req_int(args, "clip_slot"))
    scene = lom.resolve_scene(ctx, req_int(args, "scene_id"))
    length = req_float(args, "length_beats")
    if length <= 0:
        raise errors.InvalidArgument("length_beats must be greater than 0.")
    if not track.arm:
        raise errors.InvalidArgument("Arm track '%s' before recording into it." % (track.name,))
    if slot.has_clip:
        raise errors.InvalidArgument("Record into an empty slot on '%s'." % (track.name,))
    scene.fire()
    try:
        slot.fire(record_length=length)
    except TypeError:
        raise errors.Unsupported("This Live version cannot record a fixed length through the API.")
    return {"track_id": ctx.registry.handle_for(track), "clip_slot": req_int(args, "clip_slot"), "started": True}


def get_clip_slot_status(ctx, args):
    track, slot = lom.resolve_clip_slot(ctx, req_int(args, "track_id"), req_int(args, "clip_slot"))
    clip = slot.clip if slot.has_clip else None
    return {
        "track_id": ctx.registry.handle_for(track),
        "clip_slot": req_int(args, "clip_slot"),
        "has_clip": clip is not None,
        "is_recording": lom.safe(lambda: bool(clip.is_recording), False) if clip else False,
        "is_triggered": lom.safe(lambda: bool(slot.is_triggered), False),
        "is_playing": lom.safe(lambda: bool(clip.is_playing), False) if clip else False,
        "length_beats": lom.safe(lambda: float(clip.length), None) if clip else None,
        "file_path": lom.safe(lambda: str(clip.file_path), None) if clip and not clip.is_midi_clip else None,
    }


def get_record_settings(ctx, args):
    song = ctx.song
    app = ctx.app
    sample_rate = None
    try:
        sample_rate = int(app.audio_device.sample_rate) if app is not None else None
    except Exception:
        sample_rate = None
    return {
        "tempo": float(song.tempo),
        "signature": [int(song.signature_numerator), int(song.signature_denominator)],
        "clip_trigger_quantization": lom.safe(lambda: int(song.clip_trigger_quantization), None),
        "sample_rate": sample_rate,
    }


COMMANDS = {
    "live.create_audio_track": create_audio_track,
    "live.get_input_routing": get_input_routing,
    "live.set_input_routing": set_input_routing,
    "live.set_monitoring": set_monitoring,
    "live.record_clip": record_clip,
    "live.record_with_scene": record_with_scene,
    "live.get_clip_slot_status": get_clip_slot_status,
    "live.get_record_settings": get_record_settings,
}
