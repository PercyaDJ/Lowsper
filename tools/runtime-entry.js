// Point d'entrée du "runtime" embarqué dans les workers (transcription et analyse audio).
// esbuild le transforme en script classique (IIFE) exposant self.LowsperRuntime.
export { pipeline, env, Tensor, AutoProcessor, AutoModel } from '@huggingface/transformers';
// ONNX Runtime brut, pour les petits modèles pilotés directement (détection de parole)
export { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-web/webgpu';
