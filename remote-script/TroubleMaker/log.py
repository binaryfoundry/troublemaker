# -*- coding: utf-8 -*-
"""Logging for the Remote Script.

Everything lands in Live's own Log.txt, prefixed so it is greppable. Verbose
per-command logging is off by default - a busy edit session would otherwise
flood the log with full project state.
"""

import os

PREFIX = "[TroubleMaker]"
ENV_VERBOSE = "TROUBLEMAKER_VERBOSE"


class Log(object):
    def __init__(self, c_instance=None):
        self._c_instance = c_instance
        self.verbose = os.environ.get(ENV_VERBOSE, "").strip().lower() in (
            "1",
            "true",
            "yes",
        )

    def __call__(self, message):
        self.info(message)

    def info(self, message):
        text = "%s %s" % (PREFIX, message)
        try:
            if self._c_instance is not None:
                self._c_instance.log_message(text)
                return
        except Exception:
            pass
        try:
            print(text)
        except Exception:
            pass

    def debug(self, message):
        if self.verbose:
            self.info("DEBUG " + str(message))
