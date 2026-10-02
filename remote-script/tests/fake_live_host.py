# -*- coding: utf-8 -*-
"""Run the real Remote Script against the fake Live Object Model.

This hosts the actual TroubleMaker ControlSurface - the real server.py, the
real dispatcher - and pumps update_display() the way Live does, so the bridge
can connect to it over a real socket. It is how the whole stack gets
exercised end to end without Ableton.

    python remote-script/tests/fake_live_host.py [--port 9877]
"""

import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import fake_live  # noqa: E402

fake_live.install_stubs()

from TroubleMaker.TroubleMaker import TroubleMaker  # noqa: E402

# Live calls update_display() about ten times a second.
TICK_SECONDS = 0.01


class FakeCInstance(object):
    def __init__(self, song, quiet=False):
        self._song = song
        self.quiet = quiet

    def song(self):
        return fake_live.Wrapper(self._song)

    def log_message(self, message):
        if not self.quiet:
            sys.stderr.write("%s\n" % (message,))
            sys.stderr.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9877)
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--seconds", type=float, default=0.0,
                        help="Exit after this long. 0 runs until interrupted.")
    options = parser.parse_args()

    os.environ["TROUBLEMAKER_PORT"] = str(options.port)

    song = fake_live.Song()
    surface = TroubleMaker(FakeCInstance(song, options.quiet))

    deadline = time.time() + options.seconds if options.seconds else None
    try:
        while deadline is None or time.time() < deadline:
            surface.update_display()
            time.sleep(TICK_SECONDS)
    except KeyboardInterrupt:
        pass
    finally:
        surface.disconnect()


if __name__ == "__main__":
    main()
