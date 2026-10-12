# Génère hebdo-me.wav (micro) et hebdo-others.wav (audio partagé), 16 kHz mono, plus la
# vérité terrain (hebdo.truth.json : qui parle, quand, quoi). Voix de synthèse Piper.
# Usage : python make-hebdo.py <dossier_des_voix_piper> [nom du corpus : hebdo (défaut), entretien]
import json, sys, wave
import numpy as np
from piper import PiperVoice, SynthesisConfig

voices_dir = sys.argv[1]
name = sys.argv[2] if len(sys.argv) > 2 else 'hebdo'
data = json.load(open(f'{name}-fr.json', encoding='utf-8'))
cache = {}
def voice(name):
    if name not in cache:
        cache[name] = PiperVoice.load(f"{voices_dir}/fr_FR-{name}-medium.onnx")
    return cache[name]

def synth(spk, text):
    v = voice(spk['voice'])
    cfg = SynthesisConfig(speaker_id=spk.get('speaker'), length_scale=0.92)
    chunks = list(v.synthesize(text, syn_config=cfg))
    audio = np.concatenate([c.audio_float_array for c in chunks])
    sr = chunks[0].sample_rate
    n = int(len(audio) * 16000 / sr)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)

tracks = {'me': np.zeros(16000 * 600, np.float32), 'others': np.zeros(16000 * 600, np.float32)}
t = 1.5
truth = []
end = 0
for line in data['lines']:
    spk = data['speakers'][line['who']]
    audio = synth(spk, line['say'])
    start = t - line.get('overlap', 0)
    s = int(start * 16000)
    tracks[spk['channel']][s:s + len(audio)] += audio * 0.8
    dur = len(audio) / 16000
    truth.append({'who': line['who'], 'channel': spk['channel'], 'start': round(start, 2), 'end': round(start + dur, 2), 'ref': line['ref']})
    t = start + dur + 0.6
    end = max(end, start + dur)
n = int((end + 2) * 16000)
for ch, tr in tracks.items():
    with wave.open(f'{name}-{ch}.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes((np.clip(tr[:n], -1, 1) * 32767).astype(np.int16).tobytes())
json.dump(truth, open(f'{name}.truth.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{end:.1f} s, {len(truth)} répliques')
