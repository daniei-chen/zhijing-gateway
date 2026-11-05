"""Exercise the loopback QA HTTP boundary using synthetic, unauthenticated inputs."""
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import socket
import sys
from threading import Thread
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'qa'))
from preview_server import Handler  # noqa: E402


class QuietServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # A missing response is still a failing assertion, without noisy fixture tracebacks.
        pass


class PreviewBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = QuietServer(('127.0.0.1', 0), Handler)
        cls.thread = Thread(target=cls.server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, body=b'', headers=None, path='/api/v1/auth/login', method='POST'):
        headers = headers if headers is not None else [f'Content-Length: {len(body)}']
        request = ('\r\n'.join([f'{method} {path} HTTP/1.0', 'Host: 127.0.0.1', *headers]) + '\r\n\r\n').encode() + body
        with socket.create_connection(self.server.server_address, timeout=2) as connection:
            connection.sendall(request)
            connection.shutdown(socket.SHUT_WR)
            response = bytearray()
            while chunk := connection.recv(65536):
                response.extend(chunk)
        first_line = bytes(response).split(b'\r\n', 1)[0].split()
        return int(first_line[1]) if len(first_line) > 1 else 0

    def test_valid_synthetic_login_is_unchanged(self):
        body = json.dumps(dict(email='member@preview.local', password='Preview2026!')).encode()
        self.assertEqual(self.request(body), 200)

    def test_invalid_content_lengths_are_rejected_without_reading_unbounded_bodies(self):
        for value in ('-1', 'not-a-number', '+2'):
            with self.subTest(length=value):
                self.assertEqual(self.request(b'{}', [f'Content-Length: {value}']), 400)

    def test_oversized_body_is_rejected(self):
        self.assertEqual(self.request(b' ' * 16385), 413)

    def test_ambiguous_http_framing_is_rejected(self):
        for headers in (['Content-Length: 2', 'Content-Length: 2'],
                        ['Content-Length: 2', 'Transfer-Encoding: chunked']):
            with self.subTest(headers=headers):
                self.assertEqual(self.request(b'{}', headers), 400)

    def test_malformed_or_nonobject_json_returns_a_client_error(self):
        for body in (b'{', b'[]', b'null', b'"text"'):
            with self.subTest(body=body):
                self.assertEqual(self.request(body), 400)

    def test_invalid_diagnostic_pagination_returns_a_client_error(self):
        self.assertEqual(self.request(path='/api/v1/admin/ops/requests?page=bad', method='GET'), 400)


if __name__ == '__main__':
    unittest.main()
