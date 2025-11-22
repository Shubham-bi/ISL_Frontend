// src/components/ImageStream30.jsx
import { useEffect, useRef, useState } from "react";

const VIDEO_WS_URL = import.meta.env.VITE_VIDEO_WS_URL;

export default function ImageStream30() {
  // UI state
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [capturing, setCapturing] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [typed, setTyped] = useState("");

  // refs
  const videoRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const stopFlagRef = useRef(false);

  // typing buffer
  const pendingRef = useRef("");
  const typerRef = useRef(null);

  useEffect(() => {
    // typewriter at ~60Hz
    typerRef.current = setInterval(() => {
      const buf = pendingRef.current;
      if (!buf) return;
      const take = Math.min(3, buf.length);
      setTyped((t) => t + buf.slice(0, take));
      pendingRef.current = buf.slice(take);
    }, 16);

    return () => {
      clearInterval(typerRef.current);
      stopCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectWS = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(VIDEO_WS_URL);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        setWsStatus("connected");
        resolve(ws);
      };
      ws.onclose = () => setWsStatus("disconnected");
      ws.onerror = (e) => {
        setWsStatus("error");
        reject(e);
      };
      ws.onmessage = (e) => {
        try {
          const raw = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
          const msg = JSON.parse(raw);
          if (msg.delta) pendingRef.current += msg.delta;
        } catch {
          /* ignore non-JSON */
        }
      };
    });

  async function startCapture() {
    if (capturing) return;
    setTyped(""); // optional: clear previous text
    stopFlagRef.current = false;

    // 1) open WS
    const ws = await connectWS();
    wsRef.current = ws;

    // 2) get camera stream
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
    streamRef.current = stream;

    // honor cameraOn toggle
    const track = stream.getVideoTracks()[0];
    track.enabled = cameraOn;

    // bind preview
    const v = videoRef.current;
    v.srcObject = stream;
    await v.play();

    // 3) setup encoder pipeline
    const w = 1280, h = 720, quality = 0.6;
    const processor = new window.MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();
    readerRef.current = reader;

    const offscreen = new OffscreenCanvas(w, h);
    const ctx = offscreen.getContext("2d", { desynchronized: true, alpha: false });
    const hasImageEncoder = "ImageEncoder" in window;

    async function encodeWebP(frame) {
      if (hasImageEncoder) {
        const enc = new ImageEncoder({ type: "image/webp", quality, width: w, height: h });
        const { encoded } = await enc.encode(frame);
        const size = encoded.allocationSize();
        const buf = new ArrayBuffer(size);
        await encoded.copyTo(buf);
        return new Uint8Array(buf);
      }
      ctx.drawImage(frame, 0, 0, w, h);
      const blob = await offscreen.convertToBlob({ type: "image/webp", quality });
      return new Uint8Array(await blob.arrayBuffer());
    }

    setCapturing(true);
    let seq = 0;

    // 4) pumping loop
    (async function pump() {
      while (!stopFlagRef.current) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;

        // if camera is toggled off, just drop frames until it's back on
        if (!cameraOn) {
          frame.close();
          continue;
        }

        // backpressure: drop frames if WS congested
        const ok =
          wsRef.current &&
          wsRef.current.readyState === 1 &&
          wsRef.current.bufferedAmount < 2_000_000;
        if (!ok) {
          frame.close();
          continue;
        }

        const payload = await encodeWebP(frame);
        frame.close();

        // Build header: [1 byte type][4 bytes seq][8 bytes timestamp]
        const header = new ArrayBuffer(13);
        const dv = new DataView(header);
        dv.setUint8(0, 0x11);
        dv.setUint32(1, seq >>> 0);
        dv.setBigUint64(5, BigInt(Date.now()));

        const out = new Uint8Array(header.byteLength + payload.byteLength);
        out.set(new Uint8Array(header), 0);
        out.set(payload, header.byteLength);

        wsRef.current.send(out.buffer);
        seq++;
      }
      // finished
      setCapturing(false);
      // reader auto-closed by loop end
    })().catch((e) => {
      console.error("pump error", e);
      setCapturing(false);
    });
  }

  function stopCapture() {
    stopFlagRef.current = true;

    // close reader
    try {
      readerRef.current?.cancel();
    } catch {}

    // stop camera tracks
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // close WS
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;

    setCapturing(false);
  }

  function toggleCamera() {
    setCameraOn((prev) => {
      const now = !prev;
      const stream = streamRef.current;
      if (stream) {
        const track = stream.getVideoTracks()[0];
        if (track) track.enabled = now;
      }
      return now;
    });
  }

  const resetTyped = () => {
    setTyped("");
    pendingRef.current = "";
  };

  return (
    <div className="row">
      <div>
        <div className="badge">WS(video): {wsStatus}</div>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!capturing ? (
            <button onClick={startCapture}>Start Capturing</button>
          ) : (
            <button onClick={stopCapture}>Stop Capturing</button>
          )}
          <button onClick={toggleCamera}>{cameraOn ? "Camera Off" : "Camera On"}</button>
          <button onClick={resetTyped}>Clear Text</button>
        </div>

        <div style={{ marginTop: 8 }}>
          <video
            className="video"
            ref={videoRef}
            autoPlay
            playsInline
            muted
            width={640}
            height={360}
          />
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 280 }}>
        <div className="badge">Server text (typing)</div>
        <div className="terminal" style={{ marginTop: 8 }}>
          {typed}
          <span className="caret">▎</span>
        </div>
      </div>
    </div>
  );
}
