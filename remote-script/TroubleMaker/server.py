# -*- coding: utf-8 -*-
"""A non-blocking, newline-delimited-JSON TCP server that lives inside Live.

Every Live API call must happen on Live's own thread, so this server never
spawns one. It exposes poll(), which Live's 100 ms update_display() tick
drains: accept new sockets, read whatever has arrived, hand complete lines to
the dispatcher, and flush replies. A poll() that raises would take the whole
Remote Script down, so nothing escapes it.
"""

import errno
import json
import select
import socket

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9877

# A single project-state reply can be large; cap a client's inbound buffer so a
# wedged peer cannot grow it without bound.
MAX_LINE_BYTES = 8 * 1024 * 1024
RECV_CHUNK = 65536
BACKLOG = 4

_WOULDBLOCK = (errno.EAGAIN, errno.EWOULDBLOCK)


class _Client(object):
    def __init__(self, sock, address):
        self.sock = sock
        self.address = address
        self.inbox = b""
        self.outbox = b""
        self.closed = False

    def fileno(self):
        return self.sock.fileno()

    def queue(self, payload_bytes):
        self.outbox += payload_bytes

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self.sock.close()
        except Exception:
            pass


class JsonLineServer(object):
    """Listens on loopback and dispatches one JSON object per line."""

    def __init__(self, handler, log, host=DEFAULT_HOST, port=DEFAULT_PORT):
        self._handler = handler
        self._log = log
        self.host = host
        self.port = port
        self._listener = None
        self._clients = []
        self.last_error = None

    # -- lifecycle ---------------------------------------------------------

    def start(self):
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.setblocking(False)
        try:
            listener.bind((self.host, self.port))
            listener.listen(BACKLOG)
        except Exception as exc:
            listener.close()
            self.last_error = str(exc)
            self._log("FATAL: cannot bind %s:%d - %s" % (self.host, self.port, exc))
            return False
        self._listener = listener
        self._log("listening on %s:%d" % (self.host, self.port))
        return True

    def stop(self):
        for client in list(self._clients):
            client.close()
        self._clients = []
        if self._listener is not None:
            try:
                self._listener.close()
            except Exception:
                pass
            self._listener = None

    @property
    def client_count(self):
        return len(self._clients)

    # -- pump --------------------------------------------------------------

    def poll(self):
        """Drain one round of I/O. Never raises."""
        if self._listener is None:
            return
        try:
            self._accept_pending()
            self._read_ready()
            self._write_ready()
        except Exception as exc:
            self._log("poll error: %r" % (exc,))

    def _accept_pending(self):
        while True:
            try:
                sock, address = self._listener.accept()
            except socket.error as exc:
                if exc.args and exc.args[0] in _WOULDBLOCK:
                    return
                return
            except Exception:
                return
            sock.setblocking(False)
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except Exception:
                pass
            self._clients.append(_Client(sock, address))
            self._log("client connected from %s" % (address,))

    def _read_ready(self):
        if not self._clients:
            return
        try:
            readable, _, errored = select.select(self._clients, [], self._clients, 0)
        except Exception:
            return
        for client in errored:
            self._drop(client, "socket error")
        for client in readable:
            if client.closed:
                continue
            self._read_from(client)

    def _read_from(self, client):
        try:
            chunk = client.sock.recv(RECV_CHUNK)
        except socket.error as exc:
            if exc.args and exc.args[0] in _WOULDBLOCK:
                return
            self._drop(client, "recv failed: %s" % (exc,))
            return
        except Exception as exc:
            self._drop(client, "recv failed: %r" % (exc,))
            return
        if not chunk:
            self._drop(client, "peer closed")
            return
        client.inbox += chunk
        if len(client.inbox) > MAX_LINE_BYTES:
            self._drop(client, "inbound buffer overflow")
            return
        while b"\n" in client.inbox:
            line, client.inbox = client.inbox.split(b"\n", 1)
            line = line.strip()
            if not line:
                continue
            self._handle_line(client, line)

    def _handle_line(self, client, line):
        try:
            text = line.decode("utf-8")
        except Exception:
            self._respond(client, {"id": None, "ok": False,
                                   "error": {"code": "BAD_REQUEST",
                                             "message": "Request was not valid UTF-8."}})
            return
        try:
            request = json.loads(text)
        except Exception as exc:
            self._respond(client, {"id": None, "ok": False,
                                   "error": {"code": "BAD_REQUEST",
                                             "message": "Malformed JSON: %s" % (exc,)}})
            return
        response = self._handler(request)
        if response is not None:
            self._respond(client, response)

    def _respond(self, client, response):
        try:
            payload = json.dumps(response, default=_jsonable).encode("utf-8") + b"\n"
        except Exception as exc:
            payload = json.dumps({
                "id": response.get("id") if isinstance(response, dict) else None,
                "ok": False,
                "error": {"code": "SERIALIZATION_ERROR",
                          "message": "Result could not be encoded: %r" % (exc,)},
            }).encode("utf-8") + b"\n"
        client.queue(payload)

    def _write_ready(self):
        pending = [c for c in self._clients if c.outbox and not c.closed]
        if not pending:
            return
        try:
            _, writable, _ = select.select([], pending, [], 0)
        except Exception:
            return
        for client in writable:
            try:
                sent = client.sock.send(client.outbox)
            except socket.error as exc:
                if exc.args and exc.args[0] in _WOULDBLOCK:
                    continue
                self._drop(client, "send failed: %s" % (exc,))
                continue
            except Exception as exc:
                self._drop(client, "send failed: %r" % (exc,))
                continue
            client.outbox = client.outbox[sent:]

    def _drop(self, client, reason):
        if client in self._clients:
            self._clients.remove(client)
        client.close()
        self._log("client %s dropped: %s" % (client.address, reason))


def _jsonable(value):
    """Last-resort encoder for Live's own vector/tuple types."""
    try:
        return list(value)
    except Exception:
        return str(value)
