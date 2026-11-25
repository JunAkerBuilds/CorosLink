// clink-ble: C-LINK's Bluetooth helper for COROS watches on macOS, Windows and Linux.
//
// The app starts it and talks JSON lines: one request per line on stdin ({"id", "operation", …}), one answer per
// line on stdout ({"id", "result"} or {"id", "error", "detail"}), plus unasked {"event": …} lines. It speaks exactly
// what CorosLink's helpers speak (native/corebluetooth/main.swift on macOS, scripts/coros-system-ble.py elsewhere),
// so the app's TypeScript is the same on every platform. Requests run one at a time; at most 32 wait.
mod protocol;
mod worker;

use std::io::Read;

use serde_json::{json, Value};
use tokio::sync::mpsc;

fn main() {
    if std::env::args().any(|a| a == "--version") {
        println!("clink-ble {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    // Two threads: notifications are drained into the worker's queue on one while a request waits on the other.
    let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("tokio runtime");
    runtime.block_on(run());
}

async fn run() {
    let (requests, mut incoming) = mpsc::channel::<Value>(32);
    // stdin on its own thread, bounded: a line over 32 KB means the parent is broken, so stop.
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        let mut buffer: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let n = match stdin.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            buffer.extend_from_slice(&chunk[..n]);
            if buffer.len() > 32_768 {
                std::process::exit(1);
            }
            while let Some(newline) = buffer.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=newline).collect();
                if let Ok(value @ Value::Object(_)) = serde_json::from_slice::<Value>(&line[..line.len() - 1]) {
                    // A full queue drops the request, like the Swift helper; the app times it out.
                    let _ = requests.try_send(value);
                }
            }
        }
        // Dropping the sender tells the worker stdin is closed; between requests it disconnects and exits. If a
        // request is still running, the app has gone: exit anyway (the system drops the Bluetooth link).
        drop(requests);
        std::thread::sleep(std::time::Duration::from_secs(1));
        std::process::exit(0);
    });

    let mut worker = worker::Worker::new();
    worker::emit(&json!({ "ready": true }));
    loop {
        tokio::select! {
            request = incoming.recv() => match request {
                Some(request) => {
                    worker.set_queued(incoming.len());
                    worker.handle(request).await;
                }
                None => {
                    worker.shutdown().await;
                    std::process::exit(0);
                }
            },
            _ = worker.idle() => {}
        }
    }
}
