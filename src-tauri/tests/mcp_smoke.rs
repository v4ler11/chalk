//! Throwaway end-to-end check of the MCP client: four real servers — both
//! transports, both protocol revisions — spoken to through the app's own client.
//! Delete once verified; the hermetic unit tests live in `src/mcp.rs`.

use std::collections::BTreeMap;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chalk_lib::mcp::{Client, Server, ToolOffer, Transport};
use parking_lot::Mutex;

/// A model context protocol server, written small enough to read: either
/// revision, either transport, with three tools — one that answers, one whose
/// name needs bringing into a function name's alphabet, and one that fails.
const SERVER: &str = r#"
import argparse, json, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOOLS = [
    {"name": "echo", "title": "Echo", "description": "Echoes the text it is given.",
     "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
    {"name": "weather.get", "description": "Says what the weather is.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "boom", "description": "Always fails.", "inputSchema": {"type": "object", "properties": {}}},
]

def call(name, args):
    if name == "echo":
        return {"content": [{"type": "text", "text": str(args.get("text", ""))}]}
    if name == "weather.get":
        return {"content": [{"type": "text", "text": "sunny"}]}
    if name == "boom":
        return {"isError": True, "content": [{"type": "text", "text": "the tool refused"}]}
    return None

def answer(msg, era):
    """The result for one request, or None for a notification."""
    method = msg.get("method")
    params = msg.get("params") or {}
    if method == "server/discover":
        if era == "legacy":
            return {"error": {"code": -32601, "message": "Method not found"}}
        return {"resultType": "complete", "supportedVersions": ["2026-07-28"],
                "capabilities": {"tools": {}}, "ttlMs": 1000, "cacheScope": "public",
                "_meta": {"io.modelcontextprotocol/serverInfo": {"name": "SmokeServer", "version": "9.9"}}}
    if method == "initialize":
        if era == "modern":
            return {"error": {"code": -32601, "message": "Method not found"}}
        return {"protocolVersion": "2025-11-25", "capabilities": {"tools": {}},
                "serverInfo": {"name": "SmokeServer", "version": "9.9"}}
    if method == "notifications/initialized":
        return None
    if method == "tools/list":
        out = {"tools": TOOLS}
        if era == "modern":
            out.update({"resultType": "complete", "ttlMs": 1000, "cacheScope": "public"})
        return out
    if method == "tools/call":
        out = call(params.get("name"), params.get("arguments") or {})
        if out is None:
            return {"error": {"code": -32602, "message": "no such tool"}}
        if era == "modern":
            out["resultType"] = "complete"
        return out
    return {"error": {"code": -32601, "message": "Method not found"}}

def reply(msg, era):
    out = answer(msg, era)
    if out is None:
        return None
    if "error" in out:
        return {"jsonrpc": "2.0", "id": msg.get("id"), "error": out["error"]}
    return {"jsonrpc": "2.0", "id": msg.get("id"), "result": out}

def serve_http(port, era, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            msg = json.loads(self.rfile.read(length) or b"{}")
            method = msg.get("method")
            # What a modern request has to carry: the version, the method, and —
            # for a call — the tool's name, in the body's `_meta` and in the
            # transport's own headers.
            if era == "modern":
                meta = (msg.get("params") or {}).get("_meta") or {}
                ok = (self.headers.get("MCP-Protocol-Version") == "2026-07-28"
                      and self.headers.get("Mcp-Method") == method
                      and meta.get("io.modelcontextprotocol/protocolVersion") == "2026-07-28")
                if method == "tools/call":
                    ok = ok and self.headers.get("Mcp-Name") == (msg.get("params") or {}).get("name")
                if not ok:
                    body = json.dumps({"jsonrpc": "2.0", "id": msg.get("id"),
                                       "error": {"code": -32020, "message": "Header mismatch",
                                                 "headers": dict(self.headers)}}).encode()
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
            if token is not None and self.headers.get("X-Test-Token") != token:
                self.send_response(401)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            out = reply(msg, era)
            if out is None:
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            body = json.dumps(out).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

def serve_stdio(era):
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        out = reply(msg, era)
        if out is not None:
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--era", default="modern")
    parser.add_argument("--transport", default="stdio")
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--token", default=None)
    args = parser.parse_args()
    print("smoke server up: %s over %s" % (args.era, args.transport), file=sys.stderr, flush=True)
    if args.transport == "http":
        serve_http(args.port, args.era, args.token)
    else:
        serve_stdio(args.era)
"#;

fn script() -> std::path::PathBuf {
    let path = std::env::temp_dir().join("chalk-mcp-smoke-server.py");
    std::fs::write(&path, SERVER).expect("writing the smoke server");
    path
}

fn http(script: &std::path::Path, era: &str, port: u16, token: Option<&str>) -> Child {
    let mut cmd = Command::new("python3");
    cmd.arg(script)
        .arg("--era")
        .arg(era)
        .arg("--transport")
        .arg("http")
        .arg("--port")
        .arg(port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(token) = token {
        cmd.arg("--token").arg(token);
    }
    cmd.spawn().expect("starting the smoke server")
}

/// A port nothing is listening on: taken from the OS and handed straight back.
///
/// Fixed ports would make a run of this test collide with the last one — a
/// server left behind by a failed run goes on answering on the port its
/// successor is trying to use, which reads as this app losing data the old
/// server never had.
fn free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a free port");
    listener.local_addr().expect("a bound address").port()
}

/// Waits until something is listening, so the client does not race the server.
fn listening(port: u16) {
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("nothing listened on {port}");
}

fn http_server(id: &str, port: u16, token: Option<&str>) -> Server {
    Server {
        id: id.into(),
        name: id.into(),
        enabled: true,
        auto_run: false,
        lazy: false,
        description: String::new(),
        transport: Transport::Http {
            url: format!("http://127.0.0.1:{port}/mcp"),
            headers: token
                .map(|token| BTreeMap::from([("X-Test-Token".to_string(), token.to_string())]))
                .unwrap_or_default(),
        },
    }
}

fn stdio_server(script: &std::path::Path, id: &str, era: &str) -> Server {
    Server {
        id: id.into(),
        name: id.into(),
        enabled: true,
        auto_run: true,
        lazy: false,
        description: String::new(),
        transport: Transport::Stdio {
            command: "python3".into(),
            // The stdio servers are spawned by the client, so the script is the
            // command's own argument rather than a pipe this test holds.
            args: vec![script.display().to_string(), "--era".into(), era.into()],
            env: BTreeMap::new(),
        },
    }
}

/// Kept out of the default run: it starts real server processes with `python3`,
/// which a test suite cannot assume. Run it with `cargo test -- --ignored` — it
/// is the only check that speaks to a server of each era over each transport.
#[test]
#[ignore = "spawns real servers and needs python3; run with --ignored"]
fn the_client_reaches_servers_of_both_eras_over_both_transports() {
    let script = script();
    let (modern_port, legacy_port) = (free_port(), free_port());
    let mut servers_started = vec![
        http(&script, "modern", modern_port, Some("secret")),
        http(&script, "legacy", legacy_port, None),
    ];
    listening(modern_port);
    listening(legacy_port);

    let servers = vec![
        http_server("modern_http", modern_port, Some("secret")),
        http_server("legacy_http", legacy_port, None),
        stdio_server(&script, "modern_stdio", "modern"),
        stdio_server(&script, "legacy_stdio", "legacy"),
    ];

    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let client = Client::new({
        let lines = lines.clone();
        Arc::new(move |level: &str, message: String| {
            lines.lock().push(format!("[{level}] {message}"));
        })
    });

    tauri::async_runtime::block_on(async {
        let offered = client.tools(&servers).await;
        assert!(offered.failures.is_empty(), "{:?}", offered.failures);
        let mut names: Vec<&str> = offered.tools.iter().map(|tool| tool.name.as_str()).collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "legacy_http__boom",
                "legacy_http__echo",
                "legacy_http__weather_get",
                "legacy_stdio__boom",
                "legacy_stdio__echo",
                "legacy_stdio__weather_get",
                "modern_http__boom",
                "modern_http__echo",
                "modern_http__weather_get",
                "modern_stdio__boom",
                "modern_stdio__echo",
                "modern_stdio__weather_get",
            ]
        );

        // The server that runs its own tools says so, and the one that does not
        // is left for the user to allow.
        let offered_by = |name: &str| -> &ToolOffer {
            offered.tools.iter().find(|tool| tool.name == name).expect(name)
        };
        assert!(offered_by("modern_stdio__echo").auto_run);
        assert!(!offered_by("modern_http__echo").auto_run);
        assert_eq!(offered_by("modern_http__echo").server_name, "modern_http");
        // A tool's title is what it is listed as; one that has none is listed
        // under its own name.
        assert_eq!(offered_by("modern_http__echo").title, "Echo");
        assert_eq!(offered_by("modern_http__weather_get").title, "weather.get");
        assert_eq!(offered_by("modern_http__echo").description, "Echoes the text it is given.");
        assert_eq!(
            offered_by("modern_http__echo").parameters["properties"]["text"]["type"],
            "string"
        );

        // A call on each transport, through the name the request offered.
        let echoed = client.call("modern_http__echo", Some(r#"{"text":"hello"}"#.into())).await.unwrap();
        assert_eq!(echoed.text, "hello");
        assert!(!echoed.is_error);
        // The call is timed, and timed from the ask: the row that shows it in
        // the transcript says how long the server took, so a clock read
        // anywhere else — at start-up, say — would read as a call that took
        // minutes.
        assert!(echoed.ms < 10_000, "a call reports how long it took: {}ms", echoed.ms);
        let echoed = client.call("legacy_http__echo", Some(r#"{"text":"hi"}"#.into())).await.unwrap();
        assert_eq!(echoed.text, "hi");
        let echoed = client.call("modern_stdio__echo", Some(r#"{"text":"yo"}"#.into())).await.unwrap();
        assert_eq!(echoed.text, "yo");
        let echoed = client.call("legacy_stdio__echo", Some(r#"{"text":"oi"}"#.into())).await.unwrap();
        assert_eq!(echoed.text, "oi");
        // The tool whose name needed bringing into an alphabet a function name
        // allows is reachable under that name.
        let weather = client.call("modern_http__weather_get", None).await.unwrap();
        assert_eq!(weather.text, "sunny");

        // A tool that refuses has answered: the failure is the tool's, not the
        // call's, and the model reads what it said.
        let refused = client.call("modern_stdio__boom", None).await.unwrap();
        assert!(refused.is_error);
        assert_eq!(refused.text, "the tool refused");

        // The revision each server agreed on: the modern ones negotiated the
        // stateless revision, the legacy ones the handshake.
        for (server, revision) in [
            (&servers[0], "2026-07-28"),
            (&servers[1], "2025-11-25"),
            (&servers[2], "2026-07-28"),
            (&servers[3], "2025-11-25"),
        ] {
            let report = client.verify(server).await.expect(&server.id);
            assert_eq!(report.protocol, revision, "{}", server.id);
            assert_eq!(report.server_name, "SmokeServer", "{}", server.id);
            assert_eq!(report.server_version, "9.9", "{}", server.id);
            assert_eq!(report.tools.len(), 3, "{}", server.id);
        }

        // A header the server needs, left out, is a server that cannot be
        // reached — rather than one whose tools quietly are not offered.
        let bare = http_server("modern_http", modern_port, None);
        let refused = client.verify(&bare).await;
        assert!(refused.is_err(), "{refused:?}");
    });

    // What a server writes to its own stderr is in the app's log, which is the
    // only place a server that will not start says why.
    let lines = lines.lock().clone();
    assert!(
        lines.iter().any(|line| line.contains("modern_stdio") && line.contains("smoke server up")),
        "{lines:#?}"
    );

    for child in &mut servers_started {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = std::fs::remove_file(&script);
}
