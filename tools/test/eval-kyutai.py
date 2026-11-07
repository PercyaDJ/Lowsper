# Étude : Kyutai STT (stt-1b-en_fr, transcription en continu, CC-BY 4.0) face à Whisper small,
# sur les corpus synthétiques de Lowsper (decision.md §39). Outil de mesure seulement : rien
# n'est livré à l'utilisateur.
#
# Mesure, pour la piste des participants de chaque corpus : le taux d'erreur sur les mots (même
# normalisation que eval-hebdo.mjs) et le temps de calcul sur le processeur (PyTorch, nombre de
# fils choisi). Whisper small est mesuré à part, dans la vraie chaîne de Lowsper (eval-hebdo.mjs).
#
# Prérequis (environnement Python isolé, hors du dépôt) :
#   pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1
#   pip install transformers==4.57.1 numpy
#   poids : kyutai/stt-1b-en_fr-trfs, révision 98aadd47649e7ccb89d1e73a6b62bcb31d38170f,
#   dans tools/.cache/kyutai/stt-1b-en_fr-trfs
# Usage (depuis tools/) : python test/eval-kyutai.py [--threads=4] [corpus...]
#   corpus : hebdo, hebdo-teams, entretien-teams, simultane, simultane-teams
import json, os, re, sys, time, unicodedata, wave
import numpy as np
import torch
from transformers import KyutaiSpeechToTextForConditionalGeneration, KyutaiSpeechToTextProcessor

here = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
threads = int(next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('--threads=')), '4'))
torch.set_num_threads(threads)
corpora = args or ['hebdo', 'hebdo-teams', 'entretien-teams', 'simultane', 'simultane-teams']
model_dir = os.path.join(here, '..', '.cache', 'kyutai', 'stt-1b-en_fr-trfs')

t0 = time.time()
processor = KyutaiSpeechToTextProcessor.from_pretrained(model_dir)
model = KyutaiSpeechToTextForConditionalGeneration.from_pretrained(model_dir, torch_dtype=torch.float32)
model.eval()
load_s = time.time() - t0


def norm(t):
    t = unicodedata.normalize('NFD', t.lower())
    t = ''.join(c for c in t if not unicodedata.combining(c)).replace('’', "'")
    t = re.sub(r"[^a-z0-9' ]+", ' ', t).replace("'", "' ")
    return t.split()


def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    prev = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        cur = [i]
        for j in range(1, len(h) + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] != h[j - 1])))
        prev = cur
    return prev[len(h)] / len(r)


def read(path):
    with wave.open(path, 'rb') as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    # 16 kHz vers 24 kHz, la fréquence attendue par le modèle (interpolation linéaire)
    n = int(len(x) * 24000 / 16000)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


print(f'Kyutai STT 1B (fr, en), PyTorch processeur, {threads} fil(s), chargement {load_s:.0f} s')
for c in corpora:
    name, _, variant = c.partition('-')
    truth = json.load(open(os.path.join(here, 'corpus', f'{name}.truth.json'), encoding='utf-8'))
    ref = ' '.join(t['ref'] for t in truth if t['channel'] == 'others')
    audio = read(os.path.join(here, 'corpus', f'{name}-others{"-" + variant if variant else ""}.wav'))
    t = time.time()
    inputs = processor(audio=audio, return_tensors='pt')
    with torch.no_grad():
        # Un jeton de texte par trame de 80 ms (12,5 par seconde) : sans cette limite, la
        # génération s'arrête à la longueur par défaut (375 jetons, 30 s de son)
        tokens = model.generate(**inputs, max_new_tokens=int(len(audio) / 24000 * 12.5) + 50)
    hyp = processor.batch_decode(tokens, skip_special_tokens=True)[0]
    dt = time.time() - t
    dur = len(audio) / 24000
    print(f'{c:18s} erreurs {wer(ref, hyp) * 100:5.1f} %   calcul {dt:6.1f} s pour {dur:5.1f} s de son '
          f'({dt / dur:.2f} s par seconde de son)')
    with open(os.path.join(here, 'output', f'kyutai-{c}.txt'), 'w', encoding='utf-8') as f:
        f.write(hyp)
