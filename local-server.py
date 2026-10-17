#!/usr/bin/env python3
"""TusaBots Local HQ server.

Serves the dashboard static files and proxies API requests to local services:
  /api/ollama/*  → http://127.0.0.1:11434/*  (Ollama)
  /api/commander → http://127.0.0.1:11436    (Commander API)

Binds to 0.0.0.0:8585 so any device on the LAN can access the dashboard.
UFW blocks external access — only LAN devices can reach this port.
"""

import http.server
import json
import os
import urllib.request
import urllib.error

PORT = 8585
OLLAMA_BASE = 'http://127.0.0.1:11434'
COMMANDER_BASE = 'http://127.0.0.1:11436'

# Read tunnel secret for Commander API auth
_secret_path = os.path.join(os.path.expanduser('~'), 'tunnel-proxy', '.secret')
try:
    with open(_secret_path) as f:
        TUNNEL_SECRET = f.read().strip()
except FileNotFoundError:
    TUNNEL_SECRET = ''
    print(f'[WARNING] {_secret_path} not found — Commander proxy will fail auth')

# Serve static files from the repo root
WEB_ROOT = os.path.dirname(os.path.abspath(__file__))


class LocalHQHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_ROOT, **kwargs)

    def do_GET(self):
        # Proxy GET requests to Ollama (e.g. /api/ollama/api/tags)
        if self.path.startswith('/api/ollama/'):
            ollama_path = self.path[len('/api/ollama'):]
            try:
                req = urllib.request.Request(f'{OLLAMA_BASE}{ollama_path}', method='GET')
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = resp.read()
                    self.send_response(resp.status)
                    self._cors_headers()
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self._cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
            return

        # Fall through to static file serving
        super().do_GET()

    def do_POST(self):
        # Proxy: /api/ollama/* → Ollama
        if self.path.startswith('/api/ollama/'):
            ollama_path = self.path[len('/api/ollama'):]  # e.g. /api/chat
            self._proxy(f'{OLLAMA_BASE}{ollama_path}')
            return

        # Proxy: /api/commander → Commander API (with auth)
        if self.path == '/api/commander':
            self._proxy(COMMANDER_BASE, extra_headers={'X-Tunnel-Secret': TUNNEL_SECRET})
            return

        self.send_error(404, 'Not found')

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _proxy(self, target_url, extra_headers=None):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length > 0 else b''

            headers = {'Content-Type': 'application/json'}
            if extra_headers:
                headers.update(extra_headers)

            req = urllib.request.Request(
                target_url,
                data=body,
                headers=headers,
                method='POST',
            )

            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self._cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)

        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8', errors='replace')
            self.send_response(e.code)
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(error_body.encode())

        except Exception as e:
            self.send_response(502)
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def end_headers(self):
        # Add CORS to all responses (including static files)
        if not any(h == 'Access-Control-Allow-Origin' for h, _ in self._headers_buffer_list()):
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def _headers_buffer_list(self):
        """Parse already-buffered headers to avoid duplicates."""
        pairs = []
        for line in self._headers_buffer:
            if isinstance(line, bytes):
                line = line.decode('utf-8', errors='replace')
            if ':' in line:
                k, v = line.split(':', 1)
                pairs.append((k.strip(), v.strip()))
        return pairs

    def log_message(self, format, *args):
        # Quieter logs — only errors and API proxies
        msg = format % args
        if '/api/' in msg or '404' in msg or '500' in msg or '502' in msg:
            print(f'[LocalHQ] {msg}')


if __name__ == '__main__':
    print(f'TusaBots Local HQ serving on http://0.0.0.0:{PORT}')
    print(f'  Dashboard: http://192.168.50.111:{PORT}/dashboard.html')
    print(f'  Ollama proxy: /api/ollama/* → {OLLAMA_BASE}')
    print(f'  Commander proxy: /api/commander → {COMMANDER_BASE}')

    server = http.server.HTTPServer(('0.0.0.0', PORT), LocalHQHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down.')
        server.shutdown()
