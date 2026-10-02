# -*- coding: utf-8 -*-
"""Clip slots and clips: enumerate, create, delete, loop, launch."""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_float, req_str, opt_float, opt_bool

MAX_CLIP_LENGTH_BEATS = 4096.0


def get_clip_slots(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    slots = []
    for index, slot in enumerate(track.clip_slots):
        entry = {
            "slot": index,
            "has_clip": bool(slot.has_clip),
            "has_stop_button": bool(slot.has_stop_button),
        }
        if slot.has_clip:
            entry["clip"] = lom.serialize_clip(ctx, slot.clip, slot_index=index)
        slots.append(entry)
    return {"track_id": ctx.registry.handle_for(track), "clip_slots": slots}


def get_clip(ctx, args):
    track, slot, clip = lom.resolve_clip(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    out = lom.serialize_clip(ctx, clip, slot_index=req_int(args, "clip_slot"))
    out["track_id"] = ctx.registry.handle_for(track)
    if clip.is_midi_clip:
        out["note_count"] = len(_read_notes_raw(clip))
    return out


def create_midi_clip(ctx, args):
    track = lom.resolve_midi_track(ctx, req_int(args, "track_id"))
    slot_index = req_int(args, "clip_slot")
    length = req_float(args, "length_beats")
    if length <= 0 or length > MAX_CLIP_LENGTH_BEATS:
        raise errors.InvalidArgument(
            "length_beats must be > 0 and <= %g." % (MAX_CLIP_LENGTH_BEATS,)
        )
    _, slot = lom.resolve_clip_slot(ctx, req_int(args, "track_id"), slot_index)
    replace = opt_bool(args, "replace_existing", False)
    if slot.has_clip:
        if not replace:
            raise errors.InvalidArgument(
                "Track '%s' clip slot %d already holds a clip. Pass "
                "replace_existing=true to overwrite it." % (track.name, slot_index)
            )
        slot.delete_clip()
    slot.create_clip(length)
    clip = slot.clip
    name = args.get("name")
    if isinstance(name, str) and name.strip():
        clip.name = name
    out = lom.serialize_clip(ctx, clip, slot_index=slot_index)
    out["track_id"] = ctx.registry.handle_for(track)
    return out


def delete_clip(ctx, args):
    track, slot, clip = lom.resolve_clip(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    slot.delete_clip()
    return {
        "track_id": ctx.registry.handle_for(track),
        "clip_slot": req_int(args, "clip_slot"),
        "deleted": True,
    }


def set_clip_name(ctx, args):
    track, slot, clip = lom.resolve_clip(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    clip.name = req_str(args, "name")
    return lom.serialize_clip(ctx, clip, slot_index=req_int(args, "clip_slot"))


def set_clip_loop(ctx, args):
    """Set the loop region in beats. 'length' is a convenience for end-start."""
    track, slot, clip = lom.resolve_clip(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    start = opt_float(args, "start", float(clip.loop_start))
    if "length" in args and args["length"] is not None:
        length = req_float(args, "length")
        if length <= 0:
            raise errors.InvalidArgument("Loop 'length' must be greater than 0.")
        end = start + length
    elif "end" in args and args["end"] is not None:
        end = req_float(args, "end")
    else:
        raise errors.InvalidArgument("Provide either 'length' or 'end' (in beats).")
    if end <= start:
        raise errors.InvalidArgument(
            "Loop end (%.4f) must be greater than loop start (%.4f)." % (end, start)
        )
    if end > MAX_CLIP_LENGTH_BEATS:
        raise errors.InvalidArgument("Loop end exceeds %g beats." % (MAX_CLIP_LENGTH_BEATS,))

    looping = opt_bool(args, "looping", True)
    clip.looping = True
    # Widen the markers first so the new region is never momentarily invalid.
    if end > float(clip.end_marker):
        clip.end_marker = end
    clip.loop_start = start
    clip.loop_end = end
    clip.start_marker = start
    clip.end_marker = end
    clip.looping = looping
    return lom.serialize_clip(ctx, clip, slot_index=req_int(args, "clip_slot"))


def fire_clip(ctx, args):
    track, slot, clip = lom.resolve_clip(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    slot.fire()
    return {"fired": True, "clip_id": ctx.registry.handle_for(clip)}


def stop_clip(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    track.stop_all_clips()
    return {"track_id": ctx.registry.handle_for(track), "stopped": True}


def _read_notes_raw(clip):
    """Fetch every note, preferring Live 11's note-id API."""
    if hasattr(clip, "get_notes_extended"):
        return list(clip.get_notes_extended(0, 128, 0.0, clip.length + 1.0))
    return list(clip.get_notes(0.0, 0, clip.length + 1.0, 128))


COMMANDS = {
    "live.get_clip_slots": get_clip_slots,
    "live.get_clip": get_clip,
    "live.create_midi_clip": create_midi_clip,
    "live.delete_clip": delete_clip,
    "live.set_clip_name": set_clip_name,
    "live.set_clip_loop": set_clip_loop,
    "live.fire_clip": fire_clip,
    "live.stop_clip": stop_clip,
}
