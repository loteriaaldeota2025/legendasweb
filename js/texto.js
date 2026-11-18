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

// ---------------------------------------------------------------- nomes compostos e blocos
// Grafias fixas: marca, modalidades lotéricas e concursos especiais.
export const NOMES_PADRAO = "Rei do Bolão, Loteria Aldeota, Mega-Sena, Lotofácil, Quina, Lotomania, Dupla Sena, +Milionária, Mega da Virada, Quina de São João, Lotofácil da Independência";
// Termos comuns: minúsculas no meio da frase (o "Bolão" de "Rei do Bolão" é protegido por ser nome da marca).
const TERMOS_COMUNS = new Set(["bolão", "bolões", "cota", "cotas", "aposta", "apostas", "sorteio", "sorteios", "concurso", "concursos", "prêmio", "prêmios"]);

/** "Nome Um, Nome Dois" -> [["nome","um"], ["nome","dois"]] (minúsculas, sem pontuação). */
export function lerNomes(texto) {
  return (texto || "").split(/[,\n]/).map((n) => n.trim().split(/\s+/).filter(Boolean).map(norm)).filter((n) => n.length);
}

const LIGA = new Set(["de", "da", "do", "das", "dos", "e"]);
const UNIDADE = /^(mil|milh[ãa]o|milh[õo]es|bilh[ãa]o|bilh[õo]es)[.,?!;:]*$/i;
const maiuscula = (p) => !!p && /^[+"'(]?[A-ZÀ-Ý]/.test(p.texto);
const numero = (p) => !!p && /^\d/.test(p.texto);
const fechaFrase = (p) => /[.,?!;:]$/.test(p.texto);

/** Para cada palavra i, diz se ela NÃO pode ser separada da anterior (nome composto, "R$ 200 milhões" etc.). */
function grudadas(palavras, nomes) {
  const g = palavras.map(() => false), w = palavras;
  for (let i = 1; i < w.length; i++) {
    const a = w[i - 1], b = w[i];
    if (a.texto.endsWith("$")) { g[i] = true; continue; }                       // R$ + valor
    if (fechaFrase(a)) continue;
    if (numero(a) && UNIDADE.test(b.texto)) g[i] = true;                         // 200 + milhões
    else if (maiuscula(a) && maiuscula(b)) g[i] = true;                          // Loteria + Aldeota
    else if (maiuscula(a) && LIGA.has(norm(b.texto)) && maiuscula(w[i + 1])) g[i] = true;            // Rei + do (+ Bolão)
    else if (LIGA.has(norm(a.texto)) && maiuscula(b) && maiuscula(w[i - 2]) && !fechaFrase(w[i - 2])) g[i] = true;  // (Rei +) do + Bolão
  }
  // nomes da lista dos Ajustes, mesmo que a transcrição tenha vindo em minúsculas
  for (const nome of nomes) {
    if (nome.length < 2) continue;
    for (let i = 0; i + nome.length <= w.length; i++) {
      if (nome.every((n, k) => norm(w[i + k].texto) === n)) for (let k = 1; k < nome.length; k++) g[i + k] = true;
    }
  }
  return g;
}

const MAX_NOME = 5;  // um nome com mais palavras que isso é quebrado mesmo assim

export function montarBlocos(palavras, nomes = []) {
  const g = grudadas(palavras, nomes), grupos = [];
  let atual = [];  // índices das palavras do bloco em montagem
  const texto = (idx) => idx.map((i) => palavras[i].texto).join(" ");
  palavras.forEach((p, i) => {
    const cheio = atual.length >= PALAVRAS_POR_BLOCO || texto([...atual, i]).length > CARACTERES_POR_BLOCO;
    if (atual.length && cheio) {
      if (!g[i]) { grupos.push(atual); atual = []; }
      else {
        // a palavra nova continua um nome: corta ANTES do nome, para ele ficar inteiro no próximo bloco
        let k = atual.length - 1;
        while (k > 0 && g[atual[k]]) k--;
        if (k > 0) { grupos.push(atual.slice(0, k)); atual = atual.slice(k); }
        else if (atual.length >= MAX_NOME) { grupos.push(atual); atual = []; }
      }
    }
    atual.push(i);
    if (fechaFrase(p) && !(palavras[i + 1] && g[i + 1])) { grupos.push(atual); atual = []; }
  });
  if (atual.length) grupos.push(atual);
  return grupos.map((idx) => idx.map((i) => palavras[i])).map((gr) => ({ ini: gr[0].inicio, fim: gr.at(-1).fim, palavras: gr }));
}

// ---------------------------------------------------------------- padronização
const repartir = (trecho, textos) => {
  const ini = trecho[0].inicio, fim = trecho.at(-1).fim, passo = (fim - ini) / textos.length;
  return textos.map((t, k) => ({ texto: t, inicio: ini + k * passo, fim: ini + (k + 1) * passo }));
};

/** "200 milhões de reais" -> "R$ 200 milhões"; "50 reais" -> "R$ 50". Só quando o valor já está em numerais. */
export function padronizarDinheiro(palavras) {
  const saida = [], w = palavras;
  for (let i = 0; i < w.length;) {
    let j = i;
    if (/^\d[\d.,]*$/.test(w[j].texto) && !/[.,]$/.test(w[j].texto)) {
      j++;
      const unidade = w[j] && /^(mil|milh[ãa]o|milh[õo]es|bilh[ãa]o|bilh[õo]es)$/i.test(w[j].texto) ? w[j++].texto : "";
      if (unidade && w[j] && norm(w[j].texto) === "de" && !fechaFrase(w[j])) j++;
      if (w[j] && /^rea(l|is)[.,?!;:]*$/i.test(w[j].texto) && !(saida.at(-1)?.texto.endsWith("$"))) {
        const pont = (w[j].texto.match(/[.,?!;:]*$/) || [""])[0];
        const textos = ["R$", w[i].texto, ...(unidade ? [unidade] : [])];
        textos[textos.length - 1] += pont;
        saida.push(...repartir(w.slice(i, j + 1), textos));
        i = j + 1;
        continue;
      }
    }
    saida.push(w[i++]);
  }
  return saida;
}

/**
 * Impõe a grafia fixa dos nomes da lista (ex.: "rei do bolão" -> "Rei do Bolão", "mega sena" -> "Mega-Sena")
 * e põe os termos comuns em minúsculas no meio da frase ("o Bolão" -> "o bolão").
 */
export function padronizarNomes(palavras, textoNomes) {
  const nomes = (textoNomes || "").split(/[,\n]/).map((n) => n.trim()).filter(Boolean).flatMap((n) => {
    const canon = n.split(/\s+/), formas = [canon.map(norm)];
    if (n.includes("-")) formas.push(n.split(/[\s-]+/).map(norm), [norm(n.replace(/-/g, ""))]);  // "mega sena", "megasena"
    return formas.map((chave) => ({ canon, chave }));
  }).sort((a, b) => b.chave.length - a.chave.length);

  const saida = [], protegida = [];
  for (let i = 0; i < palavras.length;) {
    const nome = nomes.find((n) => n.chave.every((c, k) => palavras[i + k] && norm(palavras[i + k].texto) === c
      && (k === n.chave.length - 1 || !fechaFrase(palavras[i + k]))));
    if (!nome) { saida.push({ ...palavras[i++] }); protegida.push(false); continue; }
    const trecho = palavras.slice(i, i + nome.chave.length);
    const pont = (trecho.at(-1).texto.match(/[.,?!;:]*$/) || [""])[0];
    const textos = nome.canon.map((t, k) => t + (k === nome.canon.length - 1 ? pont : ""));
    const novas = textos.length === trecho.length ? trecho.map((p, k) => ({ ...p, texto: textos[k] })) : repartir(trecho, textos);
    saida.push(...novas); novas.forEach(() => protegida.push(true));
    i += nome.chave.length;
  }
  saida.forEach((p, i) => {
    const inicioDeFrase = i === 0 || /[.?!]$/.test(saida[i - 1].texto);
    if (!protegida[i] && !inicioDeFrase && TERMOS_COMUNS.has(norm(p.texto))) p.texto = p.texto.toLowerCase();
  });
  return saida;
}

/** Todas as padronizações que não dependem de IA. */
export const padronizar = (palavras, textoNomes) => padronizarNomes(padronizarDinheiro(palavras), textoNomes);

/** Aplica as trocas devolvidas pela IA: [{de, ate, texto}] substitui as palavras de..ate (índices, inclusive). */
export function aplicarTrocas(palavras, trocas) {
  const validas = (Array.isArray(trocas) ? trocas : [])
    .map((t) => ({ de: Number(t.de), ate: Number(t.ate), texto: String(t.texto ?? "").trim() }))
    .filter((t) => Number.isInteger(t.de) && Number.isInteger(t.ate) && t.de >= 0 && t.ate >= t.de && t.ate < palavras.length && t.ate - t.de < 12)
    .sort((a, b) => a.de - b.de);
  const saida = [];
  let pos = 0;
  for (const t of validas) {
    if (t.de < pos) continue;  // sobreposta a uma troca anterior: ignora
    saida.push(...palavras.slice(pos, t.de));
    const textos = t.texto.split(/\s+/).filter(Boolean);
    if (textos.length) saida.push(...repartir(palavras.slice(t.de, t.ate + 1), textos));
    pos = t.ate + 1;
  }
  saida.push(...palavras.slice(pos));
  return saida;
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
  const curto = (t) => t.length <= 22;
  const titulo = pista.titulo || bons.find(curto);
  const resto = bons.filter((t) => t !== titulo);
  return [
    { titulo, subtitulo: pista.subtitulo || resto[0] },
    { titulo, subtitulo: pista.subtitulo ? resto[0] : resto[1] },
    { titulo: resto.find(curto) || titulo, subtitulo: resto.filter((t) => t !== resto.find(curto))[1] || "" },
  ];
}
