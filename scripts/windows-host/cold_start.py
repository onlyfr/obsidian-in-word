"""Owned Word fixture only: start its bounded acceptance server on the first pane navigation."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import secrets
import ssl
import threading
from urllib.parse import urlsplit


class LaunchEndpoint:
    def __init__(self, certificates):
        path = '/open/' + secrets.token_hex(24)
        self.start_server = None
        self.started = False
        lock = threading.Lock()
        endpoint = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                target = urlsplit(self.path)
                if target.path != path or self.headers.get('Host') != endpoint.authority:
                    self.send_error(404)
                    return
                with lock:
                    if not endpoint.started:
                        endpoint.start_server()
                        endpoint.started = True
                query = '?' + target.query if target.query else ''
                self.send_response(307)
                self.send_header('Location', 'https://localhost:49175/index.html' + query)
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificates / 'localhost.crt', certificates / 'localhost.key')
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.authority = f'localhost:{self.server.server_port}'
        self.url = 'https://' + self.authority + path

    @contextmanager
    def serve(self, start_server):
        self.start_server = start_server
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        try:
            yield
        finally:
            self.server.shutdown()
            self.server.server_close()
            thread.join()
