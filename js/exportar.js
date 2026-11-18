// Gera o MP4 final dentro do navegador: decodifica cada quadro, desenha legenda + headline por cima e codifica de novo.
import { desenhar, carregarFonte } from "./desenho.js";

const MB = "https://cdn.jsdelivr.net/npm/mediabunny@1.66.0/dist/bundles/mediabunny.min.mjs";

export const exportacaoSuportada = () => "VideoEncoder" in window && "VideoDecoder" in window;

/** v: o vídeo (com file, largura, altura e os dados de desenho). Devolve um Blob MP4. */
export async function exportar(v, { resolucao }, aoProgredir = () => {}) {
  if (!exportacaoSuportada()) throw new Error("Este navegador não exporta vídeo. Use o Chrome ou o Edge no computador.");
  const { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, QUALITY_HIGH } = await import(MB);
  await carregarFonte();

  // tamanho de saída: Full HD (lado menor = 1080) ou o original; sempre par
  const menor = Math.min(v.largura, v.altura);
  const k = resolucao === "original" ? 1 : Math.min(1, 1080 / menor);
  const W = Math.round((v.largura * k) / 2) * 2, H = Math.round((v.altura * k) / 2) * 2;

  const tela = new OffscreenCanvas(W, H);
  const ctx = tela.getContext("2d", { alpha: false });
  const entrada = new Input({ source: new BlobSource(v.file), formats: ALL_FORMATS });
  const saida = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });

  const conversao = await Conversion.init({
    input: entrada, output: saida, tracks: "primary",
    video: {
      width: W, height: H, fit: "fill", codec: "avc", quality: QUALITY_HIGH,
      allowTransformationMetadata: false,  // gira os quadros de verdade (vídeo de celular vem "deitado")
      forceTranscode: true,
      processedWidth: W, processedHeight: H,
      process: (quadro) => {
        quadro.draw(ctx, 0, 0, W, H);
        desenhar(ctx, W, H, quadro.timestamp, v);
        return tela;
      },
    },
  });
  if (!conversao.isValid) {
    const motivos = conversao.discardedTracks.map((d) => d.reason).join(", ");
    throw new Error(`Não foi possível exportar este vídeo neste navegador (${motivos || "formato não suportado"}).`);
  }
  if (conversao.discardedTracks.some((d) => d.track.type === "video")) {
    throw new Error("O navegador não consegue decodificar o vídeo deste arquivo. Tente no Chrome ou Edge.");
  }
  conversao.onProgress = (p) => aoProgredir(p);
  await conversao.execute();
  return new Blob([saida.target.buffer], { type: "video/mp4" });
}
