#!/usr/bin/env python3
"""Tiny static server for Easy3D Studio with explicit MIME types.

`python -m http.server` trusts the Windows registry for MIME types, and on
many machines .js is registered as text/plain — browsers then refuse to run
the app's modules and every button is dead. This server pins the types.
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.wasm': 'application/wasm',
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '': 'application/octet-stream',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet
        pass


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        port = int(os.environ.get('PORT') or (sys.argv[1] if len(sys.argv) > 1 else 8080))
    except ValueError:
        port = 8080
    try:
        server = ThreadingHTTPServer(('', port), Handler)
    except OSError:
        print('Port %d is already in use.' % port)
        print('Close the other program using it, or run:  python serve.py 8081')
        sys.exit(1)
    print('Easy3D Studio ->  http://localhost:%d   (keep this window open)' % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
