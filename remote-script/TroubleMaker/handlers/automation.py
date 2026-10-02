# -*- coding: utf-8 -*-
"""Clip-envelope automation.

Scope is deliberately narrow: envelopes inside Session clips, which is what
the Live API exposes reliably. Arrangement-view automation is NOT attempted -
set_automation reports a capability error there rather than silently writing
something else or resorting to GUI automation.
"""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_float, req_list, opt_int, opt_str


def _envelope(clip, param, create=False):
    envelope = None
    try:
        envelope = clip.automation_envelope(param)
    except Exception:
        envelope = None
    if envelope is None and create:
        if not hasattr(clip, "create_automation_envelope"):
            raise errors.Unsupported(
                "This Live version cannot create clip automation envelopes."
            )
        try:
            envelope = clip.create_automation_envelope(param)
        except Exception as exc:
            raise errors.Unsupported(
                "Live cannot automate parameter '%s' inside a clip: %s" % (param.name, exc)
            )
    return envelope


class _MixerTarget(object):
    """Stands in for a device so mixer parameters share the automation code."""

    def __init__(self, name):
        self.name = name


def _mixer_parameter(track, target):
    """'volume', 'pan' or 'send:N' on the track's mixer."""
    mixer = track.mixer_device
    if target == "volume":
        return mixer.volume
    if target == "pan":
        return mixer.panning
    if target.startswith("send:"):
        try:
            index = int(target.split(":", 1)[1])
        except ValueError:
            raise errors.InvalidArgument("Mixer target must be volume, pan or send:N.")
        sends = list(mixer.sends)
        if index < 0 or index >= len(sends):
            raise errors.InvalidArgument(
                "Track '%s' has %d sends; send %d is out of range." % (track.name, len(sends), index),
                send_count=len(sends),
            )
        return sends[index]
    raise errors.InvalidArgument("Mixer target must be volume, pan or send:N.")


def _resolve(ctx, args):
    track, slot, clip = lom.resolve_clip(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    mixer = opt_str(args, "mixer")
    if mixer:
        return track, clip, _MixerTarget("Mixer"), _mixer_parameter(track, mixer)
    track_, device, param = lom.resolve_parameter(
        ctx,
        req_int(args, "track_id"),
        req_int(args, "device_id"),
        parameter_id=opt_int(args, "parameter_id"),
        parameter_name=opt_str(args, "parameter_name"),
    )
    return track, clip, device, param


def get_automation(ctx, args):
    """Sample the envelope on a grid so the agent can see its shape."""
    track, clip, device, param = _resolve(ctx, args)
    envelope = _envelope(clip, param, create=False)
    if envelope is None:
        return {
            "track_id": ctx.registry.handle_for(track),
            "parameter_id": ctx.registry.handle_for(param),
            "parameter_name": param.name,
            "has_envelope": False,
            "points": [],
        }
    resolution = req_float(args, "resolution") if "resolution" in args else 0.25
    if resolution <= 0:
        raise errors.InvalidArgument("'resolution' must be greater than 0 beats.")
    length = float(clip.length)
    points = []
    beat = 0.0
    while beat <= length + 1e-9:
        try:
            value = float(envelope.value_at_time(beat))
        except Exception:
            break
        points.append({"beat": round(beat, 6), "value": round(value, 6)})
        beat += resolution
    return {
        "track_id": ctx.registry.handle_for(track),
        "parameter_id": ctx.registry.handle_for(param),
        "parameter_name": param.name,
        "has_envelope": True,
        "min": float(param.min),
        "max": float(param.max),
        "resolution": resolution,
        "points": points,
    }


def set_automation(ctx, args):
    """Write a breakpoint ramp.

    Live's clip envelope API offers insert_step(time, length, value), so a
    smooth ramp is approximated by stepping between the supplied breakpoints
    at 'step' resolution. Points take 'value' (native) or 'normalized'.
    """
    track, clip, device, param = _resolve(ctx, args)
    raw_points = req_list(args, "points")
    if len(raw_points) < 1:
        raise errors.InvalidArgument("'points' needs at least one breakpoint.")
    minimum = float(param.min)
    maximum = float(param.max)
    span = maximum - minimum

    points = []
    for index, point in enumerate(raw_points):
        if not isinstance(point, dict):
            raise errors.InvalidArgument("points[%d] must be an object." % (index,))
        if "beat" not in point:
            raise errors.InvalidArgument("points[%d] is missing 'beat'." % (index,))
        beat = point["beat"]
        if isinstance(beat, bool) or not isinstance(beat, (int, float)) or beat < 0:
            raise errors.InvalidArgument("points[%d].beat must be a number >= 0." % (index,))
        if point.get("normalized") is not None:
            normalized = float(point["normalized"])
            if not (0.0 <= normalized <= 1.0):
                raise errors.InvalidArgument(
                    "points[%d].normalized must be within 0.0-1.0." % (index,)
                )
            value = minimum + normalized * span
        elif point.get("value") is not None:
            value = float(point["value"])
            if value < minimum or value > maximum:
                raise errors.InvalidArgument(
                    "points[%d].value %.6f is outside the range of '%s'."
                    % (index, value, param.name),
                    min=minimum,
                    max=maximum,
                )
        else:
            raise errors.InvalidArgument(
                "points[%d] needs 'value' or 'normalized'." % (index,)
            )
        points.append((float(beat), value))
    points.sort(key=lambda p: p[0])

    step = float(args.get("step", 0.25))
    if step <= 0:
        raise errors.InvalidArgument("'step' must be greater than 0 beats.")

    envelope = _envelope(clip, param, create=True)
    if envelope is None:
        raise errors.Unsupported(
            "Parameter '%s' on '%s' cannot be automated inside a clip."
            % (param.name, device.name)
        )

    clear_first = args.get("clear_first", True)
    if clear_first:
        try:
            envelope.clear()
        except Exception:
            pass

    written = 0
    if len(points) == 1:
        beat, value = points[0]
        envelope.insert_step(beat, step, value)
        written = 1
    else:
        for i in range(len(points) - 1):
            start_beat, start_value = points[i]
            end_beat, end_value = points[i + 1]
            segment = end_beat - start_beat
            if segment <= 0:
                continue
            steps = max(1, int(round(segment / step)))
            for s in range(steps):
                t = start_beat + s * (segment / steps)
                ratio = float(s) / steps
                value = start_value + (end_value - start_value) * ratio
                envelope.insert_step(t, segment / steps, value)
                written += 1
        last_beat, last_value = points[-1]
        envelope.insert_step(last_beat, step, last_value)
        written += 1

    return {
        "track_id": ctx.registry.handle_for(track),
        "device_id": ctx.registry.handle_for(device),
        "parameter_id": ctx.registry.handle_for(param),
        "parameter_name": param.name,
        "breakpoints": len(points),
        "steps_written": written,
    }


def clear_automation(ctx, args):
    track, clip, device, param = _resolve(ctx, args)
    envelope = _envelope(clip, param, create=False)
    if envelope is None:
        return {"cleared": False, "reason": "No envelope exists for this parameter."}
    from_beat = args.get("from_beat")
    to_beat = args.get("to_beat")
    if from_beat is not None and to_beat is not None:
        envelope.clear_range(float(from_beat), float(to_beat))
    else:
        envelope.clear()
    return {"cleared": True, "parameter_name": param.name}


COMMANDS = {
    "live.get_automation": get_automation,
    "live.set_automation": set_automation,
    "live.clear_automation": clear_automation,
}
