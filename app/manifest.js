/* Fichier généré par tools/build.mjs : ne pas modifier à la main. */
self.LOWSPER_MANIFEST={
  "builtAt": "2026-10-12",
  "runtime": {
    "src": "engine/runtime.js",
    "bytes": 500261
  },
  "wasm": [
    {
      "src": "engine/ort-wasm.part0.js",
      "bytes": 14264838
    }
  ],
  "runtimes": {
    "cpu": {
      "src": "engine/runtime.js",
      "bytes": 500261,
      "wasm": [
        {
          "src": "engine/ort-wasm.part0.js",
          "bytes": 14264838
        }
      ]
    },
    "webgpu": {
      "src": "engine/runtime-webgpu.js",
      "bytes": 545171,
      "wasm": [
        {
          "src": "engine/ort-wasm-webgpu.part0.js",
          "bytes": 25165824
        },
        {
          "src": "engine/ort-wasm-webgpu.part1.js",
          "bytes": 1695953
        }
      ]
    }
  },
  "vad": [
    {
      "src": "engine/silero-vad.part0.js",
      "bytes": 1289603
    }
  ],
  "speaker": {
    "id": "wespeaker",
    "config": "engine/wespeaker-config.js",
    "files": {
      "onnx/model_quantized.onnx": [
        {
          "src": "engine/wespeaker.part0.js",
          "bytes": 6685134
        }
      ]
    }
  },
  "catalog": [
    {
      "id": "whisper-small",
      "label": "Whisper small",
      "description": "Précis en français, retrouve bien les sigles grâce au glossaire. Pour un PC portable récent.",
      "recommended": true,
      "device": "wasm",
      "repo": "onnx-community/whisper-small",
      "revision": "36050c46d777d46dc4b5f43f6d90574fc38f8732",
      "dtype": {
        "encoder_model": "q8",
        "decoder_model_merged": "q8"
      },
      "files": [
        {
          "path": "config.json",
          "size": 2227,
          "sha256": "457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18"
        },
        {
          "path": "generation_config.json",
          "size": 3893,
          "sha256": "f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0"
        },
        {
          "path": "preprocessor_config.json",
          "size": 339,
          "sha256": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"
        },
        {
          "path": "tokenizer.json",
          "size": 2480466,
          "sha256": "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"
        },
        {
          "path": "tokenizer_config.json",
          "size": 282683,
          "sha256": "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce"
        },
        {
          "path": "onnx/encoder_model_quantized.onnx",
          "size": 92326160,
          "sha256": "a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92"
        },
        {
          "path": "onnx/decoder_model_merged_quantized.onnx",
          "size": 156750845,
          "sha256": "ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9"
        }
      ]
    },
    {
      "id": "whisper-small-gpu",
      "label": "Whisper small (carte graphique)",
      "description": "Même modèle que Whisper small, calculé par la carte graphique : bien plus rapide si le PC en a une correcte.",
      "recommended": false,
      "device": "webgpu",
      "repo": "onnx-community/whisper-small",
      "revision": "36050c46d777d46dc4b5f43f6d90574fc38f8732",
      "dtype": {
        "encoder_model": "q4",
        "decoder_model_merged": "q4"
      },
      "files": [
        {
          "path": "config.json",
          "size": 2227,
          "sha256": "457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18"
        },
        {
          "path": "generation_config.json",
          "size": 3893,
          "sha256": "f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0"
        },
        {
          "path": "preprocessor_config.json",
          "size": 339,
          "sha256": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"
        },
        {
          "path": "tokenizer.json",
          "size": 2480466,
          "sha256": "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"
        },
        {
          "path": "tokenizer_config.json",
          "size": 282683,
          "sha256": "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce"
        },
        {
          "path": "onnx/encoder_model_q4.onnx",
          "size": 66182104,
          "sha256": "9f088ad0fe15ba2cf094c9fb22ac7fe1111fc9ef317c1e4d1f6a3bca38a931ba"
        },
        {
          "path": "onnx/decoder_model_merged_q4.onnx",
          "size": 233149327,
          "sha256": "795c61b344576719c2b249cc9911c78b4cc552c8c6a5407be21a3380a0791b13"
        }
      ]
    },
    {
      "id": "whisper-turbo",
      "label": "Whisper large-v3 turbo",
      "description": "Le plus précis (noms propres, sigles, voix difficiles). Utilise la carte graphique : réservé aux PC compatibles.",
      "recommended": false,
      "device": "webgpu",
      "repo": "onnx-community/whisper-large-v3-turbo",
      "revision": "360ebcde2559d60bb474678be3c1de9ef347d01a",
      "dtype": {
        "encoder_model": "q4",
        "decoder_model_merged": "q4"
      },
      "files": [
        {
          "path": "config.json",
          "size": 1332,
          "sha256": "35cd83669f75bc2867f3b3a4461850392d5e308cd6ea951c3700539883c28df1"
        },
        {
          "path": "generation_config.json",
          "size": 3897,
          "sha256": "16f95291d2f47c944d3c2b19390bba7965666555c1ea2a0bdc850d1fab45612f"
        },
        {
          "path": "preprocessor_config.json",
          "size": 340,
          "sha256": "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"
        },
        {
          "path": "tokenizer.json",
          "size": 2480617,
          "sha256": "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"
        },
        {
          "path": "tokenizer_config.json",
          "size": 282843,
          "sha256": "844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389"
        },
        {
          "path": "onnx/encoder_model_q4.onnx",
          "size": 424942775,
          "sha256": "7e64b20dd7b556cb7a2c1c65d9fbf31af985323c006f993d2a9dd10083547d78"
        },
        {
          "path": "onnx/decoder_model_merged_q4.onnx",
          "size": 334147222,
          "sha256": "8b933ac24074a24a1635084d06a4ed37e387ef22d980f184a5fc27418e9ceeb8"
        }
      ]
    },
    {
      "id": "whisper-base",
      "label": "Whisper base",
      "description": "Environ 3 fois plus rapide mais nettement moins précis. Pour un PC ancien ou très chargé.",
      "recommended": false,
      "device": "wasm",
      "repo": "onnx-community/whisper-base",
      "revision": "1846881b6b3a3024392c1eea3ad983695bc23925",
      "dtype": {
        "encoder_model": "q8",
        "decoder_model_merged": "q8"
      },
      "files": [
        {
          "path": "config.json",
          "size": 2243,
          "sha256": "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b"
        },
        {
          "path": "generation_config.json",
          "size": 3832,
          "sha256": "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0"
        },
        {
          "path": "preprocessor_config.json",
          "size": 339,
          "sha256": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"
        },
        {
          "path": "tokenizer.json",
          "size": 2480466,
          "sha256": "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"
        },
        {
          "path": "tokenizer_config.json",
          "size": 282682,
          "sha256": "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573"
        },
        {
          "path": "onnx/encoder_model_quantized.onnx",
          "size": 23201314,
          "sha256": "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46"
        },
        {
          "path": "onnx/decoder_model_merged_quantized.onnx",
          "size": 53693315,
          "sha256": "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b"
        }
      ]
    }
  ]
};
