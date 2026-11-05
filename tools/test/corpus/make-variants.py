# Produit les variantes dégradées d'un corpus généré par make-hebdo.py :
#   <nom>-others-teams.wav : son des participants façon visio (bande 200-3800 Hz, compression
#                            Opus 12 kb/s, bruit rose léger), comme ce qui sort des haut-parleurs ;
#   <nom>-me-echo.wav      : micro sans casque, qui réentend les participants (35 % du volume,
#                            50 ms de retard) en plus de votre voix.
# Prérequis : ffmpeg avec libopus, numpy.
# Usage : python make-variants.py <nom du corpus : hebdo, entretien>
import subprocess, sys, wave
import numpy as np

name = sys.argv[1] if len(sys.argv) > 1 else 'hebdo'
RATE = 16000
rng = np.random.default_rng(7)  # graine fixe : même bruit à chaque génération


def read(path):
    with wave.open(path, 'rb') as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def write(path, audio):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())


def pink(n):
    # Bruit rose par filtrage 1/f du spectre d'un bruit blanc
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.arange(len(spec)); f[0] = 1
    out = np.fft.irfft(spec / np.sqrt(f), n)
    return out / np.max(np.abs(out))


def teams(src, dst):
    # Bande téléphonique puis aller-retour Opus 12 kb/s (le codec des visios)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-af', 'highpass=f=200,lowpass=f=3800',
                    '-c:a', 'libopus', '-b:a', '12k', '-f', 'ogg', dst + '.ogg'], check=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', dst + '.ogg', '-ar', str(RATE), '-ac', '1', dst], check=True)
    subprocess.run(['rm', '-f', dst + '.ogg'], check=True)
    audio = read(dst)
    write(dst, audio + pink(len(audio)) * 0.004)
    return read(dst)


others = teams(f'{name}-others.wav', f'{name}-others-teams.wav')
me = read(f'{name}-me.wav')
n = min(len(me), len(others))
delay = int(0.05 * RATE)
echo = me[:n].copy()
echo[delay:] += others[:n - delay] * 0.35
write(f'{name}-me-echo.wav', echo)
print(f'{name} : variantes visio et écho écrites ({n / RATE:.1f} s)')
