import { useEffect, useRef, useState } from "react";

const AUDIO_WS_URL = import.meta.env.VITE_AUDIO_WS_URL;

function floatTo16PCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return new Uint8Array(out.buffer);
}

export default function AudioToImage() {
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [streaming, setStreaming] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [imgURL, setImgURL] = useState(null);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const procRef = useRef(null);
  const sourceRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const stopFlagRef = useRef(false);

  useEffect(() => {
    return () => {
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectWS = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(AUDIO_WS_URL);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => { setWsStatus("connected"); resolve(ws); };
      ws.onclose = () => setWsStatus("disconnected");
      ws.onerror = (e) => { setWsStatus("error"); reject(e); };
      ws.onmessage = (e) => {
        const buf = new Uint8Array(e.data);
        if (buf.length < 13) return;
        if (buf[0] !== 0x42) return; // server image
        const payload = buf.slice(13);
        const blob = new Blob([payload], { type: "image/webp" });
        const url = URL.createObjectURL(blob);
        setImgURL((old) => { if (old) URL.revokeObjectURL(old); return url; });
      };
    });

  async function startAudio() {
    if (streaming) return;
    stopFlagRef.current = false;

    const ws = await connectWS();
    wsRef.current = ws;

    // 16k mono
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    mediaStreamRef.current = mediaStream;

    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    audioCtxRef.current = ctx;

    const src = ctx.createMediaStreamSource(mediaStream);
    sourceRef.current = src;

    const proc = ctx.createScriptProcessor(1024, 1, 1);
    procRef.current = proc;

    src.connect(proc);
    proc.connect(ctx.destination); // keeps processor alive (silent output)

    let seq = 0;
    proc.onaudioprocess = (ev) => {
      if (stopFlagRef.current) return;
      if (!wsRef.current || wsRef.current.readyState !== 1) return;

      // respect mic toggle
      if (!micOn) return;

      const input = ev.inputBuffer.getChannelData(0);
      const payload = floatTo16PCM(input);

      const header = new ArrayBuffer(13);
      const dv = new DataView(header);
      dv.setUint8(0, 0x21);
      dv.setUint32(1, seq >>> 0);
      dv.setBigUint64(5, BigInt(Date.now()));

      const out = new Uint8Array(header.byteLength + payload.byteLength);
      out.set(new Uint8Array(header), 0);
      out.set(payload, header.byteLength);

      if (wsRef.current.bufferedAmount < 256_000) {
        wsRef.current.send(out.buffer);
        seq++;
      }
    };

    setStreaming(true);
  }

  function stopAudio() {
    stopFlagRef.current = true;

    try { procRef.current?.disconnect(); } catch {}
    try { sourceRef.current?.disconnect(); } catch {}
    try { audioCtxRef.current?.close(); } catch {}

    const ms = mediaStreamRef.current;
    if (ms) {
      ms.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }

    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    setStreaming(false);
  }

  function toggleMic() {
    setMicOn((prev) => {
      const now = !prev;
      const ms = mediaStreamRef.current;
      if (ms) {
        const at = ms.getAudioTracks()[0];
        if (at) at.enabled = now; // hardware mute/unmute
      }
      return now;
    });
  }

  return (
    <div className="row">
      <div style={{ minWidth: 280 }}>
        <div className="badge">WS(audio): {wsStatus}</div>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!streaming ? (
            <button onClick={startAudio}>Start Streaming</button>
          ) : (
            <button onClick={stopAudio}>Stop Streaming</button>
          )}
          <button onClick={toggleMic}>{micOn ? "Mic Off" : "Mic On"}</button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Streams ~20ms PCM chunks. Server returns images below.
        </p>
      </div>

      <div>
        {imgURL ? (
          <img className="img" src={imgURL} alt="AI" />
        ) : (
          <div className="terminal" style={{ width: 340, height: 200 }}>
            Waiting for server image…
          </div>
        )}
      </div>
    </div>
  );
}
