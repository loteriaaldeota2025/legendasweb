// Desenha a headline e a legenda num canvas. O MESMO código serve para a prévia e para a exportação,
// então o que aparece na tela é o que sai no vídeo. Todas as medidas são proporcionais à largura (W).

export const FONTE = "Montserrat";
const fonte = (px, peso = 900) => `${peso} ${px}px "${FONTE}", "Arial Black", Arial, sans-serif`;
const medidor = document.createElement("canvas").getContext("2d");

export async function carregarFonte() {
  try {
    await Promise.all([document.fonts.load(fonte(40)), document.fonts.load(fonte(40, 800))]);
  } catch { /* usa a fonte reserva */ }
}

const voltar = (x) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };  // easeOutBack
const limitar = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const limpar = (t) => t.replace(/[,.;:]+$/, "").toUpperCase();

// ---------------------------------------------------------------- headline
function medirHeadline(ctx, W, h) {
  const item = (texto, base, peso) => {
    if (!texto || !texto.trim()) return null;
    const txt = texto.trim().toUpperCase();
    let tam = base;
    ctx.font = fonte(tam, peso);
    const larg = ctx.measureText(txt).width, max = W * 0.92 - tam * 1.1;
    if (larg > max) tam *= max / larg;  // texto longo: diminui a letra até caber
    ctx.font = fonte(tam, peso);
    return { txt, tam, peso, w: ctx.measureText(txt).width + tam * 1.1, h: tam * 1.75 };
  };
  const tit = item(h.titulo, W * 0.047, 900), sub = item(h.subtitulo, W * 0.032, 800);
  const gap = tit && sub ? W * 0.008 : 0;
  return { tit, sub, gap, alt: (tit ? tit.h : 0) + gap + (sub ? sub.h : 0) };
}

export const alturaHeadline = (W, headline) => medirHeadline(medidor, W, headline).alt;

function desenharHeadline(ctx, W, H, t, p) {
  const fim = p.headlineSegundos > 0 ? Math.min(p.headlineSegundos, p.duracao || Infinity) : Infinity;
  if (t > fim) return;
  const m = medirHeadline(ctx, W, p.headline);
  if (!m.tit && !m.sub) return;
  const esc = 0.8 + 0.2 * voltar(limitar(t / 0.22));       // entra "pulando"; já visível no 1º quadro
  const alfa = fim - t < 0.25 ? limitar((fim - t) / 0.25) : 1;
  let y = p.yHead * H;
  const caixa = (it, fundo, corTexto, giro) => {
    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.translate(W / 2, y + it.h / 2);
    ctx.rotate(giro);
    ctx.scale(esc, esc);
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = it.tam * 0.5; ctx.shadowOffsetY = it.tam * 0.18;
    ctx.fillStyle = fundo;
    ctx.beginPath(); ctx.roundRect(-it.w / 2, -it.h / 2, it.w, it.h, it.tam * 0.32); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.font = fonte(it.tam, it.peso); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = corTexto;
    ctx.fillText(it.txt, 0, it.tam * 0.36);
    ctx.restore();
    y += it.h + m.gap;
  };
  const c = p.cores;
  if (m.tit) caixa(m.tit, c.tituloFundo, c.tituloTexto, 0);
  if (m.sub) caixa(m.sub, c.subFundo, c.subTexto, -0.035);
}

// ---------------------------------------------------------------- legenda
export function blocoNoTempo(blocos, t) {
  for (let i = 0; i < blocos.length; i++) {
    const fim = Math.min(blocos[i].fim + 0.5, blocos[i + 1] ? blocos[i + 1].ini : Infinity);
    if (t >= blocos[i].ini && t < fim) return i;
  }
  return -1;
}

export const tamanhoLegenda = (W) => W * 0.06;

function desenharLegenda(ctx, W, H, t, p) {
  const bi = blocoNoTempo(p.blocos, t);
  if (bi < 0) return;
  const bloco = p.blocos[bi], pal = bloco.palavras.filter((w) => limpar(w.texto));
  if (!pal.length) return;
  let falada = 0;
  pal.forEach((w, j) => { if (t >= w.inicio) falada = j; });

  let tam = tamanhoLegenda(W);
  const max = W * 0.9;
  let linhas;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    ctx.font = fonte(tam);
    const esp = tam * 0.3;
    linhas = [];
    let linha = { itens: [], w: 0 };
    pal.forEach((w, j) => {
      const txt = limpar(w.texto), lw = ctx.measureText(txt).width;
      if (linha.itens.length && linha.w + esp + lw > max) { linhas.push(linha); linha = { itens: [], w: 0 }; }
      linha.itens.push({ txt, lw, j, x: linha.itens.length ? linha.w + esp : 0 });
      linha.w = linha.itens.at(-1).x + lw;
    });
    linhas.push(linha);
    const maior = Math.max(...linhas.map((l) => l.w));
    if (maior <= max && linhas.length <= 2) break;
    tam *= maior > max ? (max / maior) * 0.98 : 0.86;
  }

  const pop = 0.85 + 0.15 * (1 - Math.pow(1 - limitar((t - bloco.ini) / 0.12), 3));
  const altL = tam * 1.18;
  ctx.save();
  ctx.translate(W / 2, p.yLeg * H);
  ctx.scale(pop, pop);
  ctx.font = fonte(tam); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round"; ctx.lineWidth = tam * 0.24; ctx.strokeStyle = "#000";
  const cadaPalavra = (fn) => linhas.forEach((l, li) => l.itens.forEach((it) => {
    ctx.save();
    ctx.translate(-l.w / 2 + it.x + it.lw / 2, (li - (linhas.length - 1) / 2) * altL);
    if (it.j === falada) ctx.scale(1.1, 1.1);
    fn(it);
    ctx.restore();
  }));
  // primeiro todos os contornos, depois todos os preenchimentos (o contorno não cobre a palavra vizinha)
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = tam * 0.18; ctx.shadowOffsetY = tam * 0.07;
  cadaPalavra((it) => ctx.strokeText(it.txt, 0, tam * 0.36));
  ctx.shadowColor = "transparent";
  cadaPalavra((it) => { ctx.fillStyle = it.j === falada ? p.cores.destaque : "#fff"; ctx.fillText(it.txt, 0, tam * 0.36); });
  ctx.restore();
}

export function desenhar(ctx, W, H, t, p) {
  desenharHeadline(ctx, W, H, t, p);
  desenharLegenda(ctx, W, H, t, p);
}

// ---------------------------------------------------------------- posição (frações da altura, 0 a 1)
const sobrepoe = (a, b) => !!b && a[0] < b[1] && b[0] < a[1];

export function faixas(W, H, p) {
  const alt = alturaHeadline(W, p.headline) / H, meia = (tamanhoLegenda(W) * 1.5) / H;
  return { head: [p.yHead, p.yHead + alt], leg: [p.yLeg - meia, p.yLeg + meia] };
}

/** A headline cobre o rosto? `rostoHead` é a faixa do rosto só enquanto a headline está na tela. */
export const headlineSobreRosto = (W, H, p, rostoHead) => sobrepoe(faixas(W, H, p).head, rostoHead);

/**
 * Escolhe onde pôr a headline e a legenda.
 * Headline: o mais perto possível do centro da tela, logo acima ou logo abaixo do rosto, sem cobri-lo
 * (considera só o rosto durante o tempo em que ela aparece: `rostoHead`).
 * Legenda: terço inferior, sem cobrir o rosto em nenhum momento do vídeo (`rosto`) nem a headline.
 */
export function posicionar(W, H, rosto, rostoHead, headline) {
  const alt = alturaHeadline(W, headline) / H, altLeg = (tamanhoLegenda(W) * 2.7) / H;
  const margem = 0.016, topo = 0.05, base = 0.8;  // abaixo de 80% ficam os botões do Reels/TikTok
  const faixaLeg = (y) => [y - altLeg / 2 - margem, y + altLeg / 2 + margem];
  const candLeg = [0.66, 0.72, 0.6];
  if (rosto) candLeg.push(rosto[1] + margem + altLeg / 2);
  const legOk = (y, ocupado) => y + altLeg / 2 <= base + 0.04 && !sobrepoe(faixaLeg(y), rosto) && !sobrepoe(faixaLeg(y), ocupado);
  const yLegLivre = candLeg.find((y) => legOk(y)) ?? candLeg[0];
  if (!alt) return { yHead: topo, yLeg: yLegLivre };
  if (!rostoHead) return { yHead: Math.max(topo, 0.14), yLeg: yLegLivre };  // sem rosto detectado: fica no alto

  const opcoes = [];
  // acima do rosto
  const yAcima = rostoHead[0] - margem - alt;
  if (yAcima >= topo) opcoes.push({ yHead: yAcima, yLeg: yLegLivre });
  // abaixo do rosto: a legenda precisa caber sem encostar na headline (se não couber onde está, desce)
  const yAbaixo = rostoHead[1] + margem, fHead = [yAbaixo, yAbaixo + alt];
  if (fHead[1] <= base) {
    const yLeg = [yLegLivre, ...candLeg, fHead[1] + margem + altLeg / 2].find((y) => legOk(y, fHead));
    if (yLeg != null) opcoes.push({ yHead: yAbaixo, yLeg });
  }
  if (!opcoes.length) return { yHead: Math.min(Math.max(topo, yAcima), base - alt), yLeg: yLegLivre };
  const distancia = (o) => Math.abs(o.yHead + alt / 2 - 0.5);
  return opcoes.sort((a, b) => distancia(a) - distancia(b))[0];
}
