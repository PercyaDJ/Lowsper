// Catalogue des modèles utilisables par Lowsper.
// dtype : quantification de chaque partie (q8 = int8, q4 = 4 bits), même convention que transformers.js.

const SUFFIX = { fp32: '', q8: '_quantized', q4: '_q4', int8: '_int8', fp16: '_fp16' };
const JSON_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
];

function def(id, repo, label, dtype, description = '', recommended = false, device = 'wasm') {
  return {
    id,
    repo,
    revision: 'main',
    label,
    description,
    recommended,
    device,
    dtype,
    files: [
      ...JSON_FILES,
      ...Object.entries(dtype).map(([part, q]) => `onnx/${part}${SUFFIX[q]}.onnx`),
    ],
  };
}

// Mesures détaillées dans decision.md (§4). Seuls whisper-small et whisper-base sont proposés
// dans l'application ; les autres restent ici pour pouvoir refaire la comparaison (test/eval.mjs).
export const MODELS = Object.fromEntries(
  [
    def('whisper-small', 'onnx-community/whisper-small', 'Whisper small', { encoder_model: 'q8', decoder_model_merged: 'q8' },
      'Précis en français, retrouve bien les sigles grâce au glossaire. Pour un PC portable récent.', true),
    def('whisper-base', 'onnx-community/whisper-base', 'Whisper base', { encoder_model: 'q8', decoder_model_merged: 'q8' },
      'Environ 3 fois plus rapide mais nettement moins précis. Pour un PC ancien ou très chargé.'),
    def('whisper-small-q4', 'onnx-community/whisper-small', 'Whisper small (4 bits)', { encoder_model: 'q8', decoder_model_merged: 'q4' }),
    def('whisper-small-fr', 'onnx-community/whisper-small-cv11-french-ONNX', 'Whisper small français', { encoder_model: 'q8', decoder_model_merged: 'q4' }),
    def('whisper-turbo', 'onnx-community/whisper-large-v3-turbo', 'Whisper large-v3 turbo', { encoder_model: 'q4', decoder_model_merged: 'q4' },
      'Le plus précis (noms propres, sigles, voix difficiles). Utilise la carte graphique : réservé aux PC compatibles.', false, 'webgpu'),
    // Variante processeur, uniquement pour les mesures de qualité (trop lente en usage réel)
    def('whisper-turbo-cpu', 'onnx-community/whisper-large-v3-turbo', 'Whisper large-v3 turbo (processeur)', { encoder_model: 'q4', decoder_model_merged: 'q4' }),
  ].map((m) => [m.id, m])
);

export const DEFAULT_MODEL = 'whisper-small';
