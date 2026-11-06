# Génère le corpus multilingue du lot R8 (decision.md §34) à partir de langs.json : un fichier
# WAV 16 kHz mono par langue, les dix phrases séparées par 1 s de silence, et leur position
# (tools/.cache/langs/<langue>.wav et <langue>.json). Voix de synthèse Piper, téléchargées depuis
# Hugging Face à une révision figée. L'audio n'est pas versionné (environ 20 Mo) : il se
# régénère à l'identique avec ce script.
# Avec l'argument « vocab », génère de même le corpus des vocabulaires métier (vocab-fr.json :
# vocab-<domaine>.wav et .json).
# Prérequis : pip install piper-tts numpy (et piper-tts[zh,ja] pour le mandarin et le japonais).
# Usage : python make-langs.py [langues...] ou python make-langs.py vocab
import json, os, sys, urllib.request, wave
import numpy as np
from piper import PiperVoice

REV = 'e7229f7d33a10e145e109b886d661984201ac3c4'  # rhasspy/piper-voices, 6 novembre 2026
here = os.path.dirname(os.path.abspath(__file__))
cache = os.path.join(here, '..', '..', '.cache', 'langs')
voices_dir = os.path.join(cache, 'voices')
os.makedirs(voices_dir, exist_ok=True)
os.chdir(cache)  # le phonétiseur du mandarin télécharge ses données dans le dossier courant
data = json.load(open(os.path.join(here, 'langs.json'), encoding='utf-8'))


def fetch(name):
    lang, rest = name.split('_', 1)
    region = name.split('-')[0]
    speaker, quality = rest.split('-')[1], rest.split('-')[2]
    base = f'https://huggingface.co/rhasspy/piper-voices/resolve/{REV}/{lang}/{region}/{speaker}/{quality}/{name}'
    for ext in ('.onnx', '.onnx.json'):
        path = os.path.join(voices_dir, name + ext)
        if not os.path.exists(path):
            print('télécharge', name + ext, file=sys.stderr)
            urllib.request.urlretrieve(base + ext, path)
    return PiperVoice.load(os.path.join(voices_dir, name + '.onnx'))


def to16k(chunks):
    audio = np.concatenate([c.audio_float_array for c in chunks])
    sr = chunks[0].sample_rate
    n = int(len(audio) * 16000 / sr)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)


def write(name, lines, names):
    voices = [fetch(v) for v in names]
    pcm, timeline, t = [np.zeros(16000, np.float32)], [], 1.0
    for i, text in enumerate(lines):
        audio = to16k(list(voices[i % len(voices)].synthesize(text)))
        timeline.append({'start': round(t, 3), 'end': round(t + len(audio) / 16000, 3), 'text': text,
                         'voice': names[i % len(voices)]})
        pcm += [audio, np.zeros(16000, np.float32)]
        t += len(audio) / 16000 + 1.0
    out = np.concatenate(pcm)
    with wave.open(os.path.join(cache, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes((np.clip(out, -1, 1) * 32767).astype(np.int16).tobytes())
    json.dump(timeline, open(os.path.join(cache, name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{name} : {t:.1f} s')


only = sys.argv[1:]
if only == ['vocab']:
    vocab = json.load(open(os.path.join(here, 'vocab-fr.json'), encoding='utf-8'))
    for domain, d in vocab['domains'].items():
        write('vocab-' + domain, d['lines'], vocab['voices'])
else:
    for lang, lines in data['lines'].items():
        if not only or lang in only:
            write(lang, lines, data['voices'][lang])
