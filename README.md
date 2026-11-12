# Falcon Cam 🎥

Video camera para sa mga vlogger, parang TikTok: patayong 9:16 na video, background music galing sa **sarili mong file**, at teleprompter na nakatulong para **nakatingin ka sa camera** habang nagbabasa ng script.

Web app ito (HTML/CSS/JS lang, walang server). Gumagana sa Chrome/Edge (Android at PC) at Safari (iPhone).

## Mga feature

| Feature | Paliwanag |
|---|---|
| 🎬 **Video recording lang** | 720×1280 (9:16) na video. MP4 kung kaya ng browser, WebM kung hindi. Pwedeng i-pause at ituloy. |
| ⏱ **Haba** | 15s / 60s / 3m / 10m. Kusang titigil pag naabot na. May 3s o 10s na countdown. |
| ♪ **Background music mula sa file mo** | Pumili ng mp3/m4a/wav sa phone o PC mo. Naka-mix ang music at boses mo sa video. Pwedeng i-adjust ang lakas ng music at mic, kung saang segundo magsisimula ang kanta, at kung naka-loop. |
| 📜 **Eye-level teleprompter** | Ang script ay nasa **pinakaitaas ng screen, katapat ng camera lens**, at makitid ang kahon kaya halos hindi gumagalaw ang mata mo. Hindi ito kasama sa recording. Pwedeng i-adjust ang bilis, laki ng letra, lapad, ilang linya, at pwedeng i-mirror. I-tap para i-pause, i-drag para i-scroll. |
| 🗣 **Voice-follow** (experimental) | Sumusunod ang script sa boses mo, kaya hindi ka maiiwan o mauunahan ng scroll. Filipino o English. Sa Chrome lang. |
| 👁 **Eye contact detector** | Gumagamit ng [MediaPipe Face Landmarker](https://github.com/google-ai-edge/mediapipe) para malaman kung nakatingin ka sa lens. **Berde** = eye contact ✓, **pula** = tumingin sa camera. Pwedeng **kusang huminto ang script** kapag tumingin ka sa malayo. Lalabas din ang **Eye contact %** pagkatapos mag-record. May calibration. Sa device mo lang ito tumatakbo, walang video na ipinapadala kahit saan. |
| ⬇ **I-save / Share** | Pagkatapos mag-record, panoorin muna, tapos i-save o i-share diretso (sa phone). |

## Paano gamitin

1. Buksan ang app gamit ang **https://** (kailangan ito ng browser para sa camera). Pinakamadali gamit ang GitHub Pages (tingnan sa ibaba).
2. Pindutin ang **Buksan ang Camera** at payagan ang camera at mic.
3. **♪ Music**: pumili ng music file at i-adjust ang lakas.
4. **📜 Script**: i-paste ang script o mag-load ng `.txt` file.
5. **👁 Eye**: i-on ang detector, tapos pindutin ang **I-calibrate** habang nakatingin sa lens.
6. Pindutin ang pulang button para mag-record. Kusang magsi-scroll ang script.
7. ✓ para tapusin, tapos **I-save ang Video**.

Mga shortcut sa PC: `Space` = record / pause, `Esc` = stop.

### Mga tip para sa eye contact
- Ilagay ang phone sa **eye level** mo, at medyo malayo (mga isang braso).
- Gawing **makitid** ang teleprompter (40–60%) at **2–4 na linya** lang para malapit sa lens ang binabasa mo.
- Kapag may **earphones** ka, hindi mapapasok sa mic ang music, kaya mas malinis ang tunog.

## Pag-host sa GitHub Pages (libre)

1. Sa GitHub repo: **Settings → Pages**.
2. Sa *Source*, piliin ang branch at folder na `/ (root)`, tapos **Save**.
3. Buksan ang link na ibibigay (hal. `https://<username>.github.io/Camera-Falcon16/`) sa phone mo.

Pag-test sa PC: `python3 -m http.server 8000`, tapos buksan ang `http://localhost:8000`.

## Mga open-source na ginamit

- **[MediaPipe Tasks Vision / Face Landmarker](https://github.com/google-ai-edge/mediapipe)** (Apache-2.0) para sa face at eye tracking (blendshapes `eyeLookIn/Out/Up/Down` at head pose). Nilo-load mula sa jsDelivr CDN, `@mediapipe/tasks-vision@0.10.14`.
- Mga web standard API: `getUserMedia`, `MediaRecorder`, Web Audio (para i-mix ang music at mic), `canvas.captureStream`, Web Speech API (para sa voice-follow), Screen Wake Lock.

## Mga limitasyon

- Kailangan ng internet sa unang pag-on ng eye detector, para i-download ang face model (~4 MB).
- Sa ibang browser, WebM ang lalabas na video. Kung ayaw tanggapin ng app na pag-a-uploadan mo, gamitin ang Chrome sa Android o Safari sa iPhone, na kadalasan ay MP4 ang ginagawa.
- Hindi binabago ng app ang hitsura ng mata mo sa video (walang AI eye-correction). Tinutulungan ka lang nitong talagang tumingin sa lens.

## License

MIT
