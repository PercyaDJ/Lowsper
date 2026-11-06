/*
 * Lowsper : lecture des fichiers audio importés (dictaphone, téléphone, enregistrement fait ailleurs).
 *
 * Un fichier de plusieurs heures ne peut pas être décodé d'un bloc : le navigateur y consacre
 * environ 3 Go de mémoire par heure (mesuré, decision.md §19). Lowsper lit donc le conteneur
 * lui-même (WAV, MP3, AAC, M4A, Ogg Opus, WebM Opus), en extrait les trames audio par petits lots
 * et les confie au décodeur du navigateur (WebCodecs) : la mémoire reste bornée quelle que soit la
 * durée, et le son obtenu est exact. Les autres formats que le navigateur sait lire (FLAC, Vorbis...)
 * passent par le décodage complet, réservé aux fichiers courts.
 *
 * Le fichier n'est jamais copié sur le disque : il est lu par morceaux, depuis l'original choisi
 * par l'utilisateur, puis oublié.
 *
 * Deux étages :
 *   - lecteurs de conteneur (fonctions pures, testées sans navigateur) : open(source) ;
 *   - décodage en flux, côté navigateur : Lowsper.AudioFile.decode(file) -> morceaux 16 kHz mono.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});
  const RATE = 16000;
  // Au-delà, un fichier dans un format sans lecteur dédié n'est pas décodé d'un bloc (mémoire)
  const FALLBACK_MAX_BYTES = 25 * 1024 * 1024;

  // Message dans la langue de l'interface (i18n.js) ; sans catalogue (page de test), la clé seule
  const tx = (key, vars) => (Lowsper.t ? Lowsper.t(key, vars) : key);

  function fail(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  const ascii = (b, off, n) => String.fromCharCode(...b.subarray(off, off + n));

  // ---------------------------------------------------------------------------
  // Reconnaissance du format par les premiers octets (l'extension peut mentir)
  // ---------------------------------------------------------------------------
  function detect(head) {
    if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return 'wav';
    if (head.length >= 8 && ascii(head, 4, 4) === 'ftyp') return 'mp4';
    if (head.length >= 4 && ascii(head, 0, 4) === 'OggS') return 'ogg';
    if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
    if (head.length >= 4 && ascii(head, 0, 4) === 'fLaC') return 'flac';
    if (head.length >= 3 && ascii(head, 0, 3) === 'ID3') return 'mp3';
    if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
      // Même mot de synchronisation : la « couche » 00 désigne l'AAC brut (ADTS)
      return (head[1] & 0x06) === 0 ? 'adts' : 'mp3';
    }
    return 'inconnu';
  }

  // Source de lecture : { size, read(offset, length) -> Promise<Uint8Array> }
  async function open(source) {
    const src = source.cached ? source : cached(source);
    src.cached = true;
    const head = await src.read(0, 64);
    const format = detect(head);
    const readers = { wav: openWav, mp3: openMp3, adts: openAdts, mp4: openMp4, ogg: openOgg, webm: openWebm };
    if (format === 'inconnu') {
      // Octets parasites en tête (enregistreur, coupure) : on cherche des trames plus loin
      for (const [name, reader] of [
        ['mp3', openMp3],
        ['adts', openAdts],
      ]) {
        try {
          return Object.assign({ format: name }, await reader(src));
        } catch {}
      }
    }
    if (!readers[format]) return { format, fallback: true };
    return Object.assign({ format }, await readers[format](src));
  }

  // ---------------------------------------------------------------------------
  // WAV : PCM 8/16/24/32 bits ou flottant, lu directement (aucun décodage)
  // ---------------------------------------------------------------------------
  async function openWav(src) {
    let p = 12;
    let fmt = null;
    while (p + 8 <= src.size) {
      const h = await src.read(p, 8);
      const id = ascii(h, 0, 4);
      const size = new DataView(h.buffer, h.byteOffset).getUint32(4, true);
      if (id === 'fmt ') {
        const b = await src.read(p + 8, Math.min(size, 40));
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        let tag = v.getUint16(0, true);
        if (tag === 0xfffe && b.length >= 26) tag = v.getUint16(24, true); // WAVE_FORMAT_EXTENSIBLE
        fmt = { tag, channels: v.getUint16(2, true), sampleRate: v.getUint32(4, true), bits: v.getUint16(14, true) };
      } else if (id === 'data') {
        if (!fmt) throw fail('FORMAT', tx('audio.wavNoFmt'));
        if (!((fmt.tag === 1 && [8, 16, 24, 32].includes(fmt.bits)) || (fmt.tag === 3 && fmt.bits === 32))) {
          throw fail('CODEC', tx('audio.wavCodec'));
        }
        // Taille nulle ou maximale : enregistrement interrompu, on lit jusqu'à la fin du fichier
        const start = p + 8;
        const bytes = size === 0 || size === 0xffffffff || start + size > src.size ? src.size - start : size;
        const frame = (fmt.bits / 8) * fmt.channels;
        return {
          pcm: true,
          sampleRate: fmt.sampleRate,
          channels: fmt.channels,
          bits: fmt.bits,
          float: fmt.tag === 3,
          dataOffset: start,
          dataBytes: bytes - (bytes % frame),
          duration: Math.floor(bytes / frame) / fmt.sampleRate,
        };
      }
      p += 8 + size + (size & 1);
    }
    throw fail('FORMAT', tx('audio.wavNoData'));
  }

  /** Échantillons PCM entrelacés -> Float32 mono. */
  function pcmToMono(bytes, info) {
    const ch = info.channels;
    const bps = info.bits / 8;
    const n = Math.floor(bytes.length / (bps * ch));
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let c = 0; c < ch; c++) {
        const o = (i * ch + c) * bps;
        let x;
        if (info.float) x = v.getFloat32(o, true);
        else if (bps === 2) x = v.getInt16(o, true) / 32768;
        else if (bps === 3) x = (v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608;
        else if (bps === 4) x = v.getInt32(o, true) / 2147483648;
        else x = (v.getUint8(o) - 128) / 128;
        sum += x;
      }
      out[i] = sum / ch;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // MP3 : trames MPEG audio couche III, repérées une à une
  // ---------------------------------------------------------------------------
  const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const MP3_BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };

  /** En-tête de trame MP3 à la position p, ou null. */
  function mp3Frame(b, p) {
    if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null;
    const version = (b[p + 1] >> 3) & 3; // 3 : MPEG-1, 2 : MPEG-2, 0 : MPEG-2.5
    const layer = (b[p + 1] >> 1) & 3; // 1 : couche III
    const bitrateIdx = b[p + 2] >> 4;
    const rateIdx = (b[p + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return null;
    const sampleRate = MP3_RATES[version][rateIdx];
    const kbps = MP3_BITRATES[version === 3 ? 1 : 2][bitrateIdx];
    const padding = (b[p + 2] >> 1) & 1;
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding;
    const channels = b[p + 3] >> 6 === 3 ? 1 : 2;
    return { length, sampleRate, samples, channels };
  }

  async function openMp3(src) {
    let start = 0;
    const id3 = await src.read(0, 10);
    if (ascii(id3, 0, 3) === 'ID3') {
      start = 10 + (((id3[6] & 0x7f) << 21) | ((id3[7] & 0x7f) << 14) | ((id3[8] & 0x7f) << 7) | (id3[9] & 0x7f));
      if (id3[5] & 0x10) start += 10; // pied de balise
    }
    // Première trame valide, confirmée par la suivante (évite un faux mot de synchronisation)
    const b = await src.read(start, 64 * 1024);
    for (let p = 0; p + 4 < b.length; p++) {
      const f = mp3Frame(b, p);
      if (!f) continue;
      const next = mp3Frame(b, p + f.length);
      if (!next || next.sampleRate !== f.sampleRate) continue;
      return {
        codec: 'mp3',
        sampleRate: f.sampleRate,
        channels: f.channels,
        packets: (from) => framePackets(src, start + p, from, mp3Frame),
        // Estimation : sert seulement à l'avancement, le son décodé fait foi
        duration: await estimateDuration(src, start + p, mp3Frame),
      };
    }
    throw fail('FORMAT', tx('audio.noMp3'));
  }

  // ---------------------------------------------------------------------------
  // AAC brut (ADTS) : trames autoportées, passées telles quelles au décodeur
  // ---------------------------------------------------------------------------
  const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

  function adtsFrame(b, p) {
    if (p + 7 > b.length || b[p] !== 0xff || (b[p + 1] & 0xf6) !== 0xf0) return null;
    const rateIdx = (b[p + 2] >> 2) & 0xf;
    const length = ((b[p + 3] & 3) << 11) | (b[p + 4] << 3) | (b[p + 5] >> 5);
    if (rateIdx > 12 || length < 7) return null;
    const channels = ((b[p + 2] & 1) << 2) | (b[p + 3] >> 6);
    return {
      length,
      sampleRate: AAC_RATES[rateIdx],
      samples: 1024,
      channels: channels || 2,
      profile: (b[p + 2] >> 6) + 1,
    };
  }

  async function openAdts(src) {
    const b = await src.read(0, 64 * 1024);
    for (let p = 0; p + 7 < b.length; p++) {
      const f = adtsFrame(b, p);
      if (!f || !adtsFrame(b, p + f.length)) continue;
      return {
        // Sans « description », WebCodecs attend justement des trames ADTS
        codec: 'mp4a.40.' + f.profile,
        sampleRate: f.sampleRate,
        channels: f.channels,
        packets: (from) => framePackets(src, p, from, adtsFrame),
        duration: await estimateDuration(src, p, adtsFrame),
      };
    }
    throw fail('FORMAT', tx('audio.noAac'));
  }

  /**
   * Durée estimée d'un flux de trames, d'après la taille moyenne des trames à trois endroits du
   * fichier (début, milieu, trois quarts) : le débit peut varier, et le début d'un enregistrement
   * est souvent un silence très compressé. Sert seulement à l'avancement, le son décodé fait foi.
   */
  async function estimateDuration(src, start, parse) {
    if (src.size - start <= 4 * 1024 * 1024) {
      // Petit fichier : on compte toutes les trames, la durée est exacte
      let t = 0;
      for await (const g of framePackets(src, start, 0, parse)) t = g.packets[g.packets.length - 1].timestamp;
      const b = await src.read(start, 8);
      const f = parse(b, 0);
      return f ? t / 1e6 + f.samples / f.sampleRate : t / 1e6;
    }
    let n = 0;
    let len = 0;
    let unit = null;
    const span = src.size - start;
    for (const at of [0, 0.5, 0.75]) {
      const b = await src.read(start + Math.floor(span * at), 64 * 1024);
      for (let p = 0; p + 4 < b.length; p++) {
        const f = parse(b, p);
        if (!f || !parse(b, p + f.length)) continue;
        let q = p;
        for (let k = 0; k < 100; k++) {
          const g = parse(b, q);
          if (!g || q + g.length > b.length) break;
          len += g.length;
          n++;
          unit = unit || g;
          q += g.length;
        }
        break;
      }
    }
    return n ? (span / (len / n)) * (unit.samples / unit.sampleRate) : null;
  }

  /**
   * Trames successives d'un flux autoporté (MP3, ADTS), lues par blocs de 1 Mo.
   * Un octet parasite (balise en fin de fichier, coupure) fait chercher la trame suivante.
   */
  async function* framePackets(src, start, from, parse) {
    let pos = start;
    let t = 0;
    const BLOCK = 1024 * 1024;
    while (pos < src.size) {
      const b = await src.read(pos, Math.min(BLOCK, src.size - pos));
      let p = 0;
      const batch = [];
      while (p + 4 <= b.length) {
        const f = parse(b, p);
        if (!f) {
          p++;
          continue;
        }
        if (p + f.length > b.length) break; // trame à cheval : relue au bloc suivant
        if (t >= from) batch.push({ data: b.subarray(p, p + f.length), timestamp: t });
        t += (f.samples * 1e6) / f.sampleRate;
        p += f.length;
      }
      if (batch.length) yield { packets: batch, offset: pos + p };
      if (p === 0 && b.length >= 4) p = b.length - 3; // rien de lisible dans ce bloc
      pos += p || b.length;
      if (b.length < 4) break;
    }
  }

  // ---------------------------------------------------------------------------
  // MP4 / M4A : boîtes ISO, table des échantillons de la piste audio
  // ---------------------------------------------------------------------------
  function boxesIn(b, start, end) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = v.getUint32(p);
      const type = ascii(b, p + 4, 4);
      let hdr = 8;
      if (size === 1) {
        size = Number(v.getBigUint64(p + 8));
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr) break;
      out.push({ type, start: p, body: p + hdr, end: Math.min(end, p + size) });
      p += size;
    }
    return out;
  }

  async function openMp4(src) {
    // La boîte « moov » (index) peut être au début ou à la fin du fichier
    let p = 0;
    let moov = null;
    while (p + 8 <= src.size) {
      const h = await src.read(p, 16);
      const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
      let size = v.getUint32(0);
      if (size === 1) size = Number(v.getBigUint64(8));
      else if (size === 0) size = src.size - p;
      const type = ascii(h, 4, 4);
      if (type === 'moov') {
        moov = await src.read(p, size);
        break;
      }
      if (size < 8) break;
      p += size;
    }
    if (!moov) throw fail('FORMAT', tx('audio.mp4NoIndex'));
    const v = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
    const child = (box, type) => boxesIn(moov, box.body, box.end).find((x) => x.type === type);
    const path = (box, types) => types.reduce((b, t) => b && child(b, t), box);
    const top = { body: 8, end: moov.length };

    // Date de création (secondes depuis 1904), si l'appareil l'a renseignée
    let recordedAt = null;
    const mvhd = child(top, 'mvhd');
    if (mvhd) {
      const ver = moov[mvhd.body];
      const secs = ver ? Number(v.getBigUint64(mvhd.body + 4)) : v.getUint32(mvhd.body + 4);
      const ms = (secs - 2082844800) * 1000;
      if (secs > 0 && ms > Date.UTC(1995, 0, 1) && ms < Date.now() + 864e5) recordedAt = ms;
    }

    const trak = boxesIn(moov, top.body, top.end)
      .filter((b) => b.type === 'trak')
      .find((t) => {
        const h = path(t, ['mdia', 'hdlr']);
        return h && ascii(moov, h.body + 8, 4) === 'soun';
      });
    if (!trak) throw fail('FORMAT', tx('audio.noTrack'));
    const stbl = path(trak, ['mdia', 'minf', 'stbl']);
    const stsd = child(stbl, 'stsd');
    const entry = boxesIn(moov, stsd.body + 8, stsd.end)[0];
    if (!entry || entry.type !== 'mp4a') {
      throw fail('CODEC', tx('audio.mp4Codec', { type: entry ? entry.type : '?' }));
    }
    const channels = v.getUint16(entry.body + 16);
    const sampleRate = v.getUint32(entry.body + 24) >>> 16;
    const esds = boxesIn(moov, entry.body + 28, entry.end).find((x) => x.type === 'esds');
    const config = esds && aacConfig(moov, esds);
    if (!config) throw fail('CODEC', tx('audio.noAacConfig'));

    const stsz = child(stbl, 'stsz');
    const stco = child(stbl, 'stco') || child(stbl, 'co64');
    const stsc = child(stbl, 'stsc');
    const n = v.getUint32(stsz.body + 8);
    const fixed = v.getUint32(stsz.body + 4);
    const sizes = new Uint32Array(n);
    for (let i = 0; i < n; i++) sizes[i] = fixed || v.getUint32(stsz.body + 12 + 4 * i);
    const nChunks = v.getUint32(stco.body + 4);
    const co64 = stco.type === 'co64';
    const runs = [];
    for (let i = 0, ns = v.getUint32(stsc.body + 4); i < ns; i++) {
      runs.push([v.getUint32(stsc.body + 8 + 12 * i) - 1, v.getUint32(stsc.body + 12 + 12 * i)]);
    }
    const offsets = new Float64Array(n);
    for (let c = 0, r = 0, s = 0; c < nChunks && s < n; c++) {
      while (r + 1 < runs.length && runs[r + 1][0] <= c) r++;
      let off = co64 ? Number(v.getBigUint64(stco.body + 8 + 8 * c)) : v.getUint32(stco.body + 8 + 4 * c);
      for (let k = 0; k < runs[r][1] && s < n; k++, s++) {
        offsets[s] = off;
        off += sizes[s];
      }
    }
    const frameSamples = config.objectType === 5 || config.objectType === 29 ? 2048 : 1024;
    return {
      codec: 'mp4a.40.' + config.objectType,
      description: config.bytes,
      sampleRate: config.sampleRate || sampleRate,
      channels: config.channels || channels,
      recordedAt,
      duration: (n * 1024) / (config.sampleRate || sampleRate),
      packets: (from) => tablePackets(src, offsets, sizes, frameSamples, config.sampleRate || sampleRate, from),
    };
  }

  /** Configuration AAC (AudioSpecificConfig) dans les descripteurs de la boîte esds. */
  function aacConfig(b, esds) {
    let p = esds.body + 4;
    const len = () => {
      let n = 0;
      for (let i = 0; i < 4; i++) {
        const c = b[p++];
        n = (n << 7) | (c & 0x7f);
        if (!(c & 0x80)) break;
      }
      return n;
    };
    while (p < esds.end) {
      const tag = b[p++];
      const l = len();
      if (tag === 3) {
        const flags = b[p + 2];
        p += 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x40 ? 1 + b[p + 3] : 0) + (flags & 0x20 ? 2 : 0);
      } else if (tag === 4) p += 13;
      else if (tag === 5) {
        const bytes = b.slice(p, p + l);
        const objectType = bytes[0] >> 3;
        const rateIdx = ((bytes[0] & 7) << 1) | (bytes[1] >> 7);
        return { bytes, objectType, sampleRate: AAC_RATES[rateIdx], channels: (bytes[1] >> 3) & 0xf };
      } else p += l;
    }
    return null;
  }

  async function* tablePackets(src, offsets, sizes, frameSamples, sampleRate, from) {
    const BATCH = 1000;
    for (let i = 0; i < offsets.length; i += BATCH) {
      const j = Math.min(offsets.length, i + BATCH);
      const batch = [];
      // Lots d'échantillons contigus dans le fichier (cas habituel), sinon lus un par un
      let k = i;
      while (k < j) {
        let e = k + 1;
        while (e < j && offsets[e] === offsets[e - 1] + sizes[e - 1]) e++;
        const buf = await src.read(offsets[k], offsets[e - 1] + sizes[e - 1] - offsets[k]);
        for (let s = k; s < e; s++) {
          const t = (s * frameSamples * 1e6) / sampleRate;
          if (t >= from)
            batch.push({
              data: buf.subarray(offsets[s] - offsets[k], offsets[s] - offsets[k] + sizes[s]),
              timestamp: t,
            });
        }
        k = e;
      }
      if (batch.length) yield { packets: batch, offset: offsets[j - 1] + sizes[j - 1] };
    }
  }

  // ---------------------------------------------------------------------------
  // Ogg Opus : pages Ogg, paquets reconstitués
  // ---------------------------------------------------------------------------
  async function* oggPacketsRaw(src, start) {
    let pos = start;
    let partial = [];
    while (pos + 27 <= src.size) {
      const h = await src.read(pos, 27);
      if (ascii(h, 0, 4) !== 'OggS') throw fail('FORMAT', tx('audio.oggBad'));
      const nseg = h[26];
      const table = await src.read(pos + 27, nseg);
      let body = 0;
      for (let i = 0; i < nseg; i++) body += table[i];
      const data = await src.read(pos + 27 + nseg, body);
      const granule = Number(new DataView(h.buffer, h.byteOffset).getBigInt64(6, true));
      const packets = [];
      let off = 0;
      for (let i = 0; i < nseg; i++) {
        partial.push(data.subarray(off, off + table[i]));
        off += table[i];
        if (table[i] < 255) {
          const len = partial.reduce((n, x) => n + x.length, 0);
          const pk = new Uint8Array(len);
          let o = 0;
          for (const x of partial) {
            pk.set(x, o);
            o += x.length;
          }
          packets.push(pk);
          partial = [];
        }
      }
      pos += 27 + nseg + body;
      yield { packets, granule, offset: pos };
    }
  }

  /** Durée d'un paquet Opus en échantillons à 48 kHz, d'après son octet TOC (RFC 6716). */
  function opusSamples(pk) {
    if (!pk.length) return 0;
    const config = pk[0] >> 3;
    const size =
      config < 12
        ? [480, 960, 1920, 2880][config & 3]
        : config < 16
          ? [480, 960][config & 1]
          : [120, 240, 480, 960][config & 3];
    const code = pk[0] & 3;
    const frames = code === 0 ? 1 : code === 3 ? pk[1] & 0x3f : 2;
    return size * frames;
  }

  async function openOgg(src) {
    const it = oggPacketsRaw(src, 0);
    const first = (await it.next()).value;
    const head = first && first.packets[0];
    if (!head || ascii(head, 0, 8) !== 'OpusHead') {
      // Vorbis, FLAC dans Ogg... : décodage complet par le navigateur
      return { fallback: true };
    }
    const channels = head[9];
    const preSkip = head[10] | (head[11] << 8);
    // Durée exacte : position (granule) de la dernière page
    let duration = null;
    const tailLen = Math.min(src.size, 65536);
    const tail = await src.read(src.size - tailLen, tailLen);
    for (let p = tail.length - 27; p >= 0; p--) {
      if (tail[p] === 0x4f && ascii(tail, p, 4) === 'OggS') {
        const g = Number(new DataView(tail.buffer, tail.byteOffset).getBigInt64(p + 6, true));
        if (g > 0) duration = (g - preSkip) / 48000;
        break;
      }
    }
    return {
      codec: 'opus',
      description: head.slice(),
      sampleRate: 48000,
      channels,
      duration,
      packets: (from) => oggOpusPackets(src, from),
    };
  }

  async function* oggOpusPackets(src, from) {
    let t = 0;
    let headers = 2; // OpusHead puis OpusTags, qui ne sont pas du son
    for await (const page of oggPacketsRaw(src, 0)) {
      const batch = [];
      for (const pk of page.packets) {
        if (headers > 0) {
          headers--;
          continue;
        }
        if (t >= from) batch.push({ data: pk, timestamp: t });
        t += (opusSamples(pk) * 1e6) / 48000;
      }
      if (batch.length) yield { packets: batch, offset: page.offset };
    }
  }

  // ---------------------------------------------------------------------------
  // WebM (Matroska) Opus : éléments EBML, blocs de la piste audio
  // ---------------------------------------------------------------------------
  const EBML = {
    SEGMENT: 0x18538067,
    CLUSTER: 0x1f43b675,
    TRACKS: 0x1654ae6b,
    TRACK: 0xae,
    TRACK_NUMBER: 0xd7,
    TRACK_TYPE: 0x83,
    CODEC_ID: 0x86,
    CODEC_PRIVATE: 0x63a2,
    AUDIO: 0xe1,
    RATE: 0xb5,
    CHANNELS: 0x9f,
    INFO: 0x1549a966,
    SCALE: 0x2ad7b1,
    DURATION: 0x4489,
    DATE: 0x4461,
    TIMECODE: 0xe7,
    SIMPLE_BLOCK: 0xa3,
    BLOCK_GROUP: 0xa0,
    BLOCK: 0xa1,
  };
  // Éléments « conteneurs » : on y entre au lieu de les sauter
  const MASTER = new Set([
    EBML.SEGMENT,
    EBML.CLUSTER,
    EBML.TRACKS,
    EBML.TRACK,
    EBML.AUDIO,
    EBML.INFO,
    EBML.BLOCK_GROUP,
  ]);
  // Éléments dont le contenu sert ; tous les autres (index, pièces jointes...) sont sautés sans être lus
  const WANTED = new Set([
    EBML.TRACK_NUMBER,
    EBML.TRACK_TYPE,
    EBML.CODEC_ID,
    EBML.CODEC_PRIVATE,
    EBML.RATE,
    EBML.CHANNELS,
    EBML.SCALE,
    EBML.DURATION,
    EBML.DATE,
    EBML.TIMECODE,
    EBML.SIMPLE_BLOCK,
    EBML.BLOCK,
  ]);

  /** Lit un entier EBML (identifiant ou taille) ; retourne [valeur, longueur, tailleInconnue]. */
  function vint(b, p, keepMarker) {
    const first = b[p];
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8 || p + len > b.length) return null;
    let value = keepMarker ? first : first & (0xff >> len);
    let allOnes = value === 0xff >> len;
    for (let i = 1; i < len; i++) {
      value = value * 256 + b[p + i];
      if (b[p + i] !== 0xff) allOnes = false;
    }
    return [value, len, !keepMarker && allOnes];
  }

  /** Parcours linéaire des éléments EBML (les tailles « inconnues » des enregistreurs sont gérées). */
  async function* ebmlWalk(src, start) {
    let pos = start;
    const BLOCK = 1024 * 1024;
    let buf = new Uint8Array(0);
    let bufAt = 0;
    const ensure = async (p, n) => {
      if (p >= bufAt && p + n <= bufAt + buf.length) return true;
      if (p >= src.size) return false;
      buf = await src.read(p, Math.min(Math.max(n, BLOCK), src.size - p));
      bufAt = p;
      return p + n <= bufAt + buf.length;
    };
    while (await ensure(pos, 12)) {
      const id = vint(buf, pos - bufAt, true);
      if (!id) break;
      const size = vint(buf, pos - bufAt + id[1], false);
      if (!size) break;
      const hdr = id[1] + size[1];
      const unknown = size[2];
      if (MASTER.has(id[0])) {
        yield { id: id[0], master: true, offset: pos };
        pos += hdr;
        continue;
      }
      if (unknown) throw fail('FORMAT', tx('audio.webmBad'));
      const len = size[0];
      if (!WANTED.has(id[0])) {
        pos += hdr + len;
        continue;
      }
      if (!(await ensure(pos + hdr, len))) break;
      yield { id: id[0], data: buf.subarray(pos - bufAt + hdr, pos - bufAt + hdr + len), offset: pos + hdr + len };
      pos += hdr + len;
    }
  }

  const uint = (d) => d.reduce((n, x) => n * 256 + x, 0);
  const float = (d) => {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    return d.length === 4 ? v.getFloat32(0) : v.getFloat64(0);
  };

  async function openWebm(src) {
    let track = null;
    let current = null;
    let scale = 1e6;
    let durationTicks = null;
    let recordedAt = null;
    let firstCluster = null;
    for await (const el of ebmlWalk(src, 0)) {
      if (el.id === EBML.TRACK && el.master) current = {};
      else if (current && el.id === EBML.TRACK_NUMBER) current.number = uint(el.data);
      else if (current && el.id === EBML.TRACK_TYPE) current.type = uint(el.data);
      else if (current && el.id === EBML.CODEC_ID) current.codec = ascii(el.data, 0, el.data.length);
      else if (current && el.id === EBML.CODEC_PRIVATE) current.private = el.data.slice();
      else if (current && el.id === EBML.RATE) current.rate = float(el.data);
      else if (current && el.id === EBML.CHANNELS) current.channels = uint(el.data);
      else if (el.id === EBML.SCALE) scale = uint(el.data);
      else if (el.id === EBML.DURATION) durationTicks = float(el.data);
      else if (el.id === EBML.DATE) {
        // Nanosecondes depuis le 1er janvier 2001
        const ns = new DataView(el.data.buffer, el.data.byteOffset).getBigInt64(0);
        recordedAt = Date.UTC(2001, 0, 1) + Number(ns / 1000000n);
      } else if (el.id === EBML.CLUSTER) {
        firstCluster = el.offset;
        break;
      }
      if (current && current.type === 2 && current.codec && !track) track = current;
    }
    if (!track) throw fail('FORMAT', tx('audio.webmNoTrack'));
    if (track.codec !== 'A_OPUS') return { fallback: true };
    return {
      codec: 'opus',
      description: track.private,
      sampleRate: 48000,
      channels: track.channels || 2,
      recordedAt,
      duration: durationTicks ? (durationTicks * scale) / 1e9 : null,
      packets: (from) => webmPackets(src, firstCluster, track.number, scale, from),
    };
  }

  async function* webmPackets(src, start, trackNumber, scale, from) {
    let cluster = 0;
    let batch = [];
    for await (const el of ebmlWalk(src, start)) {
      if (el.id === EBML.TIMECODE) cluster = uint(el.data);
      else if (el.id === EBML.SIMPLE_BLOCK || el.id === EBML.BLOCK) {
        const d = el.data;
        const tn = vint(d, 0, false);
        if (!tn || tn[0] !== trackNumber) continue;
        const rel = new DataView(d.buffer, d.byteOffset + tn[1]).getInt16(0);
        if (d[tn[1] + 2] & 0x06) throw fail('CODEC', tx('audio.webmLacing'));
        const t = ((cluster + rel) * scale) / 1000;
        if (t >= from) batch.push({ data: d.subarray(tn[1] + 3), timestamp: t });
        if (batch.length >= 500) {
          yield { packets: batch, offset: el.offset };
          batch = [];
        }
      }
    }
    if (batch.length) yield { packets: batch, offset: src.size };
  }

  // ---------------------------------------------------------------------------
  // Décodage en flux, côté navigateur
  // ---------------------------------------------------------------------------

  /** Source de lecture sur un fichier choisi par l'utilisateur (lu par morceaux). */
  function fileSource(file) {
    return cached({
      size: file.size,
      read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
    });
  }

  /**
   * Lectures groupées par blocs de 1 Mo : les lecteurs Ogg et WebM lisent page par page ou élément
   * par élément ; sans ce cache, une heure d'enregistrement ferait des milliers d'accès au fichier.
   */
  function cached(src) {
    const BLOCK = 1024 * 1024;
    let buf = new Uint8Array(0);
    let at = 0;
    return {
      size: src.size,
      read: async (offset, length) => {
        length = Math.max(0, Math.min(length, src.size - offset));
        if (offset >= at && offset + length <= at + buf.length) return buf.subarray(offset - at, offset - at + length);
        if (length >= BLOCK) return src.read(offset, length);
        buf = await src.read(offset, Math.min(BLOCK, src.size - offset));
        at = offset;
        return buf.subarray(0, length);
      },
    };
  }

  /** Mélange les plans d'un AudioData en mono. */
  function monoOf(data) {
    const n = data.numberOfFrames;
    const ch = data.numberOfChannels;
    const out = new Float32Array(n);
    const plane = new Float32Array(n);
    for (let c = 0; c < ch; c++) {
      data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
      for (let i = 0; i < n; i++) out[i] += plane[i] / ch;
    }
    return out;
  }

  /**
   * Décode un fichier en morceaux de son 16 kHz mono (Float32Array), dans l'ordre.
   * options : { signal, onInfo(info), onProgress(ratio) }. Le consommateur ralentit le décodage
   * simplement en tardant à demander le morceau suivant (mémoire bornée).
   */
  async function* decode(file, options) {
    const o = options || {};
    const src = fileSource(file);
    src.cached = true;
    const info = await open(src);
    const meta = {
      format: info.format,
      duration: info.duration || null,
      recordedAt: info.recordedAt || null,
      sampleRate: info.sampleRate || null,
      channels: info.channels || null,
      method: info.pcm ? 'pcm' : info.fallback ? 'complet' : 'webcodecs',
    };
    const check = () => {
      if (o.signal && o.signal.aborted) throw fail('ABORT', tx('import.aborted'));
    };

    if (info.pcm) {
      if (o.onInfo) o.onInfo(meta);
      const resampler = new Lowsper.Resampler(info.sampleRate);
      const frame = (info.bits / 8) * info.channels;
      const step = frame * info.sampleRate * 10; // 10 s par morceau
      for (let p = 0; p < info.dataBytes; p += step) {
        check();
        const bytes = await src.read(info.dataOffset + p, Math.min(step, info.dataBytes - p));
        yield resampler.process(pcmToMono(bytes, info));
        if (o.onProgress) o.onProgress(Math.min(1, (p + step) / info.dataBytes));
      }
      return;
    }

    let useFallback = !!info.fallback;
    if (!useFallback) {
      const config = { codec: info.codec, sampleRate: info.sampleRate, numberOfChannels: info.channels };
      if (info.description) config.description = info.description;
      const support =
        typeof AudioDecoder !== 'undefined' ? await AudioDecoder.isConfigSupported(config).catch(() => null) : null;
      if (support && support.supported) {
        if (o.onInfo) o.onInfo(meta);
        yield* decodeStream(src, info, config, o, check);
        return;
      }
      useFallback = true;
    }
    if (useFallback) {
      if (file.size > FALLBACK_MAX_BYTES) {
        throw fail('TROP_LONG', tx('audio.tooLong'));
      }
      meta.method = 'complet';
      if (o.onInfo) o.onInfo(meta);
      check();
      let buffer;
      try {
        const ctx = new OfflineAudioContext(1, 1, RATE);
        buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      } catch (e) {
        throw fail('CODEC', tx('audio.unknownFormat'));
      }
      meta.duration = buffer.duration;
      if (o.onInfo) o.onInfo(meta);
      const step = RATE * 10;
      for (let p = 0; p < buffer.length; p += step) {
        check();
        const n = Math.min(step, buffer.length - p);
        const out = new Float32Array(n);
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const d = buffer.getChannelData(c);
          for (let i = 0; i < n; i++) out[i] += d[p + i] / buffer.numberOfChannels;
        }
        yield out;
        if (o.onProgress) o.onProgress(Math.min(1, (p + n) / buffer.length));
      }
    }
  }

  /** Décodage WebCodecs : quelques centaines de trames à la fois, sorties rendues dans l'ordre. */
  async function* decodeStream(src, info, config, o, check) {
    const ready = [];
    let failure = null;
    const resampler = new Lowsper.Resampler(info.sampleRate);
    const decoder = new AudioDecoder({
      output: (data) => {
        try {
          ready.push(resampler.process(monoOf(data)));
        } finally {
          data.close();
        }
      },
      error: (e) => (failure = e),
    });
    decoder.configure(config);
    const take = () => {
      if (failure) throw fail('CODEC', tx('audio.decoderFailed', { error: failure.message }));
      if (!ready.length) return null;
      const n = ready.reduce((s, x) => s + x.length, 0);
      const out = new Float32Array(n);
      let p = 0;
      for (const x of ready.splice(0)) {
        out.set(x, p);
        p += x.length;
      }
      return out;
    };
    try {
      for await (const group of info.packets(0)) {
        check();
        for (const pk of group.packets) {
          decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(pk.timestamp), data: pk.data }));
          // File du décodeur bornée : on attend qu'il avance plutôt que de tout lui confier
          while (decoder.decodeQueueSize > 64) await new Promise((r) => setTimeout(r, 0));
        }
        while (decoder.decodeQueueSize > 0) await new Promise((r) => setTimeout(r, 0));
        const out = take();
        if (out && out.length) yield out;
        if (o.onProgress) o.onProgress(Math.min(1, group.offset / src.size));
      }
      await decoder.flush();
      const out = take();
      if (out && out.length) yield out;
      if (o.onProgress) o.onProgress(1);
    } finally {
      if (decoder.state !== 'closed') decoder.close();
    }
  }

  Lowsper.AudioFile = { detect, open, decode, cached, pcmToMono, opusSamples, mp3Frame, adtsFrame, FALLBACK_MAX_BYTES };
})();
