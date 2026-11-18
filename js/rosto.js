// Lê o vídeo no navegador: tamanho, duração, miniatura e a faixa vertical onde fica o rosto de quem fala.

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3";
const MODELO = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
let detectorPronto = null;

function carregarDetector() {
  detectorPronto ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
    const arquivos = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    return FaceDetector.createFromOptions(arquivos, {
      baseOptions: { modelAssetPath: MODELO }, runningMode: "IMAGE", minDetectionConfidence: 0.5,
    });
  })();
  detectorPronto.catch(() => { detectorPronto = null; });
  return detectorPronto;
}

const esperar = (alvo, evento, ms) => new Promise((ok, erro) => {
  const t = setTimeout(() => erro(new Error("tempo esgotado")), ms);
  alvo.addEventListener(evento, () => { clearTimeout(t); ok(); }, { once: true });
});

const percentil = (lista, p) => {
  const o = [...lista].sort((a, b) => a - b), i = (o.length - 1) * p, a = Math.floor(i);
  return o[a] + (o[Math.min(a + 1, o.length - 1)] - o[a]) * (i - a);
};

/** Maior rosto do quadro (quem está falando), em frações da altura: [topo, base]. */
function rostoNoQuadro(detector, quadro) {
  const W = quadro.width, H = quadro.height, lado = Math.min(W, H);
  const recorte = document.createElement("canvas");
  recorte.width = recorte.height = 384;
  const ctx = recorte.getContext("2d");
  // o detector enxerga melhor rostos grandes: além do quadro inteiro, testa quadrados (topo, meio, base)
  const janelas = [{ y: 0, alt: H }, ...(H > W * 1.2 ? [0, (H - lado) / 2, H - lado].map((y) => ({ y, alt: lado })) : [])];
  let melhor = null;
  for (const j of janelas) {
    let fonte = quadro, k = 1;
    if (j.alt !== H) {
      ctx.drawImage(quadro, 0, j.y, lado, lado, 0, 0, 384, 384);
      fonte = recorte; k = lado / 384;
    }
    for (const d of detector.detect(fonte).detections) {
      const c = d.boundingBox, alt = c.height * k, y = c.originY * k + j.y;
      if (alt < H * 0.03) continue;
      if (!melhor || alt > melhor.alt) melhor = { y, alt };
    }
  }
  // a caixa pega só o rosto: estende para o cabelo (em cima) e o queixo (embaixo)
  return melhor && [(melhor.y - 0.45 * melhor.alt) / H, (melhor.y + 1.2 * melhor.alt) / H];
}

export async function analisarVideo(url) {
  const video = document.createElement("video");
  video.muted = true; video.preload = "auto"; video.playsInline = true; video.src = url;
  try {
    await Promise.race([esperar(video, "loadeddata", 20000), esperar(video, "error", 20000).then(() => { throw new Error("erro"); })]);
  } catch {
    throw new Error("Este navegador não conseguiu abrir o vídeo. Tente no Chrome ou Edge, ou converta para MP4.");
  }
  const largura = video.videoWidth, altura = video.videoHeight, duracao = video.duration;
  if (!largura || !isFinite(duracao)) throw new Error("Não consegui ler o tamanho ou a duração do vídeo.");

  const quadro = document.createElement("canvas");
  quadro.height = Math.min(960, altura); quadro.width = Math.round(quadro.height * largura / altura);
  const ctx = quadro.getContext("2d", { willReadFrequently: true });
  let detector = null;
  try { detector = await carregarDetector(); } catch (e) { console.warn("detector de rosto indisponível", e); }

  // amostras: o vídeo inteiro (até 24) + de 0,25 em 0,25 s nos primeiros 5 s, que é quando a headline aparece
  const n0 = Math.max(3, Math.min(24, Math.ceil(duracao * 2)));
  const tempos = Array.from({ length: n0 }, (_, i) => (duracao * (i + 0.5)) / n0);
  for (let t = 0.1; t < Math.min(5, duracao); t += 0.25) tempos.push(t);
  tempos.sort((a, b) => a - b);
  const n = tempos.length, amostras = [];
  const topos = [], bases = [];
  let miniatura = "";
  for (const tempo of tempos) {
    video.currentTime = Math.min(duracao - 0.05, tempo);
    try { await esperar(video, "seeked", 5000); } catch { continue; }
    ctx.drawImage(video, 0, 0, quadro.width, quadro.height);
    if (!miniatura) {
      const m = document.createElement("canvas");
      m.height = 96; m.width = Math.round(96 * largura / altura);
      m.getContext("2d").drawImage(quadro, 0, 0, m.width, m.height);
      miniatura = m.toDataURL("image/jpeg", 0.7);
    }
    const r = detector && rostoNoQuadro(detector, quadro);
    if (r) { topos.push(r[0]); bases.push(r[1]); amostras.push({ t: tempo, topo: r[0], base: r[1] }); }
  }
  video.removeAttribute("src"); video.load();

  // percentis 10 e 90: acompanha o movimento sem deixar uma detecção errada isolada esticar a faixa
  const rosto = topos.length >= 2 || (topos.length && n <= 4)
    ? [Math.max(0, percentil(topos, 0.1)), Math.min(1, percentil(bases, 0.9))]
    : null;
  return { largura, altura, duracao, rosto, amostras, miniatura, quadrosComRosto: topos.length, quadros: n };
}

/** Faixa do rosto só no trecho em que a headline aparece (0 até `segundos`); sem limite = vídeo inteiro. */
export function rostoAte(v, segundos) {
  if (!segundos || !v.amostras) return v.rosto;
  const trecho = v.amostras.filter((a) => a.t <= segundos + 0.3);
  if (!trecho.length) return null;
  return [Math.max(0, Math.min(...trecho.map((a) => a.topo))), Math.min(1, Math.max(...trecho.map((a) => a.base)))];
}
