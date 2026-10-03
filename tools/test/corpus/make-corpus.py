# Génère meeting-fr.wav (16 kHz mono) à partir de meeting-fr.json avec Piper (voix françaises).
# Usage : python make-corpus.py <dossier_des_voix_piper>
import json, sys, wave, io
import numpy as np
from piper import PiperVoice

voices_dir = sys.argv[1]
data = json.load(open('meeting-fr.json', encoding='utf-8'))
voices = {}
pcm = []
timeline = []
t = 0.0
silence = lambda s: np.zeros(int(16000 * s), dtype=np.float32)
pcm.append(silence(1.0)); t += 1.0
for line in data['lines']:
    v = voices.setdefault(line['voice'], PiperVoice.load(f"{voices_dir}/fr_FR-{line['voice']}-medium.onnx"))
    chunks = list(v.synthesize(line['say']))
    audio = np.concatenate([c.audio_float_array for c in chunks])
    sr = chunks[0].sample_rate
    # rééchantillonnage linéaire vers 16 kHz
    n = int(len(audio) * 16000 / sr)
    audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    timeline.append({'start': round(t, 2), 'ref': line['ref']})
    pcm.append(audio); t += len(audio) / 16000
    pcm.append(silence(1.2)); t += 1.2
out = np.concatenate(pcm)
with wave.open('meeting-fr.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes((np.clip(out, -1, 1) * 32767).astype(np.int16).tobytes())
json.dump(timeline, open('meeting-fr.timeline.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{t:.1f} s')
