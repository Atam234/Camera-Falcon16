// Copies the web app into www/ for Capacitor and bundles MediaPipe + the face model,
// so the eye-contact detector works offline inside the APK.
import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'www');
const vendor = path.join(www, 'vendor');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const modelCache = path.join(root, 'node_modules', '.cache', 'face_landmarker.task');

await rm(www, { recursive: true, force: true });
await mkdir(vendor, { recursive: true });
for (const f of ['index.html', 'style.css', 'app.js']) await cp(path.join(root, f), path.join(www, f));

const mp = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision');
await cp(path.join(mp, 'vision_bundle.mjs'), path.join(vendor, 'tasks-vision', 'vision_bundle.mjs'));
await cp(path.join(mp, 'wasm'), path.join(vendor, 'tasks-vision', 'wasm'), { recursive: true });

try { await access(modelCache); } catch {
  console.log('Downloading face model…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  await mkdir(path.dirname(modelCache), { recursive: true });
  await writeFile(modelCache, Buffer.from(await res.arrayBuffer()));
}
await cp(modelCache, path.join(vendor, 'face_landmarker.task'));
console.log('www/ ready');
