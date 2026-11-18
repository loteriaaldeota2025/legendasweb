// Roda o Whisper (transcrição) fora da tela principal, para a interface não travar.
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";

const MODELOS = {
  base: { id: "onnx-community/whisper-base_timestamped", gpu: { encoder_model: "fp32", decoder_model_merged: "q4" } },
  small: { id: "onnx-community/whisper-small_timestamped", gpu: { encoder_model: "fp32", decoder_model_merged: "q4" } },
  turbo: { id: "onnx-community/whisper-large-v3-turbo_timestamped", gpu: { encoder_model: "fp16", decoder_model_merged: "q4" } },
};
let carregado = { chave: "", pipe: null, aparelho: "" };

async function temGPU() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

async function carregar(nome, avisar) {
  if (carregado.chave === nome && carregado.pipe) return carregado;
  const m = MODELOS[nome] || MODELOS.small;
  const arquivos = {};
  const progresso = (p) => {
    if (p.status !== "progress" || !p.total) return;
    arquivos[p.file] = [p.loaded, p.total];
    const [feito, total] = Object.values(arquivos).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
    avisar({ tipo: "baixando", pct: Math.round((100 * feito) / total), mb: Math.round(total / 1e6) });
  };
  const tentativas = (await temGPU()) ? [["webgpu", m.gpu], ["wasm", "q8"]] : [["wasm", "q8"]];
  let erro;
  for (const [device, dtype] of tentativas) {
    try {
      const pipe = await pipeline("automatic-speech-recognition", m.id, { device, dtype, progress_callback: progresso });
      carregado = { chave: nome, pipe, aparelho: device };
      return carregado;
    } catch (e) { erro = e; console.warn(`Whisper em ${device} falhou`, e); }
  }
  throw erro;
}

self.onmessage = async ({ data }) => {
  const avisar = (m) => self.postMessage({ id: data.id, ...m });
  try {
    const { pipe, aparelho } = await carregar(data.modelo, avisar);
    avisar({ tipo: "transcrevendo", aparelho });
    const saida = await pipe(data.audio, {
      language: "portuguese", task: "transcribe", return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5,
    });
    const palavras = (saida.chunks || []).map((c) => ({ texto: c.text.trim(), inicio: c.timestamp[0], fim: c.timestamp[1] }))
      .filter((p) => p.texto);
    avisar({ tipo: "pronto", palavras, aparelho });
  } catch (e) {
    avisar({ tipo: "erro", mensagem: String(e && e.message || e) });
  }
};
