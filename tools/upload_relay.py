"""Optional, bounded loopback transport for compressing large API uploads.

No credentials, bodies, or per-request details are logged or persisted. This is
an HTTP/1.1 CLI transport, not a browser service, general proxy, or API server.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import errno
import gzip
import http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
import ipaddress
import json
import re
import select
import socket
from socketserver import ThreadingMixIn
import ssl
import threading
import time
from urllib.parse import urlsplit


API_METHODS = {
    '/v1/models': 'GET',
    '/v1/responses': 'POST',
    '/v1/responses/compact': 'POST',
    '/v1/chat/completions': 'POST',
    '/v1/completions': 'POST',
    '/v1/embeddings': 'POST',
    '/v1/messages': 'POST',
    '/v1/images/generations': 'POST',
}
HOP_HEADERS = frozenset({
    'connection', 'proxy-connection', 'keep-alive', 'te', 'trailer',
    'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization',
})
SINGLE_HEADERS = frozenset({
    'host', 'authorization', 'content-length', 'content-encoding', 'content-type',
    'transfer-encoding', 'connection', 'expect', 'origin', 'upgrade',
    'proxy-authorization', 'x-api-key', 'x-goog-api-key',
})
TOKEN = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
DECIMAL = re.compile(r'^[0-9]{1,12}$')
READ_SIZE = 16 * 1024
MAX_HEADER_BYTES = 32 * 1024


class RelayError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


@dataclass(frozen=True)
class RelayConfig:
    upstream: str
    compress_min_bytes: int = 32 * 1024
    max_body_bytes: int = 16 * 1024 * 1024
    max_connections: int = 4
    upload_timeout: float = 60.0
    upstream_timeout: float = 300.0
    write_timeout: float = 30.0
    max_stream_seconds: float = 3600.0
    # Internal synthetic-test escape hatch. The CLI never enables HTTP.
    allow_loopback_http: bool = False

    def __post_init__(self):
        try:
            target = urlsplit(self.upstream)
            host, port = target.hostname, target.port
        except ValueError:
            raise ValueError('Invalid upstream origin') from None
        if (not host or target.username is not None or target.password is not None
                or target.query or target.fragment or target.path not in ('', '/')
                or any(c.isspace() or ord(c) < 33 for c in self.upstream)
                or '\\' in self.upstream or '%' in target.netloc):
            raise ValueError('Upstream must be an origin without userinfo, path, query, or fragment')
        if target.scheme != 'https':
            try:
                loopback = ipaddress.ip_address(host).is_loopback
            except ValueError:
                loopback = False
            if not (self.allow_loopback_http and target.scheme == 'http' and loopback):
                raise ValueError('Upstream requires HTTPS')
        if port is not None and not 1 <= port <= 65535:
            raise ValueError('Invalid upstream port')
        if not 1 <= self.max_body_bytes <= 64 * 1024 * 1024:
            raise ValueError('Body limit must be between 1 byte and 64 MiB')
        if not 0 <= self.compress_min_bytes <= self.max_body_bytes:
            raise ValueError('Compression threshold exceeds body limit')
        if not 1 <= self.max_connections <= 32:
            raise ValueError('Connection limit must be between 1 and 32')
        if any(not 0 < value <= 24 * 3600 for value in (
                self.upload_timeout, self.upstream_timeout,
                self.write_timeout, self.max_stream_seconds)):
            raise ValueError('Timeouts must be positive and at most 24 hours')


class _HeaderBudget:
    def __init__(self, reader):
        self.reader, self.remaining, self.active = reader, MAX_HEADER_BYTES, True

    def readline(self, size=-1):
        if not self.active:
            return self.reader.readline(size)
        limit = self.remaining + 1 if size < 0 else min(size, self.remaining + 1)
        line = self.reader.readline(limit)
        self.remaining -= len(line)
        if self.remaining < 0:
            raise http.client.LineTooLong('request headers')
        if line in (b'\r\n', b'\n'):
            self.active = False
        return line

    def __getattr__(self, name):
        return getattr(self.reader, name)


class _ConnectionState:
    def __init__(self, downstream):
        self.downstream = downstream
        self.upstream_socket = None
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.upload_expired = threading.Event()

    @staticmethod
    def _shutdown(sock, how=socket.SHUT_RDWR):
        if sock is not None:
            try:
                sock.shutdown(how)
            except OSError:
                pass

    def expire_upload(self):
        self.upload_expired.set()
        # Stop a slow read while leaving the response side available for 408.
        self._shutdown(self.downstream, socket.SHUT_RD)

    def attach_upstream(self, sock):
        with self.lock:
            self.upstream_socket = sock
            if self.stopped.is_set():
                self._shutdown(sock)

    def cancel(self):
        self.stopped.set()
        with self.lock:
            self._shutdown(self.upstream_socket)
        self._shutdown(self.downstream)

    def watch_client(self):
        while not self.stopped.wait(0.1):
            try:
                readable, _, _ = select.select([self.downstream], [], [], 0)
                # No more client bytes are legal after this one complete
                # request; EOF (including a TCP write-half-close) is cancellation.
                if readable:
                    self.cancel()
                    return
            except (OSError, ValueError):
                self.cancel()
                return


class RelayServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    block_on_close = False
    request_queue_size = 16

    def __init__(self, port: int, config: RelayConfig):
        self.config = config
        self.target = urlsplit(config.upstream)
        # Keep ordinary certificate/hostname verification, without implicitly
        # enabling traffic-secret logs through an ambient SSLKEYLOGFILE variable.
        self.tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self.tls_context.load_default_certs(ssl.Purpose.SERVER_AUTH)
        self.slots = threading.BoundedSemaphore(config.max_connections)
        self.states, self.states_lock = {}, threading.Lock()
        super().__init__(('127.0.0.1', port), RelayHandler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\n'
                                b'Content-Length: 0\r\nConnection: close\r\n\r\n')
                request.shutdown(socket.SHUT_WR)
                remaining, until = 64 * 1024, time.monotonic() + 0.1
                while remaining and time.monotonic() < until:
                    request.settimeout(max(0.001, until - time.monotonic()))
                    part = request.recv(min(READ_SIZE, remaining))
                    if not part:
                        break
                    remaining -= len(part)
            except OSError:
                pass
            self.shutdown_request(request)
            return
        with self.states_lock:
            self.states[request] = _ConnectionState(request)
        try:
            super().process_request(request, client_address)
        except Exception:
            with self.states_lock:
                self.states.pop(request).cancel()
            self.slots.release()
            self.shutdown_request(request)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self.states_lock:
                state = self.states.pop(request, None)
            if state is not None:
                state.cancel()
            self.slots.release()

    def handle_error(self, request, client_address):
        # Exception representations can contain request headers or URL values.
        pass

    def server_close(self):
        with self.states_lock:
            states = list(self.states.values())
        for state in states:
            state.cancel()
        super().server_close()


def _check_fields(headers, status=400):
    if headers.defects:
        raise RelayError(status,'invalid_headers')
    for name, value in headers.raw_items():
        if (not TOKEN.fullmatch(name) or any(
                ord(c) < 32 and c != '\t' or ord(c) == 127 for c in value)):
            raise RelayError(status, 'invalid_headers')
    for name in SINGLE_HEADERS:
        if len(headers.get_all(name, [])) > 1:
            raise RelayError(status, 'duplicate_headers')


def _connection_fields(headers, status=400):
    result = set(HOP_HEADERS)
    for value in headers.get_all('Connection', []):
        for token in value.split(','):
            token = token.strip().lower()
            if not token or not TOKEN.fullmatch(token):
                raise RelayError(status, 'invalid_connection_header')
            result.add(token)
    return result


class RelayHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        with self.server.states_lock:
            self.state = self.server.states[self.connection]
        self.rfile = _HeaderBudget(self.rfile)
        self.connection.settimeout(self.server.config.upload_timeout)
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.upload_timer = threading.Timer(self.server.config.upload_timeout,
                                            self.state.expire_upload)
        self.upload_timer.daemon = True
        self.upload_timer.start()
        self.response_started = False

    def finish(self):
        self.upload_timer.cancel()
        try:
            super().finish()
        finally:
            self.state.cancel()

    def log_message(self, format, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        # Never reflect parser errors, request targets, or header values.
        self._reject(code, 'invalid_http_request')

    def _reject(self, status, code):
        self.close_connection = True
        self.response_started = True
        payload = json.dumps({'error': {'type': 'relay_error', 'code': code,
                                      'message': 'Local upload relay rejected the request.'}},
                             separators=(',', ':')).encode()
        try:
            self.send_response_only(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Connection', 'close')
            self.end_headers()
            if getattr(self, 'command', '') != 'HEAD':
                self.wfile.write(payload)
                self.wfile.flush()
            # Send FIN after the error, then briefly drain a bounded, unambiguous
            # body. Closing over unread bytes can otherwise reset the connection
            # and hide a legitimate 4xx response (notably on Windows).
            self.state._shutdown(self.connection, socket.SHUT_WR)
            headers = getattr(self, 'headers', None)
            lengths = headers.get_all('Content-Length', []) if headers else []
            if len(lengths) == 1 and DECIMAL.fullmatch(lengths[0].strip()):
                remaining = min(int(lengths[0]), 64 * 1024)
                until = time.monotonic() + 0.1
                while remaining and time.monotonic() < until:
                    self.connection.settimeout(max(0.001, until - time.monotonic()))
                    part = self.rfile.read1(min(READ_SIZE, remaining))
                    if not part:
                        break
                    remaining -= len(part)
        except OSError:
            pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except http.client.LineTooLong:
            self.request_version = 'HTTP/1.1'
            self._reject(431, 'headers_too_large')
        except (TimeoutError, OSError):
            self.close_connection = True
        finally:
            # One request per connection: no pipelining or surplus-body replay.
            self.close_connection = True

    def _local_boundary(self):
        if self.state.upload_expired.is_set():
            raise RelayError(408, 'upload_timeout')
        _check_fields(self.headers)
        expected_host = f'127.0.0.1:{self.server.server_port}'
        if (self.headers.get('Host') != expected_host
                or not ipaddress.ip_address(self.client_address[0]).is_loopback):
            raise RelayError(403, 'loopback_host_required')
        if any(name.lower() in ('origin', 'referer') or name.lower().startswith('sec-fetch-')
               for name in self.headers):
            raise RelayError(403, 'browser_requests_forbidden')

    def _preflight(self):
        self._local_boundary()
        if self.request_version != 'HTTP/1.1':
            raise RelayError(505, 'http_1_1_required')
        try:
            target = urlsplit(self.path)
        except ValueError:
            raise RelayError(400, 'invalid_target') from None
        if (not self.path.startswith('/') or self.path.startswith('//')
                or target.scheme or target.netloc or target.fragment
                or '\\' in self.path or len(self.path) > 4096
                or any(ord(c) < 33 or ord(c) > 126 for c in self.path)):
            raise RelayError(400, 'invalid_target')
        if target.path not in API_METHODS:
            raise RelayError(404, 'endpoint_not_allowed')
        if API_METHODS[target.path] != self.command:
            raise RelayError(405, 'method_not_allowed')
        auth = self.headers.get('Authorization', '')
        if len(auth) > 8192 or len(auth.split(None, 1)) != 2:
            raise RelayError(401, 'authorization_required')
        if self.headers.get('Upgrade'):
            raise RelayError(426, 'http_upgrade_not_supported')
        if self.headers.get_all('Transfer-Encoding') or self.headers.get_all('Trailer'):
            raise RelayError(400, 'transfer_encoding_not_supported')
        if self.headers.get('Expect', '').lower().strip() not in ('', '100-continue'):
            raise RelayError(417, 'expectation_not_supported')
        blocked = _connection_fields(self.headers)
        if blocked.intersection({'authorization', 'host', 'content-length',
                                 'content-encoding', 'content-type'}):
            raise RelayError(400, 'invalid_connection_header')
        length = self.headers.get('Content-Length')
        if length is None:
            if self.command == 'POST':
                raise RelayError(411, 'content_length_required')
            length = '0'
        length = length.strip()
        if not DECIMAL.fullmatch(length):
            raise RelayError(400, 'invalid_content_length')
        length = int(length)
        if length > self.server.config.max_body_bytes:
            raise RelayError(413, 'body_too_large')
        if self.command == 'GET' and length:
            raise RelayError(400, 'get_body_not_supported')
        return length, blocked

    def handle_expect_100(self):
        try:
            self._preflight()
        except RelayError as error:
            self._reject(error.status, error.code)
            return False
        self.send_response_only(100)
        self.end_headers()
        return True

    def _deny(self):
        try:
            self._local_boundary()
            raise RelayError(405, 'method_not_allowed')
        except RelayError as error:
            self._reject(error.status, error.code)

    do_CONNECT = do_DELETE = do_HEAD = do_OPTIONS = do_PATCH = do_PUT = do_TRACE = _deny

    def _read_body(self, length):
        body = bytearray()
        while len(body) < length:
            try:
                part = self.rfile.read(min(READ_SIZE, length - len(body)))
            except (TimeoutError, OSError):
                raise RelayError(408, 'upload_timeout') from None
            if self.state.upload_expired.is_set():
                raise RelayError(408, 'upload_timeout')
            if not part:
                raise RelayError(400, 'incomplete_upload')
            body.extend(part)
        if self.state.upload_expired.is_set():
            raise RelayError(408, 'upload_timeout')
        return bytes(body)

    def _open_upstream(self):
        target, config = self.server.target, self.server.config
        port = target.port or (443 if target.scheme == 'https' else 80)
        if target.scheme == 'https':
            connection = http.client.HTTPSConnection(
                target.hostname, port, timeout=config.upstream_timeout,
                context=self.server.tls_context)
        else:
            connection = http.client.HTTPConnection(
                target.hostname, port, timeout=config.upstream_timeout)
        connection.set_debuglevel(0)
        try:
            connection.sock = self._connect_socket(target.hostname, port)
            if target.scheme == 'https':
                # Attach the SSL socket before its blocking handshake, so a
                # disconnected client can cancel that handshake too.
                connection.sock = self.server.tls_context.wrap_socket(
                    connection.sock, server_hostname=target.hostname,
                    do_handshake_on_connect=False)
                self.state.attach_upstream(connection.sock)
                connection.sock.do_handshake()
            elif not ipaddress.ip_address(connection.sock.getpeername()[0]).is_loopback:
                raise RelayError(502, 'invalid_test_upstream')
            return connection
        except Exception:
            connection.close()
            raise

    def _connect_socket(self, host, port):
        until = time.monotonic() + self.server.config.upstream_timeout
        pending = {errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY,
                   errno.EINTR, getattr(errno, 'WSAEWOULDBLOCK', errno.EWOULDBLOCK)}
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        last_error = OSError('upstream connection failed')
        for family, kind, protocol, _, address in addresses:
            if self.state.stopped.is_set():
                raise ConnectionAbortedError('client disconnected')
            if time.monotonic() >= until:
                raise TimeoutError('upstream connection timeout')
            candidate = socket.socket(family, kind, protocol)
            try:
                candidate.setblocking(False)
                self.state.attach_upstream(candidate)
                result = candidate.connect_ex(address)
                if result not in pending and result not in (0, errno.EISCONN):
                    raise OSError(result, 'upstream connection failed')
                while result not in (0, errno.EISCONN):
                    if self.state.stopped.is_set():
                        raise ConnectionAbortedError('client disconnected')
                    remaining = until - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError('upstream connection timeout')
                    _, writable, failed = select.select([], [candidate], [candidate],
                                                         min(0.1, remaining))
                    if writable or failed:
                        result = candidate.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                        if result:
                            raise OSError(result, 'upstream connection failed')
                if self.state.stopped.is_set():
                    raise ConnectionAbortedError('client disconnected')
                candidate.settimeout(self.server.config.upstream_timeout)
                candidate.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                return candidate
            except OSError as error:
                last_error = error
                candidate.close()
        raise last_error

    def _forward(self):
        upstream, response, watcher, stream_timer = None, None, None, None
        try:
            length, blocked = self._preflight()
            body = self._read_body(length)
            self.upload_timer.cancel()
            config = self.server.config
            content_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            encoding = self.headers.get('Content-Encoding', '').strip().lower()
            compressed = False
            if (content_type == 'application/json' and encoding in ('', 'identity')
                    and len(body) >= config.compress_min_bytes):
                candidate = gzip.compress(body, compresslevel=3, mtime=0)
                if len(candidate) < len(body):
                    body, compressed = candidate, True
            if self.state.upload_expired.is_set():
                raise RelayError(408, 'upload_timeout')
            self.connection.settimeout(config.write_timeout)
            watcher = threading.Thread(target=self.state.watch_client, daemon=True)
            watcher.start()
            stream_timer = threading.Timer(config.max_stream_seconds, self.state.cancel)
            stream_timer.daemon = True
            stream_timer.start()
            upstream = self._open_upstream()
            upstream.putrequest(self.command, self.path, skip_accept_encoding=True)
            for name, value in self.headers.raw_items():
                lower = name.lower()
                if lower not in blocked | {'host', 'content-length'} and not (
                        compressed and lower == 'content-encoding'):
                    upstream.putheader(name, value)
            upstream.putheader('Content-Length', str(len(body)))
            upstream.putheader('Connection', 'close')
            if compressed:
                upstream.putheader('Content-Encoding', 'gzip')
            upstream.endheaders(body)
            response = upstream.getresponse()
            _check_fields(response.headers, 502)
            response_blocked = _connection_fields(response.headers, 502)
            response_length = response.getheader('Content-Length')
            transfer_encoding = response.getheader('Transfer-Encoding')
            if (response.status < 200 or response.status > 599
                    or response_length is not None and (
                        not DECIMAL.fullmatch(response_length.strip()) or transfer_encoding)
                    or transfer_encoding and transfer_encoding.lower().strip() != 'chunked'):
                raise RelayError(502, 'invalid_upstream_framing')
            expected_length = int(response_length) if response_length is not None else None
            no_body = response.status in (204, 304)
            chunked = not no_body and (
                expected_length is None or 'content-length' in response_blocked)
            self.send_response_only(response.status)
            for name, value in response.headers.raw_items():
                lower = name.lower()
                if (lower not in response_blocked
                        and not lower.startswith('access-control-')
                        and not (no_body and lower == 'content-length')):
                    self.send_header(name, value)
            self.send_header('Connection', 'close')
            if chunked:
                self.send_header('Transfer-Encoding', 'chunked')
            self.response_started = True
            self.end_headers()
            self.wfile.flush()
            received = 0
            if not no_body:
                while not self.state.stopped.is_set():
                    # read(n) can wait to fill n and delay an SSE event until EOF.
                    part = response.read1(READ_SIZE)
                    if not part:
                        break
                    received += len(part)
                    if chunked:
                        self.wfile.write(f'{len(part):x}\r\n'.encode())
                    self.wfile.write(part)
                    if chunked:
                        self.wfile.write(b'\r\n')
                    self.wfile.flush()
                if expected_length is not None and received != expected_length:
                    raise http.client.IncompleteRead(b'')
                if chunked and not self.state.stopped.is_set():
                    self.wfile.write(b'0\r\n\r\n')
                    self.wfile.flush()
        except RelayError as error:
            if not self.response_started:
                self._reject(error.status, error.code)
        except (TimeoutError, OSError, http.client.HTTPException, ValueError) as error:
            if not self.response_started and not self.state.stopped.is_set():
                self._reject(504 if isinstance(error, TimeoutError)
                             else 502, 'upstream_transport_failed')
            # After headers, close without a final chunk. Never append fabricated
            # JSON/SSE or retry a possibly billed request.
        finally:
            self.close_connection = True
            if stream_timer:
                stream_timer.cancel()
            self.state.cancel()
            if response:
                response.close()
            if upstream:
                upstream.close()
            if watcher:
                watcher.join(timeout=0.3)

    do_GET = do_POST = _forward


class _SafeParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, 'Invalid relay options; use --help.\n')


def main(argv=None):
    parser = _SafeParser(description=__doc__)
    parser.add_argument('--upstream', required=True, help='Fixed HTTPS origin, e.g. https://gateway.example')
    parser.add_argument('--listen-port', type=int, default=8787)
    parser.add_argument('--compress-min-bytes', type=int, default=32 * 1024)
    parser.add_argument('--max-body-bytes', type=int, default=16 * 1024 * 1024)
    parser.add_argument('--max-connections', type=int, default=4)
    parser.add_argument('--upload-timeout', type=float, default=60)
    parser.add_argument('--upstream-timeout', type=float, default=300)
    parser.add_argument('--write-timeout', type=float, default=30)
    parser.add_argument('--max-stream-seconds', type=float, default=3600)
    options = parser.parse_args(argv)
    try:
        if not 1 <= options.listen_port <= 65535:
            raise ValueError('Listen port must be between 1 and 65535')
        config = RelayConfig(options.upstream, options.compress_min_bytes,
                             options.max_body_bytes, options.max_connections,
                             options.upload_timeout, options.upstream_timeout,
                             options.write_timeout, options.max_stream_seconds)
        server = RelayServer(options.listen_port, config)
    except (ValueError, OSError):
        parser.exit(2, 'Cannot start relay: check the HTTPS origin, limits, and local port.\n')
    print(f'Upload relay listening on http://127.0.0.1:{server.server_port}; fixed HTTPS upstream configured.')
    try:
        server.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
