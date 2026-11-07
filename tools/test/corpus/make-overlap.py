# Corpus synthétique « paroles simultanées » : une réunion fictive où les participants (côté
# visio) se coupent la parole. Aucune donnée réelle : voix Piper, texte inventé, aucun nom.
#
# Chaque événement place une ou deux répliques sur la piste « others » :
#   - temoin : une réplique seule, sans chevauchement (référence de la même voix) ;
#   - acquiescement : une réponse courte (« oui », « d'accord ») au milieu d'une phrase longue ;
#   - interruption : la seconde personne commence 1 à 2 s avant la fin de la première ;
#   - simultane : deux personnes commencent en même temps, l'une s'efface vite ;
#   - long : deux phrases complètes qui se chevauchent sur 3 s environ ;
#   - vous : vous parlez au micro pendant qu'un participant parle (deux pistes séparées ; avec
#     la variante « écho », le micro réentend aussi les haut-parleurs).
# La seconde voix est reçue entre -6 et 0 dB par rapport à la première (graine fixe).
#
# Prérequis : pip install piper-tts==1.3.0 numpy ; ffmpeg avec libopus (variante visio :
# python make-variants.py simultane).
# Usage (depuis tools/test/corpus) : python make-overlap.py
# Sorties : simultane-fr.json (script), simultane.truth.json (vérité, chevauchements compris),
# simultane-me.wav et simultane-others.wav (non versionnés, régénérés à l'identique).
import json, os, urllib.request, wave
import numpy as np
from piper import PiperVoice, SynthesisConfig

REV = 'e7229f7d33a10e145e109b886d661984201ac3c4'  # rhasspy/piper-voices, même révision que make-voices.py
MODEL = 'fr_FR-mls-medium'
RATE = 16000
here = os.path.dirname(os.path.abspath(__file__))
piper_dir = os.path.join(here, '..', '..', '.cache', 'voices', 'piper')
os.makedirs(piper_dir, exist_ok=True)
rng = np.random.default_rng(31)

for ext in ('.onnx', '.onnx.json'):
    path = os.path.join(piper_dir, MODEL + ext)
    if not os.path.exists(path):
        url = f'https://huggingface.co/rhasspy/piper-voices/resolve/{REV}/fr/fr_FR/mls/medium/{MODEL}{ext}'
        print('télécharge', url)
        urllib.request.urlretrieve(url, path)
voice = PiperVoice.load(os.path.join(piper_dir, MODEL + '.onnx'))

# Quatre participants côté visio, une personne au micro. Numéros de voix du modèle multi-voix.
SPEAKERS = {
    'Vous': {'speaker': 7, 'channel': 'me'},
    'A': {'speaker': 23, 'channel': 'others'},
    'B': {'speaker': 41, 'channel': 'others'},
    'C': {'speaker': 86, 'channel': 'others'},
    'D': {'speaker': 112, 'channel': 'others'},
}

LONGUES = [
    "Pour le planning du trimestre, on a pris un peu de retard sur la migration, mais l'équipe pense rattraper d'ici la fin du mois.",
    "Le budget de formation est presque consommé, il reste environ trois mille euros pour les sessions de décembre.",
    "J'ai relu la nouvelle procédure d'accès, elle me paraît claire, il faudra juste ajouter un exemple pour les nouveaux arrivants.",
    "La démonstration de jeudi est confirmée à quatorze heures, dans la grande salle, avec une vingtaine de participants.",
    "Sur la sauvegarde des données, le test de restauration a duré quarante minutes, c'est mieux que la dernière fois.",
    "Le fournisseur propose de renouveler le contrat de maintenance pour deux ans, avec une hausse de quatre pour cent.",
    "Les indicateurs du mois montrent une baisse des tickets en attente, on passe de cent vingt à quatre-vingt-dix.",
    "Pour le déménagement du bureau, les cartons seront livrés lundi et les postes déplacés le week-end suivant.",
    "La refonte du site avance, la page d'accueil est validée, il reste les pages de contact et le formulaire de devis.",
    "Le recrutement du stagiaire est lancé, on a reçu douze candidatures et on fera les entretiens la semaine prochaine.",
    "Pour la mise à jour des postes, il reste une trentaine de machines, surtout au deuxième étage.",
    "Le retour des utilisateurs sur le nouveau tableau de suivi est plutôt bon, ils demandent surtout un export en tableur.",
]
COURTES = ["Oui.", "D'accord.", "Tout à fait.", "Oui, oui.", "Exactement.", "Ah oui, d'accord.", "Mmh, d'accord.", "C'est vrai."]
EFFACEMENTS = ["Pardon, vas-y.", "Ah, vas-y, je t'en prie.", "Non, continue.", "Excuse-moi, je te laisse finir."]
REPONSES = [
    "Attends, je ne suis pas d'accord sur le délai, la fin du mois me paraît trop juste pour l'équipe.",
    "Justement, il faudrait garder une marge pour les imprévus, sinon on sera bloqués en janvier.",
    "Oui, mais il faut prévenir les utilisateurs au moins une semaine avant, sinon ils vont s'inquiéter.",
    "Je peux m'en occuper si personne ne le prend, j'ai un peu de temps la semaine prochaine.",
    "Sur ce point, il faudrait demander l'avis du service juridique avant de signer quoi que ce soit.",
    "Et on a vérifié que les salles sont libres ce jour-là, parce que la dernière fois il y avait un conflit.",
    "Il faudrait aussi mettre à jour la documentation, elle date de l'année dernière.",
    "Je propose qu'on en reparle mardi, avec les chiffres complets du trimestre sous les yeux.",
]
VOUS = [
    "Juste une question, est-ce que le fournisseur a confirmé la date de livraison ?",
    "D'accord, mais il faudrait prévenir l'équipe avant vendredi.",
    "Je note, on en reparlera au comité de lundi.",
    "Attends, tu peux répéter le chiffre du budget ?",
    "Oui, je suis d'accord avec cette proposition.",
    "Pardon, je n'ai pas entendu la fin de la phrase.",
]
MICRO = [
    "D'accord, je note tout ça pour le compte rendu.",
    "On passe au point suivant, s'il vous plaît.",
    "Merci à tous, on s'arrête là pour aujourd'hui.",
]

cache = {}


def synth(who, text):
    key = (who, text)
    if key not in cache:
        cfg = SynthesisConfig(speaker_id=SPEAKERS[who]['speaker'], length_scale=0.92)
        chunks = list(voice.synthesize(text, syn_config=cfg))
        audio = np.concatenate([c.audio_float_array for c in chunks])
        sr = chunks[0].sample_rate
        n = int(len(audio) * RATE / sr)
        cache[key] = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    return cache[key]


others = ['A', 'B', 'C', 'D']
events = []
kinds = ['temoin', 'acquiescement', 'interruption', 'simultane', 'long', 'vous'] * 6
rng.shuffle(kinds)
li, ri, ci, ei = 0, 0, 0, 0
for k, kind in enumerate(kinds):
    a, b = rng.choice(others, 2, replace=False)
    first = LONGUES[li % len(LONGUES)]
    li += 1
    if kind == 'temoin':
        events.append({'kind': kind, 'lines': [{'who': a, 'say': first}]})
        continue
    if kind == 'acquiescement':
        second = COURTES[ci % len(COURTES)]; ci += 1
    elif kind == 'simultane':
        second = EFFACEMENTS[ei % len(EFFACEMENTS)]; ei += 1
    elif kind == 'vous':
        second = VOUS[k % len(VOUS)]
        b = 'Vous'
    else:
        second = REPONSES[ri % len(REPONSES)]; ri += 1
    gain = 0.0 if b == 'Vous' else round(float(rng.uniform(-6, 0)), 1)
    events.append({'kind': kind, 'gain_db': gain, 'lines': [{'who': a, 'say': first}, {'who': b, 'say': second}]})
    if k % 10 == 9:
        events.append({'kind': 'micro', 'lines': [{'who': 'Vous', 'say': MICRO[(k // 10) % len(MICRO)]}]})

total = 16000 * 900
tracks = {'me': np.zeros(total, np.float32), 'others': np.zeros(total, np.float32)}
truth = []
t = 1.5
for ev in events:
    first = ev['lines'][0]
    a1 = synth(first['who'], first['say'])
    d1 = len(a1) / RATE
    starts = [t]
    if len(ev['lines']) == 2:
        a2 = synth(ev['lines'][1]['who'], ev['lines'][1]['say'])
        d2 = len(a2) / RATE
        if ev['kind'] in ('acquiescement', 'vous'):
            s2 = t + d1 * float(rng.uniform(0.35, 0.6))
        elif ev['kind'] == 'interruption':
            s2 = t + d1 - float(rng.uniform(1.0, 2.0))
        elif ev['kind'] == 'simultane':
            s2 = t + float(rng.uniform(0.0, 0.3))
        else:
            s2 = t + d1 - float(rng.uniform(2.5, 3.5))
        starts.append(round(s2, 2))
    end = t
    for i, line in enumerate(ev['lines']):
        audio = synth(line['who'], line['say'])
        gain = 10 ** (ev.get('gain_db', 0) / 20) if i == 1 else 1.0
        s = int(starts[i] * RATE)
        ch = SPEAKERS[line['who']]['channel']
        tracks[ch][s:s + len(audio)] += audio * 0.8 * gain
        e = starts[i] + len(audio) / RATE
        truth.append({'who': line['who'], 'channel': ch, 'kind': ev['kind'], 'role': ['premier', 'second'][i],
                      'start': round(starts[i], 2), 'end': round(e, 2), 'ref': line['say']})
        end = max(end, e)
    if len(ev['lines']) == 2:
        o = max(0.0, min(truth[-1]['end'], truth[-2]['end']) - max(truth[-1]['start'], truth[-2]['start']))
        truth[-1]['overlap'] = truth[-2]['overlap'] = round(o, 2)
    t = end + float(rng.uniform(0.6, 1.2))

n = int((t + 2) * RATE)
for ch, tr in tracks.items():
    with wave.open(os.path.join(here, f'simultane-{ch}.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((np.clip(tr[:n], -1, 1) * 32767).astype(np.int16).tobytes())

# Script au format des autres corpus (lu par eval-hebdo.mjs : titre, glossaire, voix, termes)
script = {
    'title': 'Réunion animée (corpus de test)',
    'glossary': '',
    'speakers': {k: {'voice': 'mls', 'speaker': v['speaker'], 'channel': v['channel']} for k, v in SPEAKERS.items()},
    'terms': [],
    'lines': [{'who': x['who'], 'ref': x['ref'], 'say': x['ref']} for x in truth],
}
json.dump(script, open(os.path.join(here, 'simultane-fr.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump(truth, open(os.path.join(here, 'simultane.truth.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
ov = [x['overlap'] for x in truth if 'overlap' in x and x['role'] == 'second']
print(f'{t:.1f} s, {len(truth)} répliques, {len(ov)} chevauchements (de {min(ov):.1f} à {max(ov):.1f} s)')
