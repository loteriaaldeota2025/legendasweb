// Tira o áudio do vídeo (16 kHz, mono) e manda para o Whisper, que roda num worker.

const MB = "https://cdn.jsdelivr.net/npm/mediabunny@1.66.0/dist/bundles/mediabunny.min.mjs";
const TAXA = 16000;

function mono(buffer) {
  const saida = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const canal = buffer.getChannelData(c);
    for (let i = 0; i < saida.length; i++) saida[i] += canal[i] / buffer.numberOfChannels;
  }
  return saida;
}

/** Devolve Float32Array em 16 kHz mono, ou null se o vídeo não tiver áudio. */
export async function extrairAudio(arquivo) {
  // caminho rápido: o próprio navegador decodifica e já converte para 16 kHz
  if (arquivo.size < 1.2e9) {
    try {
      const ctx = new OfflineAudioContext(1, 1, TAXA);
      return mono(await ctx.decodeAudioData(await arquivo.arrayBuffer()));
    } catch (e) { console.warn("decodeAudioData falhou; lendo o áudio aos poucos", e); }
  }
  // reserva (arquivos grandes ou formatos que o caminho rápido não lê): lê o áudio aos poucos
  const { Input, ALL_FORMATS, BlobSource, AudioBufferSink } = await import(MB);
  const entrada = new Input({ source: new BlobSource(arquivo), formats: ALL_FORMATS });
  const trilha = await entrada.getPrimaryAudioTrack();
  if (!trilha) return null;
  const pedacos = [];
  let taxa = TAXA, total = 0;
  for await (const { buffer } of new AudioBufferSink(trilha).buffers()) {
    taxa = buffer.sampleRate;
    const m = mono(buffer);
    pedacos.push(m); total += m.length;
  }
  if (!total) return null;
  const junto = new Float32Array(total);
  let pos = 0;
  for (const p of pedacos) { junto.set(p, pos); pos += p.length; }
  if (taxa === TAXA) return junto;
  const off = new OfflineAudioContext(1, Math.ceil((total * TAXA) / taxa), TAXA);
  const origem = off.createBuffer(1, total, taxa);
  origem.copyToChannel(junto, 0);
  const no = off.createBufferSource();
  no.buffer = origem; no.connect(off.destination); no.start();
  return (await off.startRendering()).getChannelData(0);
}

let worker = null, seq = 0;
const pendentes = new Map();

function obterWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker-whisper.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    const p = pendentes.get(data.id);
    if (!p) return;
    if (data.tipo === "pronto") { pendentes.delete(data.id); p.ok(data); }
    else if (data.tipo === "erro") { pendentes.delete(data.id); p.erro(new Error(data.mensagem)); }
    else p.avisar(data);
  };
  worker.onerror = (e) => {
    for (const p of pendentes.values()) p.erro(new Error(e.message || "falha ao carregar a transcrição"));
    pendentes.clear(); worker = null;
  };
  return worker;
}

/** modelo: "base" | "small" | "turbo". avisar recebe {tipo:"baixando", pct, mb} e {tipo:"transcrevendo"}. */
export function transcrever(audio, modelo, avisar = () => {}) {
  return new Promise((ok, erro) => {
    const id = ++seq;
    pendentes.set(id, { ok, erro, avisar });
    obterWorker().postMessage({ id, audio, modelo });
  });
}
