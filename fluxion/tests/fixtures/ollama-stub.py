#!/usr/bin/env python3
"""Small loopback-only Ollama fixture for the packaged macOS runtime gate."""

import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 19876
EVIDENCE_PATH = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None


class OllamaFixture(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path != "/api/tags":
            self.send_json(404, {"error": "not found"})
            return
        self.send_json(200, {"models": [{"name": "fluxion-test"}]})

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length))
            messages = request.get("messages", [])
            context = messages[1].get("content", "") if len(messages) > 1 else ""
            valid = (
                request.get("model") == "fluxion-test"
                and request.get("stream") is False
                and len(messages) == 2
                and messages[0].get("role") == "system"
                and messages[1].get("role") == "user"
                and "<page-context>" in context
                and "Example Domain" in context
            )
            if not valid:
                self.send_json(400, {"error": "invalid grounded chat request"})
                return
            if EVIDENCE_PATH:
                EVIDENCE_PATH.write_text(
                    json.dumps({
                        "model": request["model"],
                        "message_roles": [message["role"] for message in messages],
                        "has_page_context": True,
                    }),
                    encoding="utf-8",
                )
            self.send_json(200, {
                "message": {
                    "role": "assistant",
                    "content": "The page is reserved for use in documentation examples.",
                }
            })
        except (ValueError, json.JSONDecodeError, OSError) as error:
            self.send_json(400, {"error": str(error)})

    def log_message(self, *_args):
        pass


class ReusableLoopbackServer(ThreadingHTTPServer):
    allow_reuse_address = True


ReusableLoopbackServer(("127.0.0.1", PORT), OllamaFixture).serve_forever()
