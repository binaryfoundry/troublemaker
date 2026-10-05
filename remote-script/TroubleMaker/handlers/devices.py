# -*- coding: utf-8 -*-
"""Device and device-parameter access.

Parameter ranges differ wildly between devices (a filter frequency is in Hz,
a dry/wet is 0-100), so every write accepts either a native 'value' or a
0.0-1.0 'normalized' value, and both are bounds-checked against the
parameter's own min/max before touching Live.
"""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_float, opt_int, opt_str, opt_bool


def get_devices(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    with_parameters = opt_bool(args, "include_parameters", False)
    return {
        "track_id": ctx.registry.handle_for(track),
        "devices": [
            lom.serialize_device(ctx, d, with_parameters=with_parameters)
            for d in track.devices
        ],
    }


def get_device(ctx, args):
    track, device = lom.resolve_device(
        ctx, req_int(args, "track_id"), req_int(args, "device_id")
    )
    out = lom.serialize_device(ctx, device, with_parameters=True)
    out["track_id"] = ctx.registry.handle_for(track)
    return out


def get_device_parameters(ctx, args):
    track, device = lom.resolve_device(
        ctx, req_int(args, "track_id"), req_int(args, "device_id")
    )
    return {
        "track_id": ctx.registry.handle_for(track),
        "device_id": ctx.registry.handle_for(device),
        "name": device.name,
        "parameters": [lom.serialize_parameter(ctx, p) for p in device.parameters],
    }


def set_device_parameter(ctx, args):
    track, device, param = lom.resolve_parameter(
        ctx,
        req_int(args, "track_id"),
        req_int(args, "device_id"),
        parameter_id=opt_int(args, "parameter_id"),
        parameter_name=opt_str(args, "parameter_name"),
    )
    if not param.is_enabled:
        raise errors.LiveError(
            "Parameter '%s' on '%s' is not writable right now (it is automated "
            "or controlled by a macro)." % (param.name, device.name)
        )
    minimum = float(param.min)
    maximum = float(param.max)
    before = lom.serialize_parameter(ctx, param)

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
                "Value %.6f is outside the range of parameter '%s'."
                % (value, param.name),
                min=minimum,
                max=maximum,
                display_range=[
                    _display(param, minimum),
                    _display(param, maximum),
                ],
            )
    else:
        raise errors.InvalidArgument(
            "Provide either 'value' (native units) or 'normalized' (0.0-1.0)."
        )

    if param.is_quantized:
        value = float(round(value))

    try:
        param.value = value
    except Exception as exc:
        raise errors.LiveError(
            "Live refused to set '%s' on '%s': %s" % (param.name, device.name, exc)
        )

    return {
        "track_id": ctx.registry.handle_for(track),
        "device_id": ctx.registry.handle_for(device),
        "device_name": device.name,
        "before": before,
        "after": lom.serialize_parameter(ctx, param),
    }


def set_device_active(ctx, args):
    track, device = lom.resolve_device(
        ctx, req_int(args, "track_id"), req_int(args, "device_id")
    )
    enabled = opt_bool(args, "enabled", None)
    if enabled is None:
        raise errors.InvalidArgument("Missing required argument 'enabled'.")
    try:
        device.parameters[0].value = 1.0 if enabled else 0.0
    except Exception as exc:
        raise errors.LiveError("Cannot toggle device '%s': %s" % (device.name, exc))
    return {
        "device_id": ctx.registry.handle_for(device),
        "is_active": bool(device.is_active),
    }


def delete_device(ctx, args):
    """Remove one device from a track's chain.

    Needed to replace a plugin: Live keeps a restored plugin's saved parameter
    list, so a newer build's parameters only appear on a fresh instance, and
    loading the same plugin from the browser onto a track that already has it
    does nothing. Delete, then load.
    """
    track, device = lom.resolve_device(
        ctx, req_int(args, "track_id"), req_int(args, "device_id")
    )
    if not hasattr(track, "delete_device"):
        raise errors.Unsupported("This Live version cannot delete devices through its API.")
    devices = list(track.devices)
    index = lom.index_of(devices, device)
    if index < 0:
        raise errors.LiveError("Device '%s' is not in the track's own chain." % (device.name,))
    name = device.name
    try:
        track.delete_device(index)
    except Exception as exc:
        raise errors.LiveError("Live refused to delete '%s': %s" % (name, exc))
    after = list(track.devices)
    if len(after) != len(devices) - 1:
        raise errors.LiveError("Live reported success but '%s' is still there." % (name,))
    return {
        "track_id": ctx.registry.handle_for(track),
        "deleted": name,
        "index": index,
        "devices": [lom.serialize_device(ctx, d) for d in after],
    }


def _display(param, value):
    try:
        return str(param.str_for_value(value))
    except Exception:
        return None


COMMANDS = {
    "live.get_devices": get_devices,
    "live.get_device": get_device,
    "live.get_device_parameters": get_device_parameters,
    "live.set_device_parameter": set_device_parameter,
    "live.set_device_active": set_device_active,
    "live.delete_device": delete_device,
}
