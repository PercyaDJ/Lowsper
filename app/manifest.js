/* Fichier généré par tools/build.mjs : ne pas modifier à la main. */
self.LOWSPER_MANIFEST={
  "builtAt": "2026-10-03T15:40:48.311Z",
  "runtime": {
    "src": "engine/runtime.js",
    "bytes": 500182
  },
  "wasm": [
    {
      "src": "engine/ort-wasm.part0.js",
      "bytes": 14264838
    }
  ],
  "models": [
    {
      "id": "whisper-base",
      "label": "Whisper base (multilingue, ~77 Mo)",
      "repo": "onnx-community/whisper-base",
      "config": "models/whisper-base/config.js",
      "files": {
        "onnx/encoder_model_quantized.onnx": [
          {
            "src": "models/whisper-base/encoder_model_quantized.part0.js",
            "bytes": 23201314
          }
        ],
        "onnx/decoder_model_merged_quantized.onnx": [
          {
            "src": "models/whisper-base/decoder_model_merged_quantized.part0.js",
            "bytes": 25165824
          },
          {
            "src": "models/whisper-base/decoder_model_merged_quantized.part1.js",
            "bytes": 25165824
          },
          {
            "src": "models/whisper-base/decoder_model_merged_quantized.part2.js",
            "bytes": 3361667
          }
        ]
      }
    }
  ]
};
