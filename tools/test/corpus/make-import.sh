#!/bin/sh
# Génère les fichiers de test de l'import audio (tools/test/fixtures/import) : 20 s du corpus
# fictif « hebdo » (micro et participants mélangés), dans chaque format pris en charge.
# Prérequis : ffmpeg avec libmp3lame, libopus et l'encodeur aac. Usage : sh make-import.sh
set -e
cd "$(dirname "$0")"
out=../fixtures/import
mkdir -p "$out"
ffmpeg -loglevel error -y -i hebdo-me.wav -i hebdo-others.wav \
  -filter_complex "[0:a][1:a]amix=inputs=2:normalize=0,atrim=0:20[a]" -map "[a]" -ar 44100 -ac 2 /tmp/lowsper-extrait.wav
ffmpeg -loglevel error -y -i /tmp/lowsper-extrait.wav -ar 16000 -ac 1 -c:a pcm_s16le -map_metadata -1 "$out/extrait.wav"
ffmpeg -loglevel error -y -i /tmp/lowsper-extrait.wav -c:a libmp3lame -b:a 64k -map_metadata -1 "$out/extrait.mp3"
ffmpeg -loglevel error -y -i /tmp/lowsper-extrait.wav -c:a aac -b:a 64k -map_metadata -1 \
  -metadata creation_time=2026-03-14T09:30:00Z "$out/extrait.m4a"
ffmpeg -loglevel error -y -i /tmp/lowsper-extrait.wav -c:a aac -b:a 64k -f adts "$out/extrait.aac"
ffmpeg -loglevel error -y -i /tmp/lowsper-extrait.wav -c:a libopus -b:a 32k -map_metadata -1 "$out/extrait.ogg"
ffmpeg -loglevel error -y -i /tmp/lowsper-extrait.wav -c:a libopus -b:a 32k -map_metadata -1 "$out/extrait.webm"
ffmpeg -loglevel error -y -i /tmp/lowsper-extrait.wav -ar 16000 -ac 1 -c:a flac -map_metadata -1 "$out/extrait.flac"
rm -f /tmp/lowsper-extrait.wav
echo "Fichiers de test écrits dans $out"
