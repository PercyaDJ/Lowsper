# Génère le corpus de la mémoire des voix (lot R9, decision.md §37) : des personnes fictives qui
# reviennent de réunion en réunion, chaque fois derrière un appareil différent (casque, micro du
# portable, téléphone, salle équipée, écouteurs Bluetooth), puis passées par la compression d'une
# visio (Opus). Aucune donnée réelle : voix de synthèse Piper (modèle multi-voix fr_FR-mls-medium,
# 125 voix), phrases tirées au hasard dans des modèles fictifs, graine fixe.
#
# Personnes :
#   - 48 « habituées », réparties en 8 équipes de 6, présentes à 6 réunions chacune ;
#   - 48 « de passage », présentes à une seule réunion (elles ne doivent recevoir aucun nom).
# Chaque habituée passe par les 5 appareils (ordre tiré au hasard), plus un sixième tiré au hasard.
# À chaque réunion varient aussi : le débit et l'intonation de la voix, la distance au micro
# (gain avant l'appareil), le volume reçu, et la durée de parole (3 à 10 phrases, 15 à 60 s).
#
# Sorties (non versionnées, environ 350 Mo, régénérées à l'identique) : tools/.cache/voices/
#   <session>.wav (16 kHz mono) et voices.json (la liste des sessions et leurs paramètres).
# Prérequis : pip install piper-tts==1.3.0 numpy ; ffmpeg avec libopus.
# Usage : python make-voices.py
import json, os, subprocess, sys, tempfile, urllib.request, wave
import numpy as np
from piper import PiperVoice, SynthesisConfig

REV = 'e7229f7d33a10e145e109b886d661984201ac3c4'  # rhasspy/piper-voices, 6 novembre 2026
MODEL = 'fr_FR-mls-medium'
RATE = 16000
here = os.path.dirname(os.path.abspath(__file__))
cache = os.path.join(here, '..', '..', '.cache', 'voices')
piper_dir = os.path.join(cache, 'piper')
os.makedirs(piper_dir, exist_ok=True)
rng = np.random.default_rng(2026)

# Appareils simulés : chaîne de filtres ffmpeg (réponse du micro, pièce), débit Opus de la visio,
# niveau du bruit de fond (bruit rose).
DEVICES = {
    # casque filaire ou USB : large bande, peu de bruit, visio en bon débit
    'casque': ('highpass=f=90,lowpass=f=7000,equalizer=f=3000:t=q:w=1:g=3', '24k', 0.002),
    # micro intégré du portable : graves coupés, creux et pic de résonance, écho de la pièce,
    # ventilateur
    'portable': ('highpass=f=300,lowpass=f=6500,equalizer=f=1200:t=q:w=1.5:g=-5,'
                 'equalizer=f=4500:t=q:w=1:g=6,aecho=0.8:0.6:23|41:0.3|0.2', '16k', 0.012),
    # téléphone (appel entrant dans la visio) : bande étroite, bas débit
    'telephone': ('highpass=f=300,lowpass=f=3400', '8k', 0.006),
    # salle équipée (micro de table) : réverbération, compresseur automatique du niveau
    'salle': ('aecho=0.8:0.8:60|110|170:0.35|0.25|0.15,highpass=f=150,lowpass=f=5000,'
              'acompressor=threshold=0.05:ratio=6:attack=5:release=100:makeup=4', '20k', 0.008),
    # écouteurs Bluetooth (profil « mains libres ») : bande téléphonique, compression
    'bluetooth': ('highpass=f=200,lowpass=f=3800,acompressor=threshold=0.1:ratio=4:makeup=2', '12k', 0.004),
}

# Phrases fictives : début, sujet, suite. Aucun nom de personne ni d'entreprise.
DEBUTS = ['Alors, pour', 'Concernant', 'Je voulais revenir sur', 'Rapidement, sur', 'De mon côté, pour',
          'Petit point sur', 'Si je reprends', 'Pour être clair sur', 'On avance bien sur',
          'Il reste un sujet sur', 'Je propose de regarder', 'Honnêtement, pour']
SUJETS = ['le planning du trimestre', 'la migration des serveurs', 'le budget de formation',
          'la refonte du site', 'les tickets en attente', 'le recrutement du stagiaire',
          'la réunion avec le fournisseur', 'la mise à jour des postes', 'le tableau de suivi',
          'la sauvegarde des données', 'le déménagement du bureau', 'la charte graphique',
          'les congés de décembre', 'le contrat de maintenance', 'la nouvelle procédure',
          'le retour des utilisateurs', 'la sécurité des accès', 'le compte rendu de lundi',
          'les indicateurs du mois', 'la démonstration de jeudi']
SUITES = ["on a pris un peu de retard mais rien d'inquiétant.", 'je pense que ce sera prêt pour la fin du mois.',
          "il faudrait qu'on en reparle avec toute l'équipe.", "j'ai envoyé un message ce matin, sans réponse pour l'instant.",
          'les premiers résultats sont plutôt encourageants.', 'je ne suis pas sûr que ce soit la priorité.',
          'on pourrait découper le travail en deux étapes.', "c'est validé, on peut lancer la suite.",
          'il manque encore deux ou trois informations.', 'je vous propose une solution plus simple.',
          'le coût reste raisonnable si on s\'y prend tôt.', 'je m\'en occupe cette semaine.',
          'on a eu quelques difficultés avec les tests.', 'tout le monde semble d\'accord sur le principe.',
          'je préfère attendre la décision de la direction.', 'ça demandera un peu plus de temps que prévu.']


def sentence():
    return f'{rng.choice(DEBUTS)} {rng.choice(SUJETS)}, {rng.choice(SUITES)}'


def fetch():
    base = f'https://huggingface.co/rhasspy/piper-voices/resolve/{REV}/fr/fr_FR/mls/medium/{MODEL}'
    for ext in ('.onnx', '.onnx.json'):
        path = os.path.join(piper_dir, MODEL + ext)
        if not os.path.exists(path):
            print('télécharge', MODEL + ext, file=sys.stderr)
            urllib.request.urlretrieve(base + ext, path)
    return PiperVoice.load(os.path.join(piper_dir, MODEL + '.onnx'))


def write(path, audio, rate=RATE):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())


def read(path):
    with wave.open(path, 'rb') as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def pink(n):
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.arange(len(spec)); f[0] = 1
    out = np.fft.irfft(spec / np.sqrt(f), n)
    return out / np.max(np.abs(out))


def through(audio, sr, device, dst):
    # voix -> appareil -> visio (aller-retour Opus) -> 16 kHz, puis bruit de fond
    chain, bitrate, noise = DEVICES[device]
    with tempfile.TemporaryDirectory() as tmp:
        src, ogg = os.path.join(tmp, 'src.wav'), os.path.join(tmp, 'visio.ogg')
        write(src, audio, sr)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-af', chain, '-c:a', 'libopus',
                        '-b:a', bitrate, '-f', 'ogg', ogg], check=True)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', ogg, '-ar', str(RATE), '-ac', '1', dst],
                       check=True)
    out = read(dst)
    return out + pink(len(out)) * noise


voice = fetch()
speakers = list(json.load(open(os.path.join(piper_dir, MODEL + '.onnx.json')))['speaker_id_map'].values())
order = rng.permutation(speakers)
names = list(DEVICES)
sessions = []


def session(person, kind, team, index, device):
    sid = f'{person}-{index}'
    cfg = SynthesisConfig(speaker_id=int(person.split('p')[1]), length_scale=float(rng.uniform(0.85, 1.1)),
                          noise_scale=float(rng.uniform(0.5, 0.8)), noise_w_scale=float(rng.uniform(0.6, 1.0)))
    lines = [sentence() for _ in range(int(rng.integers(3, 11)))]
    parts, sr = [], None
    for text in lines:
        chunks = list(voice.synthesize(text, syn_config=cfg))
        sr = chunks[0].sample_rate
        parts += [np.concatenate([c.audio_float_array for c in chunks]), np.zeros(int(0.4 * sr), np.float32)]
    audio = np.concatenate(parts)
    near = float(rng.uniform(-8, 4))  # distance au micro, en dB
    audio = audio * 10 ** (near / 20)
    out = through(audio, sr, device, os.path.join(cache, sid + '.wav'))
    level = float(rng.uniform(-6, 3))  # volume reçu, en dB, autour d'une crête à 0,5
    out = out / (np.max(np.abs(out)) or 1) * 0.5 * 10 ** (level / 20)
    write(os.path.join(cache, sid + '.wav'), out)
    sessions.append({'id': sid, 'person': person, 'kind': kind, 'team': team, 'meeting': index, 'device': device,
                     'seconds': round(len(out) / RATE, 2), 'gainDb': round(near, 1), 'levelDb': round(level, 1),
                     'lengthScale': round(cfg.length_scale, 3)})
    print(f'{sid} {device:9s} {len(out) / RATE:5.1f} s', file=sys.stderr)


for p in range(48):
    person = f'p{order[p]}'
    devices = list(rng.permutation(names)) + [str(rng.choice(names))]
    for m in range(6):
        session(person, 'habituee', p // 6, m + 1, str(devices[m]))
for p in range(48, 96):
    session(f'p{order[p]}', 'passage', int((p - 48) // 6), int(rng.integers(2, 7)), str(rng.choice(names)))

json.dump({'model': MODEL, 'revision': REV, 'devices': {k: {'filters': v[0], 'opus': v[1], 'noise': v[2]}
           for k, v in DEVICES.items()}, 'sessions': sessions},
          open(os.path.join(cache, 'voices.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(sessions)} sessions, {sum(s["seconds"] for s in sessions) / 3600:.2f} h', file=sys.stderr)
