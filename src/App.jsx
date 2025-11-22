import ImageStream30 from "./components/ImageStream30.jsx";
import AudioToImage from "./components/AudioToImage.jsx";

export default function App() {
  return (
    <div className="app">
      <h1>Realtime AI Client</h1>

      <section className="card">
        <h2>A — Images (30 FPS) ➜ Text</h2>
        <p className="muted">
          Sends 30 FPS compressed images over WebSocket A. Server returns small
          JSON <code>delta</code> chunks rendered as a typing effect.
        </p>
        <ImageStream30 />
      </section>

      <section className="card">
        <h2>B — Audio (20ms chunks) ➜ Image</h2>
        <p className="muted">
          Streams ~20ms PCM chunks over WebSocket B. Server returns images that
          render instantly.
        </p>
        <AudioToImage />
      </section>
    </div>
  );
}
