# -*- coding: utf-8 -*-
"""Mechanical support for mastering: display-unit parameter writes, device
insertion where Live supports it, and meter reads.

Still no musical opinion here. Safe ranges, roles and decision rules live in
the bridge and agent; this module only makes "set Ceiling to -1.0 dB" mean
the same thing on every Live version, whatever a device's internal scaling.
"""

import re

from .. import errors
from .. import lom
from ..dispatch import req_int, req_float, req_str, opt_int, opt_str

_NUMBER = re.compile(r"(-?inf|[-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*([kKmM]?)\s*([A-Za-z%]*)")
_SCALE = {"k": 1000.0, "K": 1000.0, "m": 1.0, "M": 1000000.0, "": 1.0}
SEARCH_STEPS = 48


def parse_display(text):
    """'-1.0 dB' -> (-1.0, 'dB'); '1.20 kHz' -> (1200.0, 'Hz'); '0.25 s' -> (250.0, 'ms').

    Returns None for non-numeric displays such as 'Off'.

    A lone 'm' prefix is ambiguous ('ms' vs mega), so it is treated as part of
    the unit for times and ignored otherwise.
    """
    if text is None:
        return None
    match = _NUMBER.search(str(text))
    if not match:
        return None
    raw, prefix, unit = match.groups()
    if raw.lower().endswith("inf"):
        number = -1e9 if raw.startswith("-") else 1e9
    else:
        number = float(raw)
    if prefix in ("m",) and unit.lower() == "s":
        unit = "ms"
        prefix = ""
    elif prefix == "m" and not unit:
        prefix = ""
    number *= _SCALE.get(prefix, 1.0)
    # Canonical units, so a display that switches from "850 ms" to "1.20 s"
    # partway along its range still compares consistently.
    if unit == "s":
        number, unit = number * 1000.0, "ms"
    return number, unit


def _display_number(param, value):
    try:
        text = str(param.str_for_value(value))
    except Exception:
        return None
    parsed = parse_display(text)
    if parsed is None:
        return None
    # "-0.0" is a value just below zero rounded for display. Keeping it
    # negative lets the search walk on to the native value that shows "0.0".
    if parsed[0] == 0 and text.strip().startswith("-"):
        return -1e-9
    return parsed[0]


RANGE_SAMPLES = 64
OPTION_SAMPLES = 1024


def numeric_span(param):
    """The native sub-range whose display is numeric, and its display ends.

    Most parameters are numeric end to end. Some name a state at one end -
    Glue's release shows 'A' (auto) at its maximum - so sample the range and
    keep the numeric part. Returns (native_lo, native_hi, display_lo,
    display_hi), or None when no part of the range is numeric.
    """
    low, high = float(param.min), float(param.max)
    lo_display = _display_number(param, low)
    hi_display = _display_number(param, high)
    if lo_display is not None and hi_display is not None:
        return low, high, lo_display, hi_display
    numeric = []
    for i in range(RANGE_SAMPLES + 1):
        value = low + (high - low) * i / float(RANGE_SAMPLES)
        shown = _display_number(param, value)
        if shown is not None:
            numeric.append((value, shown))
    if not numeric:
        return None
    native_lo, display_lo = numeric[0]
    native_hi, display_hi = numeric[-1]
    # Tighten each end towards the non-numeric neighbour.
    step = (high - low) / float(RANGE_SAMPLES)
    if hi_display is None:
        a, b = native_hi, min(high, native_hi + step)
        for _ in range(24):
            middle = (a + b) / 2.0
            if _display_number(param, middle) is None:
                b = middle
            else:
                a = middle
        native_hi, display_hi = a, _display_number(param, a)
    if lo_display is None:
        a, b = max(low, native_lo - step), native_lo
        for _ in range(24):
            middle = (a + b) / 2.0
            if _display_number(param, middle) is None:
                a = middle
            else:
                b = middle
        native_lo, display_lo = b, _display_number(param, b)
    return native_lo, native_hi, display_lo, display_hi


def display_range(param):
    span = numeric_span(param)
    if span is None:
        return None, None
    return span[2], span[3]


def set_device_parameter_display(ctx, args):
    """Set a parameter so its *displayed* value equals `target`.

    Binary-searches the native range for the value whose display parses to
    the target, assuming the display is monotonic in the native value (true
    of every Live gain, time and frequency control). Quantized parameters are
    searched exhaustively.
    """
    track, device, param = lom.resolve_parameter(
        ctx,
        req_int(args, "track_id"),
        req_int(args, "device_id"),
        parameter_id=opt_int(args, "parameter_id"),
        parameter_name=opt_str(args, "parameter_name"),
    )
    target = req_float(args, "target")
    if not param.is_enabled:
        raise errors.LiveError(
            "Parameter '%s' on '%s' is not writable right now (automated or macro-mapped)."
            % (param.name, device.name)
        )

    span = numeric_span(param)
    if span is None:
        raise errors.Unsupported(
            "Parameter '%s' has a non-numeric display ('%s'); set it with a native value instead."
            % (param.name, lom.safe(lambda: param.str_for_value(param.value), "?"))
        )
    low_native, high_native, low_display, high_display = span
    lo_d, hi_d = min(low_display, high_display), max(low_display, high_display)
    if target < lo_d - 1e-9 or target > hi_d + 1e-9:
        raise errors.InvalidArgument(
            "Target %g is outside the displayed range of '%s'." % (target, param.name),
            display_min=lo_d,
            display_max=hi_d,
            unit=parse_display(param.str_for_value(param.value))[1]
            if parse_display(param.str_for_value(param.value))
            else None,
        )

    before = lom.serialize_parameter(ctx, param)

    if param.is_quantized:
        best_value, best_error = None, None
        value = low_native
        while value <= high_native + 1e-9:
            shown = _display_number(param, value)
            if shown is not None:
                error = abs(shown - target)
                if best_error is None or error < best_error:
                    best_value, best_error = value, error
            value += 1.0
        native = best_value if best_value is not None else float(param.value)
    else:
        ascending = high_display >= low_display
        lo, hi = low_native, high_native
        for _ in range(SEARCH_STEPS):
            middle = (lo + hi) / 2.0
            shown = _display_number(param, middle)
            if shown is None:
                break
            if (shown < target) == ascending:
                lo = middle
            else:
                hi = middle
        # Pick whichever end of the final bracket displays closer to target.
        # On a tie prefer the side that does not display "-0.0" for a
        # non-negative target, which reads as a sign error to a human.
        def closeness(v):
            shown = lom.safe(lambda: str(param.str_for_value(v)), "")
            negative_zero = target >= 0 and shown.strip().startswith("-")
            return (round(abs((_display_number(param, v) or 0.0) - target), 9), negative_zero)

        native = min([lo, hi], key=closeness)

    if args.get("apply") is False:
        # Conversion only: which native value displays as the target.
        return {
            "track_id": ctx.registry.handle_for(track),
            "device_id": ctx.registry.handle_for(device),
            "parameter_name": param.name,
            "target": target,
            "native": native,
            "display": lom.safe(lambda: str(param.str_for_value(native)), None),
            "min": float(param.min),
            "max": float(param.max),
        }

    try:
        param.value = native
    except Exception as exc:
        raise errors.LiveError(
            "Live refused to set '%s' on '%s': %s" % (param.name, device.name, exc)
        )

    after = lom.serialize_parameter(ctx, param)
    achieved = _display_number(param, float(param.value))
    return {
        "track_id": ctx.registry.handle_for(track),
        "device_id": ctx.registry.handle_for(device),
        "device_name": device.name,
        "parameter_name": param.name,
        "target": target,
        "achieved": achieved,
        "before": before,
        "after": after,
    }


def _option_values(param):
    """(native value, display) pairs for a parameter's selectable states.

    Quantized parameters enumerate every step. A continuous parameter can
    still carry a named state at an end of its range - Glue's release shows
    'A' (auto) at its maximum - so both ends are offered too.
    """
    low, high = float(param.min), float(param.max)
    pairs = []
    if param.is_quantized:
        value = low
        while value <= high + 1e-9:
            pairs.append((value, lom.safe(lambda: str(param.str_for_value(value)), "")))
            value += 1.0
    else:
        # Tempo-synced rates ("1/16", "1 Bar") are continuous parameters with
        # stepped displays. Sample the range and keep the first value showing
        # each distinct label, so those steps are selectable by name.
        seen = set()
        for i in range(OPTION_SAMPLES + 1):
            value = low + (high - low) * i / float(OPTION_SAMPLES)
            shown = lom.safe(lambda: str(param.str_for_value(value)), "")
            if shown not in seen:
                seen.add(shown)
                pairs.append((value, shown))
    return pairs


def set_device_parameter_option(ctx, args):
    """Set a parameter to a named state ('True Peak', 'Analog Clip', 'On')."""
    track, device, param = lom.resolve_parameter(
        ctx,
        req_int(args, "track_id"),
        req_int(args, "device_id"),
        parameter_id=opt_int(args, "parameter_id"),
        parameter_name=opt_str(args, "parameter_name"),
    )
    wanted = req_str(args, "option").strip().lower()
    aliases = args.get("aliases") or []
    candidates = [wanted] + [str(a).strip().lower() for a in aliases]
    pairs = _option_values(param)
    match = None
    for value, shown in pairs:
        if shown.strip().lower() in candidates:
            match = value
            break
    if match is None:
        raise errors.InvalidArgument(
            "Parameter '%s' on '%s' has no option %r." % (param.name, device.name, args["option"]),
            available_options=[shown for _, shown in pairs],
        )
    before = lom.serialize_parameter(ctx, param)
    try:
        param.value = match
    except Exception as exc:
        raise errors.LiveError(
            "Live refused to set '%s' on '%s': %s" % (param.name, device.name, exc)
        )
    return {
        "track_id": ctx.registry.handle_for(track),
        "device_id": ctx.registry.handle_for(device),
        "device_name": device.name,
        "parameter_name": param.name,
        "before": before,
        "after": lom.serialize_parameter(ctx, param),
    }


def insert_device(ctx, args):
    """Insert a native Live device. Needs Live 12.3+; refused honestly before."""
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    name = req_str(args, "device_name")
    index = opt_int(args, "index")
    if not hasattr(track, "insert_device"):
        raise errors.Unsupported(
            "This Live version cannot insert devices through its API (Live 12.3 added it, "
            "for native devices only). Load '%s' from Live's browser instead, or use the "
            "mastering template Set." % (name,)
        )
    before = len(list(track.devices))
    try:
        if index is None:
            track.insert_device(name)
        else:
            track.insert_device(name, index)
    except Exception as exc:
        raise errors.LiveError("Live refused to insert '%s': %s" % (name, exc))
    devices = list(track.devices)
    if len(devices) <= before:
        raise errors.LiveError("Live reported success but no device was added for '%s'." % (name,))
    return {
        "track_id": ctx.registry.handle_for(track),
        "devices": [lom.serialize_device(ctx, d) for d in devices],
    }


def get_meters(ctx, args):
    """Live's own output meters for a track: display meters, NOT loudness.

    Useful as a quick "is anything near clipping" probe. Real loudness and
    true peak come from offline analysis of the exported file.
    """
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    return {
        "track_id": ctx.registry.handle_for(track),
        "left": lom.safe(lambda: float(track.output_meter_left), None),
        "right": lom.safe(lambda: float(track.output_meter_right), None),
        "level": lom.safe(lambda: float(track.output_meter_level), None),
        "playing": bool(ctx.song.is_playing),
    }


COMMANDS = {
    "live.set_device_parameter_display": set_device_parameter_display,
    "live.set_device_parameter_option": set_device_parameter_option,
    "live.insert_device": insert_device,
    "live.get_meters": get_meters,
}
