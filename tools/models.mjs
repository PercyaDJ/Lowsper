// Catalogue des modèles embarquables dans Lowsper.
// Chaque modèle est téléchargé une seule fois par le développeur (fetch-model.mjs),
// puis converti en fichiers .js par build.mjs pour être lisible depuis file://.

export const MODELS = {
  'whisper-base': {
    repo: 'onnx-community/whisper-base',
    revision: 'main',
    label: 'Whisper base (multilingue, ~77 Mo)',
    files: [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
    ],
  },
  'whisper-small': {
    repo: 'onnx-community/whisper-small',
    revision: 'main',
    label: 'Whisper small (multilingue, ~250 Mo, plus précis, ~3x plus lent)',
    files: [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
    ],
  },
};

export const DEFAULT_MODEL = 'whisper-base';
