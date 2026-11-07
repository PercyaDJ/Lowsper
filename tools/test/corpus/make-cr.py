# Génère l'audio du corpus du compte rendu extractif (compte-rendu.json, lot C1, decision.md §40) :
# pour chaque réunion, <id>-me.wav (micro) et <id>-others.wav (son de la réunion), 16 kHz mono, et
# <id>.truth.json (qui parle, quand, quoi). Voix de synthèse Piper téléchargées depuis Hugging Face
# à une révision figée. L'audio n'est pas versionné (environ 40 Mo) : il se régénère à l'identique
# dans tools/.cache/cr avec ce script.
# Prérequis : pip install piper-tts numpy
# Usage : python make-cr.py [identifiants de réunion...]
import json, os, sys, urllib.request, wave
import numpy as np
from piper import PiperVoice, SynthesisConfig

REV = 'e7229f7d33a10e145e109b886d661984201ac3c4'  # rhasspy/piper-voices, même révision que make-langs.py
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', '..', '.cache', 'cr')
voices_dir = os.path.join(here, '..', '..', '.cache', 'langs', 'voices')
os.makedirs(out, exist_ok=True)
os.makedirs(voices_dir, exist_ok=True)
data = json.load(open(os.path.join(here, 'compte-rendu.json'), encoding='utf-8'))
for f in ('compte-rendu-aveugle.json', 'compte-rendu-aveugle-2.json'):
    data['meetings'] += json.load(open(os.path.join(here, f), encoding='utf-8'))['meetings']
cache = {}


def voice(name):
    if name not in cache:
        lang, rest = name.split('_', 1)
        region = name.split('-')[0]
        speaker, quality = rest.split('-')[1], rest.split('-')[2]
        base = f'https://huggingface.co/rhasspy/piper-voices/resolve/{REV}/{lang}/{region}/{speaker}/{quality}/{name}'
        for ext in ('.onnx', '.onnx.json'):
            path = os.path.join(voices_dir, name + ext)
            if not os.path.exists(path):
                print('télécharge', name + ext, file=sys.stderr)
                urllib.request.urlretrieve(base + ext, path)
        cache[name] = PiperVoice.load(os.path.join(voices_dir, name + '.onnx'))
    return cache[name]


def synth(spk, text):
    cfg = SynthesisConfig(speaker_id=spk.get('speaker'), length_scale=0.92)
    chunks = list(voice(spk['voice']).synthesize(text, syn_config=cfg))
    audio = np.concatenate([c.audio_float_array for c in chunks])
    sr = chunks[0].sample_rate
    n = int(len(audio) * 16000 / sr)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)


only = sys.argv[1:]
for m in data['meetings']:
    if only and m['id'] not in only:
        continue
    tracks = {'me': np.zeros(16000 * 900, np.float32), 'others': np.zeros(16000 * 900, np.float32)}
    t, end, truth = 1.5, 0, []
    for line in m['lines']:
        spk = m['speakers'][line['who']]
        audio = synth(spk, line.get('say', line['text']))
        s = int(t * 16000)
        tracks[spk['channel']][s:s + len(audio)] += audio * 0.8
        dur = len(audio) / 16000
        truth.append({'who': line['who'], 'channel': spk['channel'], 'start': round(t, 2), 'end': round(t + dur, 2),
                      'text': line['text'], 'marks': line.get('marks', [])})
        end = t + dur
        t = end + 0.6
    n = int((end + 2) * 16000)
    for ch, tr in tracks.items():
        with wave.open(os.path.join(out, f"{m['id']}-{ch}.wav"), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
            w.writeframes((np.clip(tr[:n], -1, 1) * 32767).astype(np.int16).tobytes())
    json.dump(truth, open(os.path.join(out, f"{m['id']}.truth.json"), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"{m['id']} : {end:.1f} s, {len(truth)} répliques")
