// Point d'entrée du "runtime" embarqué dans le worker de transcription.
// esbuild le transforme en script classique (IIFE) exposant self.LowsperRuntime.
export { pipeline, env, Tensor } from '@huggingface/transformers';
