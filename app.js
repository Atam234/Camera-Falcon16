// Falcon Cam — TikTok-style video camera with your own background music,
// an eye-level teleprompter and an eye-contact detector.
//
// Open-source building blocks:
//  - MediaPipe Face Landmarker (google-ai-edge/mediapipe, Apache-2.0) for gaze / eye contact
//  - Web platform APIs: getUserMedia, MediaRecorder, Web Audio, canvas.captureStream,
//    Web Speech API (voice-follow scrolling)

const MP_VERSION = '0.10.14';
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
// Bundled copies (in the APK, see scripts/build-web.mjs) so the detector works offline.
const MP_LOCAL = new URL('./vendor/tasks-vision', location.href).href;
const MP_LOCAL_MODEL = new URL('./vendor/face_landmarker.task', location.href).href;

// Android app (Capacitor): native plugin that saves to the gallery / opens the share sheet.
// registerPlugin comes from vendor/capacitor.js (@capacitor/core), which the build adds to the APK.
const IS_NATIVE = !!window.Capacitor?.isNativePlatform?.();
let NativeGallery = null;
if (IS_NATIVE) {
  try {
    const reg = window.capacitorExports?.registerPlugin || window.Capacitor.registerPlugin;
    NativeGallery = reg('FalconGallery');
  } catch (e) { console.error('FalconGallery plugin unavailable', e); }
}

const OUT_W = 720, OUT_H = 1280, FPS = 30;

const $ = (id) => document.getElementById(id);
const els = {
  cam: $('cam'), canvas: $('recCanvas'), stage: $('stage'),
  startOverlay: $('startOverlay'), startBtn: $('startBtn'), startErr: $('startErr'),
  recBtn: $('recBtn'), pauseBtn: $('pauseBtn'), stopBtn: $('stopBtn'),
  timer: $('timer'), progressBar: $('progressBar'), countdown: $('countdown'), toast: $('toast'),
  musicTag: $('musicTag'), musicTagName: $('musicTagName'),
  prompter: $('prompter'), prompterScroll: $('prompterScroll'), prompterText: $('prompterText'),
  gazeBadge: $('gazeBadge'), gazeText: $('gazeText'),
  result: $('result'), resultVideo: $('resultVideo'), resultStats: $('resultStats'),
  downloadBtn: $('downloadBtn'), shareBtn: $('shareBtn'), retakeBtn: $('retakeBtn'),
  backdrop: $('sheetBackdrop'),
};

// ---------------------------------------------------------------- settings
const store = {
  get(k, d) { try { const v = localStorage.getItem('falcon.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('falcon.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const S = {
  facing: 'user',
  maxDur: store.get('maxDur', 60),
  countdown: store.get('countdown', 3),
  musicVol: store.get('musicVol', 60),
  micVol: store.get('micVol', 100),
  musicStart: 0,
  musicLoop: store.get('musicLoop', true),
  musicMonitor: store.get('musicMonitor', true),
  script: store.get('script', 'Hello mga ka-Falcon! Welcome back sa channel ko.\n\nNgayong araw, pag-uusapan natin kung paano gumawa ng magandang vlog gamit lang ang cellphone.\n\nUna, siguraduhin na maliwanag ang paligid mo.\n\nPangalawa, tumingin ka sa camera habang nagsasalita — kaya nasa itaas ang script, malapit sa lens.\n\nPangatlo, mag-enjoy ka lang! I-like at i-follow para sa susunod na video.'),
  prompterOn: store.get('prompterOn', true),
  speed: store.get('speed', 6),
  fontSize: store.get('fontSize', 26),
  pWidth: store.get('pWidth', 60),
  pLines: store.get('pLines', 4),
  pMirror: store.get('pMirror', false),
  voiceFollow: false,
  voiceLang: store.get('voiceLang', 'fil-PH'),
  eyeOn: false,
  eyeAutoPause: store.get('eyeAutoPause', true),
  sens: store.get('sens', 5),
  calib: store.get('calib', null),
};

// ---------------------------------------------------------------- utils
function showFatal(msg) {
  const el = document.getElementById('startErr');
  if (el && !document.getElementById('startOverlay').classList.contains('hidden')) el.textContent = 'Error: ' + msg;
  else toast('Error: ' + msg, 5000);
}
window.addEventListener('error', (e) => showFatal(e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason?.message || String(e.reason)));

let toastTimer;
function toast(msg, ms = 2200) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- camera + audio graph
let videoStream = null, micStream = null;
let audioCtx, micSource, micGain, musicGain, monitorGain, dest;
const musicEl = new Audio();
musicEl.preload = 'auto';
let musicSource = null, musicUrl = null, musicName = '';

async function startCamera() {
  if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
  videoStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: S.facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: FPS } },
    audio: false,
  });
  els.cam.srcObject = videoStream;
  els.cam.classList.toggle('mirror', S.facing === 'user');
  await els.cam.play().catch(() => {});
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  micSource = audioCtx.createMediaStreamSource(micStream);
  micSource.connect(micGain);
}

function initAudioGraph() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  dest = audioCtx.createMediaStreamDestination();
  micGain = audioCtx.createGain();
  musicGain = audioCtx.createGain();
  monitorGain = audioCtx.createGain();
  micGain.connect(dest);
  musicGain.connect(dest);
  musicGain.connect(monitorGain);
  monitorGain.connect(audioCtx.destination);
  applyGains();
  ensureMusicSource();
}
function ensureMusicSource() {
  if (audioCtx && musicEl.src && !musicSource) {
    musicSource = audioCtx.createMediaElementSource(musicEl);
    musicSource.connect(musicGain);
  }
}
function applyGains() {
  if (!audioCtx) return;
  micGain.gain.value = S.micVol / 100;
  musicGain.gain.value = S.musicVol / 100;
  monitorGain.gain.value = S.musicMonitor ? 1 : 0;
}

els.startBtn.addEventListener('click', async () => {
  els.startErr.textContent = '';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Hindi suportado ng browser na ito ang camera. Buksan sa Chrome/Safari gamit ang https://');
    initAudioGraph();
    await startCamera();
    await startMic();
    els.startOverlay.classList.add('hidden');
    renderPrompter();
    if (S.prompterOn) els.prompter.classList.remove('hidden');
    requestAnimationFrame(tick);
  } catch (e) {
    console.error(e);
    els.startErr.textContent = (e.name === 'NotAllowedError' ? 'Pinayagan mo ba ang camera at mic? ' : '') + (e.message || e);
  }
});

$('flipBtn').addEventListener('click', async () => {
  if (recState !== 'idle') return toast('Hindi puwedeng mag-flip habang nagre-record');
  S.facing = S.facing === 'user' ? 'environment' : 'user';
  try { await startCamera(); } catch (e) { toast('Hindi ma-flip: ' + e.message); }
});

// ---------------------------------------------------------------- music
$('musicFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (musicUrl) URL.revokeObjectURL(musicUrl);
  musicUrl = URL.createObjectURL(f);
  musicName = f.name.replace(/\.[^.]+$/, '');
  musicEl.src = musicUrl;
  ensureMusicSource();
  $('musicPreview').src = musicUrl;
  $('musicPreview').classList.remove('hidden');
  $('musicInfo').textContent = '♪ ' + f.name;
  els.musicTagName.textContent = musicName;
  els.musicTag.classList.remove('hidden');
  $('musicBtn').classList.add('on');
});
$('musicClear').addEventListener('click', () => {
  musicEl.pause(); musicEl.removeAttribute('src'); musicEl.load();
  if (musicUrl) URL.revokeObjectURL(musicUrl);
  musicUrl = null; musicName = '';
  $('musicPreview').pause(); $('musicPreview').classList.add('hidden');
  $('musicInfo').textContent = 'Walang napiling music.';
  els.musicTag.classList.add('hidden');
  $('musicBtn').classList.remove('on');
  $('musicFile').value = '';
});
bindRange('musicVol', 'musicVolLbl', (v) => `${v}%`, applyGains);
bindRange('micVol', 'micVolLbl', (v) => `${v}%`, applyGains);
bindCheck('musicLoop', () => { musicEl.loop = S.musicLoop; });
bindCheck('musicMonitor', applyGains);
$('musicStart').addEventListener('input', (e) => { S.musicStart = Math.max(0, +e.target.value || 0); });
$('musicPreview').addEventListener('pause', (e) => { if (e.target.currentTime) $('musicStart').value = S.musicStart = Math.round(e.target.currentTime * 2) / 2; });
musicEl.loop = S.musicLoop;

// ---------------------------------------------------------------- generic UI bindings
function bindRange(id, lblId, fmtFn, onChange) {
  const el = $(id);
  el.value = S[id];
  if (lblId) $(lblId).textContent = fmtFn(S[id]);
  el.addEventListener('input', () => {
    S[id] = +el.value; store.set(id, S[id]);
    if (lblId) $(lblId).textContent = fmtFn(S[id]);
    onChange && onChange();
  });
}
function bindCheck(id, onChange) {
  const el = $(id);
  el.checked = !!S[id];
  el.addEventListener('change', () => { S[id] = el.checked; store.set(id, S[id]); onChange && onChange(); });
}

const sheets = { musicBtn: 'musicSheet', scriptBtn: 'scriptSheet', eyeBtn: 'eyeSheet' };
let openSheet = null;
for (const [btn, sheet] of Object.entries(sheets)) {
  $(btn).addEventListener('click', () => {
    if (recState === 'recording') return toast('I-pause muna ang recording');
    closeSheet(); openSheet = $(sheet);
    openSheet.classList.remove('hidden'); els.backdrop.classList.remove('hidden');
  });
}
function closeSheet() {
  if (!openSheet) return;
  if (openSheet.id === 'scriptSheet') renderPrompter();
  if (openSheet.id === 'musicSheet') $('musicPreview').pause();
  openSheet.classList.add('hidden'); els.backdrop.classList.add('hidden'); openSheet = null;
}
els.backdrop.addEventListener('click', closeSheet);
document.querySelectorAll('.sheet .close').forEach((b) => b.addEventListener('click', closeSheet));

document.querySelectorAll('#durations button').forEach((b) => {
  b.classList.toggle('active', +b.dataset.dur === S.maxDur);
  b.addEventListener('click', () => {
    if (recState !== 'idle') return;
    S.maxDur = +b.dataset.dur; store.set('maxDur', S.maxDur);
    document.querySelectorAll('#durations button').forEach((x) => x.classList.toggle('active', x === b));
  });
});
const CD_OPTS = [0, 3, 10];
const updCdLbl = () => { $('timerBtnLbl').textContent = S.countdown ? `${S.countdown}s` : 'Off'; };
updCdLbl();
$('timerBtn').addEventListener('click', () => {
  S.countdown = CD_OPTS[(CD_OPTS.indexOf(S.countdown) + 1) % CD_OPTS.length];
  store.set('countdown', S.countdown); updCdLbl(); toast(`Countdown: ${S.countdown ? S.countdown + ' segundo' : 'off'}`);
});

// ---------------------------------------------------------------- teleprompter
const P = { y: 0, playing: false, userPaused: false, gazePaused: false, words: [], spans: [], matched: -1, targetY: null };

$('scriptInput').value = S.script;
$('scriptInput').addEventListener('input', (e) => { S.script = e.target.value; store.set('script', S.script); });
$('scriptFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  S.script = await f.text(); $('scriptInput').value = S.script; store.set('script', S.script);
  toast('Na-load ang script');
});
bindCheck('prompterOn');
bindRange('speed', 'speedLbl', (v) => v);
bindRange('fontSize', 'fontLbl', (v) => `${v}px`, applyPrompterStyle);
bindRange('pWidth', 'widthLbl', (v) => `${v}%`, applyPrompterStyle);
bindRange('pLines', 'linesLbl', (v) => v, applyPrompterStyle);
bindCheck('pMirror', applyPrompterStyle);
$('voiceLang').value = S.voiceLang;
$('voiceLang').addEventListener('change', (e) => { S.voiceLang = e.target.value; store.set('voiceLang', S.voiceLang); if (S.voiceFollow) { stopVoice(); startVoice(); } });
$('voiceFollow').addEventListener('change', (e) => {
  S.voiceFollow = e.target.checked;
  if (S.voiceFollow) startVoice(); else stopVoice();
});

function applyPrompterStyle() {
  els.prompter.style.setProperty('--fs', S.fontSize + 'px');
  els.prompter.style.setProperty('--lines', S.pLines);
  els.prompter.style.width = S.pWidth + '%';
  els.prompterScroll.style.transform = S.pMirror ? 'scaleX(-1)' : '';
  layoutPrompter();
}
const lineH = () => S.fontSize * 1.35;

function renderPrompter() {
  const box = els.prompterText;
  box.textContent = '';
  P.words = []; P.spans = []; P.matched = -1;
  const parts = S.script.split(/(\s+)/);
  for (const part of parts) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { box.appendChild(document.createTextNode(part)); continue; }
    const sp = document.createElement('span');
    sp.className = 'w'; sp.textContent = part;
    box.appendChild(sp);
    P.spans.push(sp); P.words.push(norm(part));
  }
  applyPrompterStyle();
}
function layoutPrompter() {
  els.prompterText.style.transform = `translateY(${lineH() + 8 - P.y}px)`;
}
function maxY() { return Math.max(0, els.prompterText.scrollHeight - lineH()); }
function prompterActive() {
  return P.playing && !P.userPaused && !P.gazePaused && !S.voiceFollow;
}
function setUserPaused(v) {
  P.userPaused = v;
  els.prompter.classList.toggle('paused', v);
}

// touch / mouse: tap = play/pause, drag = scroll
let drag = null;
els.prompter.addEventListener('pointerdown', (e) => {
  drag = { y0: e.clientY, py: P.y, moved: false };
  els.prompter.setPointerCapture(e.pointerId);
});
els.prompter.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y0;
  if (Math.abs(dy) > 5) drag.moved = true;
  if (drag.moved) { P.y = Math.min(maxY(), Math.max(0, drag.py - dy)); P.targetY = null; layoutPrompter(); }
});
els.prompter.addEventListener('pointerup', () => {
  if (drag && !drag.moved) {
    if (!P.playing) { P.playing = true; setUserPaused(false); }
    else setUserPaused(!P.userPaused);
  }
  drag = null;
});
els.prompter.addEventListener('wheel', (e) => {
  e.preventDefault(); P.y = Math.min(maxY(), Math.max(0, P.y + e.deltaY * 0.5)); layoutPrompter();
}, { passive: false });

// ---- voice-follow (Web Speech API)
function norm(w) { return w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, ''); }
let recog = null, voiceWanted = false;
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Walang speech recognition sa browser na ito (subukan ang Chrome)'); $('voiceFollow').checked = S.voiceFollow = false; return; }
  voiceWanted = true;
  recog = new SR();
  recog.lang = S.voiceLang; recog.continuous = true; recog.interimResults = true;
  recog.onresult = (ev) => {
    const res = ev.results[ev.results.length - 1];
    const heard = res[0].transcript.split(/\s+/).map(norm).filter(Boolean).slice(-5);
    followWords(heard);
  };
  recog.onend = () => { if (voiceWanted) { try { recog.start(); } catch { /* restarting */ } } };
  recog.onerror = (e) => { if (e.error === 'not-allowed') { voiceWanted = false; toast('Hindi pinayagan ang voice-follow'); } };
  try { recog.start(); toast('Voice-follow ON — basahin lang ang script'); } catch (e) { console.warn(e); }
}
function stopVoice() { voiceWanted = false; if (recog) { try { recog.stop(); } catch { /* */ } recog = null; } }

function followWords(heard) {
  if (!heard.length || !P.words.length) return;
  const W = P.words, start = P.matched;
  let best = -1;
  for (let k = 0; k < heard.length; k++) {
    for (let j = start + 1; j < Math.min(W.length, start + 20); j++) {
      const bigram = k > 0 && j > 0 && W[j] === heard[k] && W[j - 1] === heard[k - 1];
      const longWord = W[j] === heard[k] && heard[k].length >= 5 && j - start <= 6;
      if (bigram || longWord) { best = Math.max(best, j); break; }
    }
  }
  if (best > P.matched) {
    for (let i = Math.max(0, P.matched); i <= best; i++) P.spans[i].classList.add('done');
    P.spans[P.matched]?.classList.remove('cur');
    P.matched = best;
    P.spans[best].classList.add('cur');
    P.targetY = Math.min(maxY(), P.spans[best].offsetTop); // put the spoken line on the reading line
  }
}
function resetPrompter() {
  P.y = 0; P.matched = -1; P.targetY = null;
  P.spans.forEach((s) => s.classList.remove('done', 'cur'));
  layoutPrompter();
}

// ---------------------------------------------------------------- eye contact (MediaPipe)
const G = { landmarker: null, loading: false, last: 0, h: 0, v: 0, yaw: 0, pitch: 0, ok: null, badSince: 0, calibSamples: null, okFrames: 0, totFrames: 0 };
bindCheck('eyeAutoPause');
bindRange('sens', 'sensLbl', (v) => v);
$('eyeOn').addEventListener('change', async (e) => {
  S.eyeOn = e.target.checked;
  $('eyeBtn').classList.toggle('on', S.eyeOn);
  els.gazeBadge.classList.toggle('hidden', !S.eyeOn);
  if (S.eyeOn) await loadLandmarker();
  else { P.gazePaused = false; }
});
$('calibBtn').addEventListener('click', async () => {
  if (!S.eyeOn) { $('eyeOn').checked = true; $('eyeOn').dispatchEvent(new Event('change')); }
  await loadLandmarker();
  if (!G.landmarker) return;
  G.calibSamples = [];
  $('eyeStatus').textContent = 'Tumingin sa camera lens…';
  await sleep(2000);
  const s = G.calibSamples; G.calibSamples = null;
  if (!s || s.length < 5) { $('eyeStatus').textContent = 'Hindi makita ang mukha. Subukan ulit sa maliwanag na lugar.'; return; }
  const avg = (k) => s.reduce((a, x) => a + x[k], 0) / s.length;
  S.calib = { h: avg('h'), v: avg('v'), yaw: avg('yaw'), pitch: avg('pitch') };
  store.set('calib', S.calib);
  $('eyeStatus').textContent = 'Calibrated ✓';
});

async function loadLandmarker() {
  if (G.landmarker || G.loading) return;
  G.loading = true;
  $('eyeStatus').textContent = 'Nilo-load ang face model (≈4 MB)…';
  els.gazeText.textContent = 'Loading…';
  try {
    let mod, base = MP_LOCAL, model = MP_LOCAL_MODEL;
    try { mod = await import(`${MP_LOCAL}/vision_bundle.mjs`); }
    catch { base = MP_CDN; model = MP_CDN_MODEL; mod = await import(`${MP_CDN}/vision_bundle.mjs`); }
    const { FaceLandmarker, FilesetResolver } = mod;
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    try { G.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { G.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
    $('eyeStatus').textContent = S.calib ? 'Handa na ✓ (may calibration)' : 'Handa na ✓ — i-calibrate para mas tumpak';
  } catch (e) {
    console.error(e);
    $('eyeStatus').textContent = 'Hindi ma-load ang face model: ' + e.message;
    els.gazeText.textContent = 'Error';
  }
  G.loading = false;
}

function detectGaze(now) {
  if (!G.landmarker || els.cam.readyState < 2 || now - G.last < 90) return;
  G.last = now;
  let r;
  try { r = G.landmarker.detectForVideo(els.cam, now); } catch { return; }
  if (!r.faceBlendshapes?.length) { setGaze(null); return; }
  const b = {};
  for (const c of r.faceBlendshapes[0].categories) b[c.categoryName] = c.score;
  // Positive h = eyes turned to the subject's left, positive v = looking up.
  const h = ((b.eyeLookOutLeft + b.eyeLookInRight) - (b.eyeLookInLeft + b.eyeLookOutRight)) / 2;
  const v = ((b.eyeLookUpLeft + b.eyeLookUpRight) - (b.eyeLookDownLeft + b.eyeLookDownRight)) / 2;
  let yaw = 0, pitch = 0;
  const m = r.facialTransformationMatrixes?.[0]?.data;
  if (m) {
    pitch = Math.atan2(m[6], m[10]) * 180 / Math.PI;
    yaw = Math.atan2(-m[2], Math.hypot(m[6], m[10])) * 180 / Math.PI;
  }
  const a = 0.5; // smoothing
  G.h = G.h * (1 - a) + h * a; G.v = G.v * (1 - a) + v * a;
  G.yaw = G.yaw * (1 - a) + yaw * a; G.pitch = G.pitch * (1 - a) + pitch * a;
  if (G.calibSamples) G.calibSamples.push({ h, v, yaw, pitch });
  const c = S.calib || { h: 0, v: 0, yaw: 0, pitch: 0 };
  const k = 1.6 - S.sens * 0.12; // sens 1 → lenient, 10 → strict
  const dev = Math.max(
    Math.abs(G.h - c.h) / (0.32 * k),
    Math.abs(G.v - c.v) / (0.30 * k),
    Math.abs(G.yaw - c.yaw) / (22 * k),
    Math.abs(G.pitch - c.pitch) / (18 * k),
  );
  setGaze(dev < 1);
}

function setGaze(ok) {
  G.ok = ok;
  els.gazeBadge.classList.toggle('ok', ok === true);
  els.gazeBadge.classList.toggle('bad', ok !== true);
  els.gazeText.textContent = ok === null ? 'Walang mukha' : ok ? 'Eye contact ✓' : 'Tumingin sa camera ▲';
  if (recState === 'recording') { G.totFrames++; if (ok) G.okFrames++; }
  const now = performance.now();
  if (ok) { G.badSince = 0; P.gazePaused = false; }
  else {
    if (!G.badSince) G.badSince = now;
    P.gazePaused = S.eyeAutoPause && now - G.badSince > 700;
  }
}

// ---------------------------------------------------------------- recording
let recState = 'idle'; // idle | countdown | recording | paused
let recorder = null, chunks = [], recMime = '', elapsed = 0, lastT = 0, wakeLock = null;
const ctx2d = els.canvas.getContext('2d');
els.canvas.width = OUT_W; els.canvas.height = OUT_H;

function pickMime() {
  // H.264 MP4 first (best for TikTok / FB / IG uploads), then any MP4, then WebM.
  const opts = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,opus',
    'video/mp4;codecs=avc3.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opts.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

function drawFrame() {
  const v = els.cam;
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw) return;
  // object-fit: cover crop into 9:16, mirrored like the preview for the front camera
  const scale = Math.max(OUT_W / vw, OUT_H / vh);
  const dw = vw * scale, dh = vh * scale;
  ctx2d.save();
  if (S.facing === 'user') { ctx2d.translate(OUT_W, 0); ctx2d.scale(-1, 1); }
  ctx2d.drawImage(v, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
  ctx2d.restore();
}

async function beginRecording() {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  closeSheet();
  if (S.countdown) {
    recState = 'countdown';
    els.countdown.classList.remove('hidden');
    for (let i = S.countdown; i > 0; i--) {
      els.countdown.textContent = i;
      await sleep(1000);
      if (recState !== 'countdown') { els.countdown.classList.add('hidden'); return; }
    }
    els.countdown.classList.add('hidden');
  }
  drawFrame();
  const vTrack = els.canvas.captureStream(FPS).getVideoTracks()[0];
  const mixed = new MediaStream([vTrack, ...dest.stream.getAudioTracks()]);
  recMime = pickMime();
  try {
    recorder = new MediaRecorder(mixed, { mimeType: recMime || undefined, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
  } catch {
    recorder = new MediaRecorder(mixed);
  }
  recMime = recorder.mimeType || recMime || 'video/webm';
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  recorder.onstop = finishRecording;
  recorder.start(1000);

  if (musicEl.src) {
    musicEl.currentTime = S.musicStart; musicEl.loop = S.musicLoop;
    musicEl.play().catch((e) => toast('Hindi ma-play ang music: ' + e.message));
  }
  elapsed = 0; lastT = performance.now();
  G.okFrames = G.totFrames = 0;
  resetPrompter();
  P.playing = true; setUserPaused(false);
  recState = 'recording';
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  updateRecUI();
}

function pauseRecording() {
  if (recState === 'recording') {
    recorder.pause(); musicEl.pause(); recState = 'paused'; setUserPaused(true);
  } else if (recState === 'paused') {
    recorder.resume(); if (musicEl.src) musicEl.play().catch(() => {});
    lastT = performance.now(); recState = 'recording'; setUserPaused(false);
  }
  updateRecUI();
}

function stopRecording() {
  if (recState === 'countdown') { recState = 'idle'; updateRecUI(); return; }
  if (!recorder || recState === 'idle') return;
  recState = 'idle';
  musicEl.pause();
  P.playing = false;
  recorder.stop();
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
  updateRecUI();
}

let resultUrl = null, resultBlob = null;
function finishRecording() {
  const type = recMime.split(';')[0];
  resultBlob = new Blob(chunks, { type });
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(resultBlob);
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const name = `falcon-cam-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  els.resultVideo.src = resultUrl;
  els.downloadBtn.href = resultUrl;
  els.downloadBtn.download = name;
  const mb = (resultBlob.size / 1048576).toFixed(1);
  const eye = G.totFrames ? ` · Eye contact: ${Math.round((G.okFrames / G.totFrames) * 100)}%` : '';
  els.resultStats.textContent = `${fmt(elapsed)} · ${mb} MB · ${ext.toUpperCase()}${eye}`;
  if (IS_NATIVE) {
    // Hand the video to the Android side right away; Save/Share wait for it.
    nativeReady = sendToNative(resultBlob, name, type);
    els.shareBtn.classList.remove('hidden');
    els.shareBtn.onclick = async () => {
      try { await nativeReady; await NativeGallery.share(); } catch (e) { toast('Hindi ma-share: ' + (e.message || e)); }
    };
  } else {
    const file = new File([resultBlob], name, { type });
    els.shareBtn.classList.toggle('hidden', !(navigator.canShare && navigator.canShare({ files: [file] })));
    els.shareBtn.onclick = () => navigator.share({ files: [file], title: 'Falcon Cam video' }).catch(() => {});
  }
  els.result.classList.remove('hidden');
}

let nativeReady = null;
const blobToBase64 = (b) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});
async function sendToNative(blob, name, mime) {
  await NativeGallery.begin({ name, mime });
  const CHUNK = 768 * 1024;
  for (let i = 0; i < blob.size; i += CHUNK) {
    await NativeGallery.append({ data: await blobToBase64(blob.slice(i, i + CHUNK)) });
  }
  await NativeGallery.end();
}
els.downloadBtn.addEventListener('click', async (e) => {
  if (!IS_NATIVE) return; // browsers use the normal download link
  e.preventDefault();
  const label = els.downloadBtn.textContent;
  els.downloadBtn.textContent = 'Sine-save…';
  try {
    await nativeReady;
    const r = await NativeGallery.save();
    toast('Na-save sa Gallery ✓ (' + (r.path || 'Movies/FalconCam') + ')', 3500);
  } catch (err) {
    toast('Hindi na-save: ' + (err.message || err), 4000);
  }
  els.downloadBtn.textContent = label;
});
els.retakeBtn.addEventListener('click', () => {
  els.resultVideo.pause(); els.result.classList.add('hidden');
  resetPrompter(); P.playing = false; updateRecUI();
});

els.recBtn.addEventListener('click', () => {
  if (!videoStream) return;
  if (recState === 'idle') beginRecording();
  else stopRecording();
});
els.pauseBtn.addEventListener('click', pauseRecording);
els.stopBtn.addEventListener('click', stopRecording);

function updateRecUI() {
  const active = recState === 'recording' || recState === 'paused';
  els.recBtn.classList.toggle('rec', recState === 'recording' || recState === 'countdown');
  els.pauseBtn.classList.toggle('hidden', !active);
  els.stopBtn.classList.toggle('hidden', !active);
  els.pauseBtn.textContent = recState === 'paused' ? '●' : '❚❚';
  els.timer.classList.toggle('rec', recState === 'recording');
  document.getElementById('durations').style.visibility = recState === 'idle' ? 'visible' : 'hidden';
  if (recState === 'idle' && !active) { els.timer.textContent = '00:00'; els.progressBar.style.width = '0'; }
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('textarea, input, select')) return;
  if (e.code === 'Space' && videoStream && els.result.classList.contains('hidden')) { e.preventDefault(); if (recState === 'idle') beginRecording(); else if (recState !== 'countdown') pauseRecording(); }
  if (e.key === 'Escape') { recState === 'idle' ? closeSheet() : stopRecording(); }
});

// ---------------------------------------------------------------- main loop
let prevT = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - prevT) / 1000); prevT = now;

  if (S.eyeOn) detectGaze(now);

  if (recState === 'recording') {
    drawFrame();
    elapsed += (now - lastT) / 1000; lastT = now;
    els.timer.textContent = fmt(elapsed);
    els.progressBar.style.width = Math.min(100, (elapsed / S.maxDur) * 100) + '%';
    if (elapsed >= S.maxDur) stopRecording();
  }

  // teleprompter motion
  if (P.targetY !== null) {
    P.y += (P.targetY - P.y) * Math.min(1, dt * 6);
    if (Math.abs(P.targetY - P.y) < 0.5) P.targetY = null;
    layoutPrompter();
  } else if (prompterActive()) {
    P.y = Math.min(maxY(), P.y + S.speed * lineH() * 0.08 * dt);
    layoutPrompter();
  }
  els.prompter.classList.toggle('hidden', !S.prompterOn);

  requestAnimationFrame(tick);
}

// apply persisted prompter look before camera opens
renderPrompter();
