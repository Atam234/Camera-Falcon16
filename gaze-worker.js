// Runs MediaPipe Face Landmarker off the main thread so the camera stays smooth.
// Classic worker: MediaPipe's loader uses importScripts(), which module workers lack.
/* global importScripts */
var exports = {}; // the CommonJS bundle writes its exports here
let landmarker = null;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      importScripts(m.bundle);
      const fileset = await exports.FilesetResolver.forVisionTasks(m.wasm);
      landmarker = await exports.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: m.model, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', msg: String((err && err.message) || err) });
    }
  } else if (m.type === 'frame') {
    let bs = null, mat = null;
    try {
      const r = landmarker.detectForVideo(m.bitmap, m.ts);
      if (r.faceBlendshapes && r.faceBlendshapes.length) {
        bs = {};
        for (const c of r.faceBlendshapes[0].categories) bs[c.categoryName] = c.score;
        const t = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0];
        if (t) mat = Array.from(t.data);
      }
    } catch (err) { /* skip this frame */ }
    m.bitmap.close();
    self.postMessage({ type: 'result', bs, mat });
  }
};
