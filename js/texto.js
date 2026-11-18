// Texto da legenda: correções automáticas, divisão em blocos e sugestões de headline sem IA.

export const CORRECOES_PADRAO = [
  "odelto = Aldeota",
  "aldeia = Aldeota",
  "autofast = Lotofácil",
  "loto fácil = Lotofácil",
  "tem malzinha = Teimosinha",
  "casa do térico = casa lotérica",
].join("\n");

const PALAVRAS_POR_BLOCO = 3, CARACTERES_POR_BLOCO = 18;
const norm = (t) => t.trim().toLowerCase().normalize("NFC").replace(/^[.,?!;:]+|[.,?!;:]+$/g, "");

/** "errado = certo" por linha -> regras ordenadas da mais longa para a mais curta. */
export function lerCorrecoes(texto) {
  return (texto || "").split("\n").map((l) => l.split("=")).filter((p) => p.length === 2 && p[0].trim() && p[1].trim())
    .map(([de, para]) => ({ de: de.trim().split(/\s+/).map(norm), para: para.trim().split(/\s+/) }))
    .sort((a, b) => b.de.length - a.de.length);
}

/** Junta pedaços que o Whisper separa: "R" "$" "3" ",50" -> "R$" "3,50"; "lembre" "-se" -> "lembre-se". */
function colarPedacos(palavras) {
  const saida = [];
  for (const p of palavras) {
    const ant = saida.at(-1);
    if (ant && (/^([-,.]\S|\$)/.test(p.texto) || (/^\d/.test(p.texto) && /\d,$/.test(ant.texto)))) {
      ant.texto += p.texto; ant.fim = p.fim;
    } else saida.push({ ...p });
  }
  return saida;
}

export function corrigir(palavras, regras) {
  palavras = colarPedacos(palavras);
  const saida = [];
  for (let i = 0; i < palavras.length;) {
    const regra = regras.find((r) => r.de.every((d, k) => palavras[i + k] && norm(palavras[i + k].texto) === d));
    if (!regra) { saida.push(palavras[i++]); continue; }
    const trecho = palavras.slice(i, i + regra.de.length);
    const ini = trecho[0].inicio, fim = trecho.at(-1).fim, passo = (fim - ini) / regra.para.length;
    const pont = (trecho.at(-1).texto.match(/[.,?!;:]*$/) || [""])[0];
    regra.para.forEach((t, k) => saida.push({
      texto: t + (k === regra.para.length - 1 ? pont : ""), inicio: ini + k * passo, fim: ini + (k + 1) * passo,
    }));
    i += regra.de.length;
  }
  return saida;
}

export function montarBlocos(palavras) {
  const grupos = [];
  let atual = [];
  for (const p of palavras) {
    const chars = [...atual, p].map((x) => x.texto).join(" ").length;
    const grudado = atual.length && atual.at(-1).texto.endsWith("$");  // não separa "R$" do valor
    if (atual.length && !grudado && (atual.length >= PALAVRAS_POR_BLOCO || chars > CARACTERES_POR_BLOCO)) { grupos.push(atual); atual = []; }
    atual.push(p);
    if (/[.,?!;:]$/.test(p.texto)) { grupos.push(atual); atual = []; }
  }
  if (atual.length) grupos.push(atual);
  return grupos.map((g) => ({ ini: g[0].inicio, fim: g.at(-1).fim, palavras: g }));
}

export const textoDoBloco = (b) => b.palavras.map((p) => p.texto).join(" ");

/** Troca o texto de um bloco mantendo o tempo; se o nº de palavras mudar, redistribui por igual. */
export function aplicarTexto(bloco, texto) {
  const ps = texto.split(/\s+/).filter(Boolean);
  if (ps.length === bloco.palavras.length) { bloco.palavras.forEach((w, i) => { w.texto = ps[i]; }); return; }
  const passo = (bloco.fim - bloco.ini) / Math.max(1, ps.length);
  bloco.palavras = ps.map((t, i) => ({ texto: t, inicio: bloco.ini + i * passo, fim: bloco.ini + (i + 1) * passo }));
}

/** "Título_ Subtítulo.mp4" ou "Título - Subtítulo.mp4" -> pista de headline. Nomes de câmera (IMG_1234) não contam. */
export function pistaDoNome(nome) {
  const base = nome.replace(/\.[^.]+$/, "");
  if (/^(IMG|VID|MVI|DSC|PXL|MOV|WhatsApp|video|Screen)[\s_-]*[\dA-Z_-]*/i.test(base) && !/[a-zà-ú]{4,}\s+[a-zà-ú]{2,}/i.test(base)) return { titulo: "", subtitulo: "" };
  const [titulo, subtitulo = ""] = base.split(/_\s+|\s+-\s+/, 2).map((s) => s.trim());
  return { titulo, subtitulo };
}

/** Sem IA: usa o nome do arquivo e trechos curtos da fala (prefere os que têm números). */
export function sugerirAutomatico(pista, texto) {
  const vistos = new Set();
  const trechos = texto.split(/[.,?!;:]/).map((t) => t.trim().split(/\s+/).filter(Boolean))
    .filter((p) => p.length >= 2 && p.length <= 6).map((p) => p.join(" "))
    .filter((t) => t.length <= 30 && !vistos.has(t.toLowerCase()) && vistos.add(t.toLowerCase()))
    .map((t) => ({ t: t[0].toUpperCase() + t.slice(1), nota: (/\d/.test(t) ? 3 : 0) + (t.split(" ").length >= 3 ? 1 : 0) }))
    .sort((a, b) => b.nota - a.nota).map((x) => x.t);
  const bons = [...trechos, "Assista até o final", "Você precisa saber disso", "Olha só essa novidade"];
  const curto = (t) => t.length <= 26;
  const titulo = pista.titulo || bons.find(curto);
  const resto = bons.filter((t) => t !== titulo);
  return [
    { titulo, subtitulo: pista.subtitulo || resto[0] },
    { titulo, subtitulo: pista.subtitulo ? resto[0] : resto[1] },
    { titulo: resto.find(curto) || titulo, subtitulo: resto.filter((t) => t !== resto.find(curto))[1] || "" },
  ];
}
