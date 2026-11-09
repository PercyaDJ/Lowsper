# Génère le corpus « coupures » (decision.md §57) : des réunions synthétiques où chacun parle
# longtemps d'affilée, pour mesurer combien de fois une même personne est coupée en deux
# intervenants au milieu de ce qu'elle dit. Aucune donnée réelle : il assemble les prises de
# parole du corpus de la mémoire des voix (make-voices.py, voix de synthèse Piper, appareils
# simulés, compression d'une visio).
#
# Une réunion par équipe : les 6 habituées de l'équipe, chacune avec sa prise de parole de la même
# réunion (15 à 60 s, un appareil chacune), coupée en deux tours à un silence entre deux phrases.
# Les 12 tours sont mélangés (jamais deux tours de suite de la même personne), séparés de 0,3 à
# 1,2 s. Le micro (« Vous ») reste silencieux : seule la source « participants » est mesurée.
#
# Sorties (non versionnées, régénérées à l'identique, graine fixe) : test/corpus/coupures<N>-*
#   coupures<N>-others.wav, coupures<N>-me.wav (16 kHz mono), coupures<N>.truth.json, coupures<N>-fr.json
# Prérequis : python corpus/make-voices.py (tools/.cache/voices) ; numpy.
# Usage : python make-coupures.py [nombre de réunions, 8 par défaut] [numéro de réunion, 1 par défaut]
import json, os, sys, wave
import numpy as np

RATE = 16000
here = os.path.dirname(os.path.abspath(__file__))
voices = os.path.join(here, '..', '..', '.cache', 'voices')
rng = np.random.default_rng(57)
count = int(sys.argv[1]) if len(sys.argv) > 1 else 8
meeting = int(sys.argv[2]) if len(sys.argv) > 2 else 1


def read(path):
    with wave.open(path) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def write(path, audio):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())


def cut_point(audio):
    # Silence le plus proche du milieu (les phrases sont séparées de 0,4 s de silence)
    frame = RATE // 50
    n = len(audio) // frame
    rms = np.sqrt(np.mean(audio[: n * frame].reshape(n, frame) ** 2, axis=1))
    quiet = np.where(rms < 0.01)[0]
    if not len(quiet):
        return len(audio) // 2
    mid = n // 2
    return int(quiet[np.argmin(np.abs(quiet - mid))]) * frame


sessions = json.load(open(os.path.join(voices, 'voices.json'), encoding='utf-8'))['sessions']
for team in range(count):
    people = [s for s in sessions if s['kind'] == 'habituee' and s['team'] == team and s['meeting'] == meeting]
    turns = []
    for s in people:
        audio = read(os.path.join(voices, s['id'] + '.wav'))
        c = cut_point(audio)
        turns += [(s['person'], audio[:c]), (s['person'], audio[c:])]
    # Ordre tiré au hasard, sans deux tours de suite de la même personne
    while True:
        order = [turns[i] for i in rng.permutation(len(turns))]
        if all(order[i][0] != order[i - 1][0] for i in range(1, len(order))):
            break
    parts, truth, t = [np.zeros(int(1.5 * RATE), np.float32)], [], 1.5
    for who, audio in order:
        truth.append({'who': who, 'channel': 'others', 'start': round(t, 2), 'end': round(t + len(audio) / RATE, 2),
                      'ref': ''})
        gap = float(rng.uniform(0.3, 1.2))
        parts += [audio, np.zeros(int(gap * RATE), np.float32)]
        t += len(audio) / RATE + gap
    others = np.concatenate(parts)
    name = f'coupures{team + 1}'
    write(os.path.join(here, name + '-others.wav'), others)
    write(os.path.join(here, name + '-me.wav'), np.zeros_like(others))
    json.dump(truth, open(os.path.join(here, name + '.truth.json'), 'w', encoding='utf-8'), ensure_ascii=False,
              indent=1)
    json.dump({'title': f'Réunion fictive {team + 1}', 'glossary': '', 'terms': []},
              open(os.path.join(here, name + '-fr.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{name} : {len(people)} personnes, {len(order)} tours, {len(others) / RATE / 60:.1f} min', file=sys.stderr)
