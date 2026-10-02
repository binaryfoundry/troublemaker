# -*- coding: utf-8 -*-
"""TroubleMaker - the Live-side endpoint of the promptable-Ableton bridge.

Live 11 Intro has no Max for Live, so the Live API endpoint is a MIDI Remote
Script instead of an .amxd device. The responsibilities are unchanged: accept
a command, resolve Live objects, call the Live API, serialize the result,
answer. No musical reasoning happens here.

Threading note: Live's Python API is not thread-safe and must only be touched
from Live's own thread. update_display() is called by Live on that thread
roughly every 100 ms, so it - and nothing else - drives the socket pump.
"""

import os

from _Framework.ControlSurface import ControlSurface

from . import handlers
from . import server as server_module
from .dispatch import Context, Dispatcher
from .log import Log
from .lom import ObjectRegistry

DEFAULT_PORT = 9877
ENV_PORT = "TROUBLEMAKER_PORT"


def _configured_port():
    raw = os.environ.get(ENV_PORT, "").strip()
    if raw:
        try:
            port = int(raw)
            if 1 <= port <= 65535:
                return port
        except ValueError:
            pass
    return DEFAULT_PORT


class TroubleMaker(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self.log = Log(c_instance)
        self._server = None
        self._dispatcher = None
        with self.component_guard():
            self._boot(c_instance)

    def _boot(self, c_instance):
        try:
            registry = ObjectRegistry()
            ctx = Context(self.song(), registry, self.log, self)
            dispatcher = Dispatcher(ctx)
            for module in handlers.MODULES:
                dispatcher.register_module(module)
            self._dispatcher = dispatcher

            port = _configured_port()
            self._server = server_module.JsonLineServer(
                handler=self._handle_request, log=self.log, port=port
            )
            if self._server.start():
                self.log.info(
                    "ready - %d commands on 127.0.0.1:%d"
                    % (len(dispatcher.command_names), port)
                )
                self.show_message("TroubleMaker bridge listening on port %d" % (port,))
            else:
                self.log.info(
                    "could not open port %d. Another copy of the script may "
                    "already be running - remove the duplicate control surface "
                    "in Preferences, or set %s to a free port." % (port, ENV_PORT)
                )
                self.show_message("TroubleMaker: port %d is already in use" % (port,))
        except Exception as exc:
            # A Remote Script that raises during __init__ is silently disabled
            # by Live, which is impossible to diagnose. Log loudly instead.
            import traceback

            self.log.info("STARTUP FAILED: %r\n%s" % (exc, traceback.format_exc()))

    def _handle_request(self, request):
        if self._dispatcher is None:
            return {
                "id": request.get("id") if isinstance(request, dict) else None,
                "ok": False,
                "error": {
                    "code": "NOT_READY",
                    "message": "The TroubleMaker Remote Script failed to start; "
                    "see Live's Log.txt.",
                },
            }
        if self.log.verbose:
            self.log.debug("<- %s" % (request.get("command"),))
        response = self._dispatcher.handle(request)
        if self.log.verbose:
            self.log.debug("-> ok=%s" % (response.get("ok"),))
        return response

    def update_display(self):
        """Live's ~100 ms tick on the main thread. The only safe pump."""
        ControlSurface.update_display(self)
        if self._server is not None:
            self._server.poll()

    def disconnect(self):
        if self._server is not None:
            self._server.stop()
            self._server = None
        self.log.info("disconnected")
        ControlSurface.disconnect(self)
