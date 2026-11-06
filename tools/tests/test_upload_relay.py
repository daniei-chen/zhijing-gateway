"""Real loopback HTTP fixtures; no provider, personal config, or real credentials."""
from contextlib import redirect_stderr, redirect_stdout
import gzip
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import queue
import select
import socket
from socketserver import BaseRequestHandler, ThreadingTCPServer
import ssl
import sys
import threading
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from upload_relay import RelayConfig, RelayServer, main  # noqa: E402

AUTH = 'Bearer synthetic-relay-credential-never-log'


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        self.received = queue.Queue()
        self.release = threading.Event()
        self.cancelled = threading.Event()
        self.first_event = threading.Event()
        super().__init__(('127.0.0.1', 0), FixtureHandler)

    def handle_error(self, request, client_address):
        pass


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, format, *args):
        pass

    def do_POST(self):
        self.handle_api()

    def do_GET(self):
        self.handle_api()

    def handle_api(self):
        length = int(self.headers.get('Content-Length', '0'))
        mode = self.headers.get('X-Fixture-Mode', 'echo')
        wire = bytearray()
        started = time.perf_counter()
        while len(wire) < length:
            part = self.rfile.read(min(16 * 1024, length - len(wire)))
            if not part:
                return
            wire.extend(part)
            if mode == 'throttle':
                # Synthetic receiver backpressure, not a WAN/provider benchmark.
                time.sleep(0.002)
        elapsed = time.perf_counter() - started
        wire = bytes(wire)
        encoding = self.headers.get('Content-Encoding', 'identity')
        decoded = gzip.decompress(wire) if encoding == 'gzip' else wire
        record = dict(wire=wire, decoded=decoded, headers=dict(self.headers.items()),
                      method=self.command, target=self.path, read_seconds=elapsed)
        self.server.received.put(record)
        if mode == 'reset':
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        if mode in ('sse', 'idle'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Connection', 'close')
            self.end_headers()
            if mode == 'sse':
                self.wfile.write(b'event: delta\ndata: {"text":"synthetic-first"}\n\n')
                self.wfile.flush()
                self.server.first_event.set()
            deadline = time.monotonic() + 4
            while not self.server.release.is_set() and time.monotonic() < deadline:
                readable, _, _ = select.select([self.connection], [], [], 0.05)
                if readable and self.connection.recv(1, socket.MSG_PEEK) == b'':
                    self.server.cancelled.set()
                    return
            self.wfile.write(b'event: done\ndata: [DONE]\n\n')
            self.wfile.flush()
            return
        if mode == 'truncated':
            self.send_response(200)
            self.send_header('Content-Length', '100')
            self.end_headers()
            self.wfile.write(b'partial')
            self.wfile.flush()
            return
        if mode == 'truncated-chunks':
            self.send_response(200)
            self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()
            self.wfile.write(b'7\r\npartial\r\n')
            self.wfile.flush()
            return
        payload = (b'{"error":{"message":"synthetic upstream denial"}}'
                   if mode == 'upstream-error' else json.dumps(dict(
                       sha256=hashlib.sha256(decoded).hexdigest(), wire_bytes=len(wire),
                       encoding=encoding)).encode())
        self.send_response(401 if mode == 'upstream-error' else 200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('X-Request-Id', 'synthetic-upstream-id')
        if mode == 'duplicate-length':
            self.send_header('Content-Length', str(len(payload)))
        if mode == 'ambiguous-framing':
            self.send_header('Transfer-Encoding', 'chunked')
        if mode == 'hop-headers':
            self.send_header('Connection', 'X-Upstream-Hop, Keep-Alive')
            self.send_header('X-Upstream-Hop', 'must-be-stripped')
            self.send_header('Keep-Alive', 'timeout=30')
            self.send_header('Proxy-Authenticate', 'must-be-stripped')
            self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(payload)


class PendingTLSHandler(BaseRequestHandler):
    def handle(self):
        self.request.settimeout(3)
        try:
            if self.request.recv(4096):
                self.server.client_hello.set()
                while self.request.recv(4096):
                    pass
                self.server.cancelled.set()
        except OSError:
            pass


class PendingTLSServer(ThreadingTCPServer):
    daemon_threads = True

    def __init__(self):
        self.client_hello,self.cancelled=threading.Event(),threading.Event()
        super().__init__(('127.0.0.1',0),PendingTLSHandler)

    def handle_error(self,request,client_address):
        pass


def serve(server):
    thread = threading.Thread(target=server.serve_forever,
                              kwargs={'poll_interval': 0.02}, daemon=True)
    thread.start()
    return thread


class UploadRelayTests(unittest.TestCase):
    def setUp(self):
        self.upstream = FixtureServer()
        self.upstream_thread = serve(self.upstream)
        self.addCleanup(self.stop_upstream)
        self.relay = self.make_relay()

    def stop_upstream(self):
        self.upstream.release.set()
        self.upstream.shutdown()
        self.upstream.server_close()
        self.upstream_thread.join(timeout=2)

    def make_relay(self, **overrides):
        defaults = dict(upstream=f'http://127.0.0.1:{self.upstream.server_port}',
                        allow_loopback_http=True, compress_min_bytes=1024,
                        max_body_bytes=8 * 1024 * 1024, upload_timeout=2,
                        upstream_timeout=2, write_timeout=2, max_stream_seconds=5)
        defaults.update(overrides)
        server = RelayServer(0, RelayConfig(**defaults))
        thread = serve(server)

        def stop():
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.addCleanup(stop)
        return server

    def request(self, body=b'{}', headers=None, path='/v1/responses', method='POST', relay=None):
        server = relay or self.relay
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        fields = {'Authorization': AUTH, 'Content-Type': 'application/json'}
        fields.update(headers or {})
        connection.request(method, path, body, fields)
        response = connection.getresponse()
        data = response.read()
        result = response.status, dict(response.getheaders()), data
        response.close()
        connection.close()
        return result

    def raw(self, header_lines, body=b'', path='/v1/responses', method='POST',
            half_close=False, relay=None, add_auth=True, host=None):
        server = relay or self.relay
        lines = [f'{method} {path} HTTP/1.1',
                 f'Host: {host or f"127.0.0.1:{server.server_port}"}']
        if add_auth:
            lines.append(f'Authorization: {AUTH}')
        lines.extend(header_lines)
        with socket.create_connection(server.server_address, timeout=3) as connection:
            connection.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode() + body)
            if half_close:
                connection.shutdown(socket.SHUT_WR)
            response = http.client.HTTPResponse(connection)
            response.begin()
            result = response.status, response.read()
            response.close()
            return result

    def test_large_json_compresses_without_changing_any_decoded_byte_or_authorization(self):
        body = b'{ "input": "' + b'synthetic unicode \xe7\xb4\xa0\xe6\x9d\x90 ' * 2000 + b'", "x": 1 }\n'
        status, headers, result = self.request(body, path='/v1/responses?synthetic=1')
        self.assertEqual(status, 200)
        observed = self.upstream.received.get(timeout=2)
        self.assertEqual(observed['decoded'], body)
        self.assertEqual(observed['headers']['Authorization'], AUTH)
        self.assertEqual(observed['headers']['Content-Encoding'], 'gzip')
        self.assertEqual(int(observed['headers']['Content-Length']), len(observed['wire']))
        self.assertLess(len(observed['wire']), len(body))
        self.assertEqual(observed['target'], '/v1/responses?synthetic=1')
        self.assertEqual(json.loads(result)['sha256'], hashlib.sha256(body).hexdigest())
        self.assertEqual(headers['X-Request-Id'], 'synthetic-upstream-id')

    def test_small_or_non_json_or_non_beneficial_payload_stays_identity(self):
        always_try = self.make_relay(compress_min_bytes=0)
        for body, content_type, relay in (
                (b'{"short":1}', 'application/json', self.relay),
                (b'x' * 5000, 'application/octet-stream', self.relay),
                (b'{}', 'application/json', always_try)):
            with self.subTest(kind=content_type, size=len(body)):
                self.assertEqual(self.request(body, {'Content-Type': content_type}, relay=relay)[0], 200)
                observed = self.upstream.received.get(timeout=2)
                self.assertEqual(observed['wire'], body)
                self.assertNotIn('Content-Encoding', observed['headers'])

    def test_existing_compression_is_forwarded_once_and_identity_can_be_compressed(self):
        original = b'{"input":"' + b'synthetic ' * 3000 + b'"}'
        compressed = gzip.compress(original, mtime=0)
        self.assertEqual(self.request(compressed, {'Content-Encoding': 'gzip'})[0], 200)
        observed = self.upstream.received.get(timeout=2)
        self.assertEqual(observed['wire'], compressed)
        self.assertEqual(observed['decoded'], original)
        self.assertEqual(self.request(original, {'Content-Encoding': 'identity'})[0], 200)
        self.assertEqual(self.upstream.received.get(timeout=2)['headers']['Content-Encoding'], 'gzip')
        # Opaque wire bytes exercise passthrough, not zstd codec validation.
        opaque = b'synthetic-opaque-zstd-wire'
        self.assertEqual(self.request(opaque, {'Content-Encoding': 'zstd'})[0], 200)
        self.assertEqual(self.upstream.received.get(timeout=2)['wire'], opaque)

    def test_first_sse_event_is_readable_while_upstream_is_still_open(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.relay.server_port, timeout=2)
        self.addCleanup(connection.close)
        connection.request('POST', '/v1/responses', b'{}',
                           {'Authorization': AUTH, 'X-Fixture-Mode': 'sse'})
        response = connection.getresponse()
        self.addCleanup(response.close)
        first = response.read1(65536)
        self.assertEqual(first, b'event: delta\ndata: {"text":"synthetic-first"}\n\n')
        self.assertTrue(self.upstream.first_event.is_set())
        self.assertFalse(self.upstream.release.is_set())
        self.upstream.release.set()
        self.assertEqual(response.read(), b'event: done\ndata: [DONE]\n\n')

    def test_client_cancellation_closes_an_idle_upstream_promptly(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.relay.server_port, timeout=2)
        connection.request('POST', '/v1/responses', b'{}',
                           {'Authorization': AUTH, 'X-Fixture-Mode': 'idle'})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        response.close()
        connection.close()
        self.assertTrue(self.upstream.cancelled.wait(1.5), 'upstream must close before its 2-second read timeout')

    def test_client_cancellation_also_interrupts_a_pending_tls_handshake(self):
        pending=PendingTLSServer();thread=serve(pending)
        self.addCleanup(lambda: (pending.shutdown(),pending.server_close(),thread.join(timeout=2)))
        relay=self.make_relay(upstream=f'https://127.0.0.1:{pending.server_address[1]}',
                              allow_loopback_http=False,upstream_timeout=3)
        with socket.create_connection(relay.server_address,timeout=2) as connection:
            request=(f'POST /v1/responses HTTP/1.1\r\nHost: 127.0.0.1:{relay.server_port}\r\n'
                     f'Authorization: {AUTH}\r\nContent-Length: 2\r\n\r\n').encode()+b'{}'
            connection.sendall(request)
            self.assertTrue(pending.client_hello.wait(1))
        self.assertTrue(pending.cancelled.wait(1.5),'TLS handshake must close before its 3-second timeout')

    def test_stream_deadline_closes_without_a_false_successful_final_chunk(self):
        relay = self.make_relay(max_stream_seconds=0.25)
        connection = http.client.HTTPConnection('127.0.0.1', relay.server_port, timeout=2)
        self.addCleanup(connection.close)
        connection.request('POST', '/v1/responses', b'{}',
                           {'Authorization': AUTH, 'X-Fixture-Mode': 'sse'})
        response = connection.getresponse()
        self.addCleanup(response.close)
        self.assertIn(b'synthetic-first', response.read1(65536))
        with self.assertRaises(http.client.IncompleteRead):
            response.read()
        self.assertTrue(self.upstream.cancelled.wait(1))

    def test_upstream_errors_are_preserved_and_never_retried(self):
        status, _, body = self.request(headers={'X-Fixture-Mode': 'upstream-error'})
        self.assertEqual(status, 401)
        self.assertEqual(body, b'{"error":{"message":"synthetic upstream denial"}}')
        self.upstream.received.get(timeout=2)
        self.assertTrue(self.upstream.received.empty())
        status, _, body = self.request(headers={'X-Fixture-Mode': 'reset'})
        self.assertEqual(status, 502)
        self.assertEqual(json.loads(body)['error']['code'], 'upstream_transport_failed')
        self.upstream.received.get(timeout=2)
        self.assertTrue(self.upstream.received.empty())

    def test_upstream_truncation_remains_a_transport_failure(self):
        for mode in ('truncated', 'truncated-chunks'):
            with self.subTest(mode=mode):
                connection = http.client.HTTPConnection('127.0.0.1', self.relay.server_port, timeout=3)
                connection.request('POST', '/v1/responses', b'{}',
                                   {'Authorization': AUTH, 'X-Fixture-Mode': mode})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                with self.assertRaises(http.client.IncompleteRead) as error:
                    response.read()
                self.assertEqual(error.exception.partial, b'partial')
                response.close()
                connection.close()

    def test_invalid_upstream_framing_fails_before_forwarding_headers(self):
        for mode in ('duplicate-length', 'ambiguous-framing'):
            with self.subTest(mode=mode):
                self.assertEqual(self.request(headers={'X-Fixture-Mode': mode})[0], 502)

    def test_hop_by_hop_and_connection_named_headers_are_removed_both_ways(self):
        status, headers, _ = self.request(headers={
            'Connection': 'X-Client-Hop, keep-alive', 'X-Client-Hop': 'remove',
            'Keep-Alive': 'timeout=30', 'Proxy-Authorization': 'synthetic-proxy-secret',
            'X-Fixture-Mode': 'hop-headers'})
        self.assertEqual(status, 200)
        observed = self.upstream.received.get(timeout=2)['headers']
        for name in ('X-Client-Hop', 'Keep-Alive', 'Proxy-Authorization'):
            self.assertNotIn(name, observed)
        for name in ('X-Upstream-Hop', 'Keep-Alive', 'Proxy-Authenticate', 'Access-Control-Allow-Origin'):
            self.assertNotIn(name, headers)
        self.assertEqual(headers['Connection'], 'close')

    def test_local_origin_host_and_authorization_boundaries(self):
        for name, value in (('Origin', 'https://attacker.invalid'), ('Origin', 'null'),
                            ('Sec-Fetch-Site', 'same-origin'), ('Referer', 'https://attacker.invalid/')):
            with self.subTest(header=name, value=value):
                self.assertEqual(self.request(headers={name: value})[0], 403)
        self.assertEqual(self.raw(['Content-Length: 2'], b'{}', host='attacker.invalid')[0], 403)
        self.assertEqual(self.raw(['Content-Length: 2'], b'{}', add_auth=False)[0], 401)
        self.assertTrue(self.upstream.received.empty())

    def test_only_explicit_api_routes_and_methods_are_forwarded(self):
        for path in ('/api/v1/admin/users', '/api/v1/auth/login', '/v1/../api/v1/admin/users',
                     '/v1/%72esponses', '/v1/responses/', '//attacker.invalid/v1/responses'):
            with self.subTest(path=path):
                self.assertIn(self.request(path=path)[0], (400, 404))
        self.assertEqual(self.raw(['Content-Length: 0'], method='CONNECT')[0], 405)
        self.assertEqual(self.request(path='/v1/models')[0], 405)
        self.assertEqual(self.raw(['Content-Length: 2', 'Connection: Upgrade',
                                   'Upgrade: websocket'], b'{}')[0], 426)
        self.assertTrue(self.upstream.received.empty())
        self.assertEqual(self.request(b'', path='/v1/models', method='GET')[0], 200)
        self.assertEqual(self.upstream.received.get(timeout=2)['method'], 'GET')

    def test_http_smuggling_and_duplicate_critical_headers_are_rejected(self):
        invalid = (
            ['Content-Length: 2', 'Content-Length: 2'],
            ['Content-Length: 2', 'content-length: 3'],
            ['Content-Length: 2', 'Transfer-Encoding: chunked'],
            ['Transfer-Encoding: chunked'],
            ['Content-Length: 2', 'Authorization: Bearer duplicate'],
            ['Content-Length: 2', 'Host: 127.0.0.1'],
            ['Content-Length: 2', 'Content-Encoding: identity', 'content-encoding: gzip'],
            ['Content-Length: 2', 'Content-Type: application/json', 'content-type: text/plain'],
            ['Content-Length: 2', 'Connection: Authorization'],
            ['Content-Length: 2', 'X-Fold: one\r\n two'],
            ['Content-Length: 2', 'Invalid Header: value'],
        )
        for fields in invalid:
            with self.subTest(fields=fields):
                self.assertEqual(self.raw(fields, b'{}')[0], 400)
        self.assertTrue(self.upstream.received.empty())

    def test_content_length_size_and_incomplete_upload_limits(self):
        for value in ('-1', '+2', '2, 2', 'not-a-number', ''):
            with self.subTest(length=value):
                self.assertEqual(self.raw([f'Content-Length: {value}'], b'{}')[0], 400)
        self.assertEqual(self.raw([], b'{}')[0], 411)
        small = self.make_relay(max_body_bytes=128, compress_min_bytes=0)
        self.assertEqual(self.raw(['Content-Length: 129'], relay=small)[0], 413)
        self.assertEqual(self.raw(['Content-Length: 10'], b'{}', half_close=True)[0], 400)
        self.assertTrue(self.upstream.received.empty())

    def test_header_and_total_upload_deadlines_are_bounded(self):
        status, _ = self.raw(['Content-Length: 2', 'X-Padding: ' + 'x' * (33 * 1024)], b'{}')
        self.assertEqual(status, 431)
        short = self.make_relay(upload_timeout=0.15)
        self.assertEqual(self.raw(['Content-Length: 100'], b'{', relay=short)[0], 408)
        self.assertTrue(self.upstream.received.empty())

    def test_expect_continue_is_authorized_before_inviting_an_upload(self):
        with socket.create_connection(self.relay.server_address, timeout=2) as connection:
            fields = (f'POST /v1/responses HTTP/1.1\r\nHost: 127.0.0.1:{self.relay.server_port}\r\n'
                      f'Authorization: {AUTH}\r\nContent-Length: 2\r\nExpect: 100-continue\r\n\r\n')
            connection.sendall(fields.encode())
            interim = connection.recv(4096)
            self.assertEqual(interim, b'HTTP/1.1 100 Continue\r\n\r\n')
            connection.sendall(b'{}')
            response = http.client.HTTPResponse(connection)
            response.begin()
            self.assertEqual(response.status, 200)
            response.read()
            response.close()
        self.assertEqual(self.raw(['Content-Length: 2', 'Expect: 100-continue'],
                                  b'{}', add_auth=False)[0], 401)

    def test_concurrency_is_capped_and_shutdown_releases_upstream(self):
        relay = self.make_relay(max_connections=1)
        first = http.client.HTTPConnection('127.0.0.1', relay.server_port, timeout=2)
        first.request('POST', '/v1/responses', b'{}', {'Authorization': AUTH, 'X-Fixture-Mode': 'idle'})
        response = first.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(self.request(relay=relay)[0], 503)
        relay.shutdown()
        relay.server_close()
        self.assertTrue(self.upstream.cancelled.wait(1.5))
        response.close()
        first.close()

    def test_request_logs_never_include_credentials_body_or_raw_targets(self):
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            self.request(b'{"private":"synthetic-private-body"}')
            self.raw(['Content-Length: 2', 'Content-Length: 3'], b'{}')
            self.request(path='/api/v1/auth/login?synthetic-private-query=1')
            with patch.object(http.client.HTTPConnection,'debuglevel',1):
                self.raw(['Content-Length: 2'],b'{}')
        self.assertEqual(output.getvalue(), '')
        self.assertNotIn(AUTH, output.getvalue())

    def test_surplus_bytes_and_pipelining_cannot_create_a_second_upstream_request(self):
        with socket.create_connection(self.relay.server_address,timeout=2) as connection:
            first=(f'POST /v1/responses HTTP/1.1\r\nHost: 127.0.0.1:{self.relay.server_port}\r\n'
                   f'Authorization: {AUTH}\r\nContent-Length: 2\r\n\r\n{{}}')
            second=(f'GET /api/v1/admin/users HTTP/1.1\r\nHost: 127.0.0.1:{self.relay.server_port}\r\n'
                    f'Authorization: {AUTH}\r\n\r\n')
            connection.sendall((first+second).encode())
            try:
                response=http.client.HTTPResponse(connection);response.begin();response.read();response.close()
            except (OSError,http.client.HTTPException):
                pass
        targets=[]
        while not self.upstream.received.empty():
            targets.append(self.upstream.received.get_nowait()['target'])
        self.assertIn(targets,([],['/v1/responses']))

    def test_real_throttled_receiver_observes_fewer_wire_bytes_and_equal_json(self):
        body = json.dumps({'input': 'SYNTHETIC_UPLOAD_CONTEXT_' * 220000},
                          separators=(',', ':')).encode()
        identity = self.make_relay(compress_min_bytes=8 * 1024 * 1024)
        self.assertEqual(self.request(body, {'X-Fixture-Mode': 'throttle'}, relay=identity)[0], 200)
        plain = self.upstream.received.get(timeout=2)
        self.assertEqual(self.request(body, {'X-Fixture-Mode': 'throttle'})[0], 200)
        packed = self.upstream.received.get(timeout=2)
        self.assertEqual(plain['decoded'], body)
        self.assertEqual(packed['decoded'], body)
        self.assertLess(len(packed['wire']), len(plain['wire']) // 10)
        self.assertLess(packed['read_seconds'], plain['read_seconds'] / 2)
        print('SYNTHETIC_UPLOAD_PROOF ' + json.dumps({
            'identity_wire_bytes': len(plain['wire']), 'gzip_wire_bytes': len(packed['wire']),
            'identity_throttled_read_ms': round(plain['read_seconds'] * 1000, 2),
            'gzip_throttled_read_ms': round(packed['read_seconds'] * 1000, 2),
            'decoded_sha256_equal': True, 'supplier_inference_benchmark': False}, sort_keys=True))


class RelayConfigurationTests(unittest.TestCase):
    def test_upstream_is_fixed_https_origin_and_http_is_only_literal_loopback_in_tests(self):
        for origin in ('http://gateway.example', 'http://192.0.2.1', 'https://user:secret@gateway.example',
                       'https://gateway.example?key=secret', 'https://gateway.example/#fragment',
                       'https://gateway.example/v1', '//gateway.example', 'https://gateway.example\\@attacker.invalid'):
            with self.subTest(origin=origin):
                with self.assertRaises(ValueError):
                    RelayConfig(origin)
        for origin in ('http://192.0.2.1', 'http://localhost', 'http://127.0.0.1.evil.invalid'):
            with self.assertRaises(ValueError):
                RelayConfig(origin, allow_loopback_http=True)
        RelayConfig('http://127.0.0.1:1234', allow_loopback_http=True)
        RelayConfig('https://gateway.example')

    def test_tls_validation_and_safe_cli_errors(self):
        server = RelayServer(0, RelayConfig('https://gateway.example'))
        try:
            self.assertTrue(server.tls_context.check_hostname)
            self.assertEqual(server.tls_context.verify_mode,ssl.CERT_REQUIRED)
            self.assertEqual(server.server_address[0], '127.0.0.1')
        finally:
            server.server_close()
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            with self.assertRaises(SystemExit) as error:
                main(['--upstream', 'https://user:synthetic-secret@gateway.example'])
        self.assertEqual(error.exception.code, 2)
        self.assertNotIn('synthetic-secret', output.getvalue())

    def test_ambient_tls_keylogging_is_not_enabled(self):
        with tempfile.TemporaryDirectory() as directory:
            keylog=Path(directory)/'synthetic-tls-keylog.txt'
            with patch.dict(os.environ,{'SSLKEYLOGFILE':str(keylog)}):
                server=RelayServer(0,RelayConfig('https://gateway.example'))
                try:
                    self.assertIsNone(server.tls_context.keylog_filename)
                    self.assertFalse(keylog.exists())
                finally:
                    server.server_close()


if __name__ == '__main__':
    unittest.main()
