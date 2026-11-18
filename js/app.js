// Interface: fila de vídeos, prévia, editor e exportação. Tudo roda no navegador; não há servidor.
import * as T from "./texto.js";
import { desenhar, posicionar, faixas, headlineSobreRosto, carregarFonte, blocoNoTempo } from "./desenho.js";
import { analisarVideo, rostoAte } from "./rosto.js";
import { extrairAudio, transcrever } from "./transcricao.js";
import { exportar, exportacaoSuportada } from "./exportar.js";
import { sugerirIA, corrigirIA, testarChave } from "./headlines.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
// Cores da headline (barra lateral + caixas com o texto) e da palavra falada na legenda.
// "padrao" = caixas azuis com texto branco e barra laranja; "mega" = caixas brancas com texto e barra verdes.
const TEMAS = {
  padrao: { nome: "Azul e laranja", barra: "#F7941D", caixa: "#0F4FB5", texto: "#FFFFFF", destaque: "#F7941D" },
  mega: { nome: "Mega-Sena (branco e verde)", barra: "#0B8F47", caixa: "#FFFFFF", texto: "#0B8F47", destaque: "#3DDC84" },
};
const ehMega = (texto) => /mega/i.test(texto);
const ROTULO = { fila: "na fila", preparando: "preparando", revisar: "revisar", aguardando: "na fila p/ exportar", exportando: "exportando", pronto: "pronto", erro: "erro" };

// ---------------------------------------------------------------- ajustes (ficam neste navegador)
const PADRAO = { modelo: "small", resolucao: "1080", headline: "3", correcoes: T.CORRECOES_PADRAO, nomes: T.NOMES_PADRAO, chave: "" };
const cfg = { ...PADRAO };
try { Object.assign(cfg, JSON.parse(localStorage.getItem("legendas-cfg") || "{}")); } catch { /* sem armazenamento */ }
const salvarCfg = () => { try { localStorage.setItem("legendas-cfg", JSON.stringify(cfg)); } catch { /* ignora */ } };

// ---------------------------------------------------------------- estado
const videos = [];
let atual = null;       // id do vídeo aberto
const aberto = () => videos.find((v) => v.id === atual) || null;
const nomeSaida = (v) => `${v.nome.replace(/\.[^.]+$/, "")} - legendado.mp4`;

function adicionar(arquivos) {
  const novos = [...arquivos].filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|mkv|m4v|webm)$/i.test(f.name));
  for (const file of novos) {
    videos.push({
      id: crypto.randomUUID(), file, nome: file.name, url: URL.createObjectURL(file),
      status: "fila", etapa: "na fila", progresso: 0, erro: "",
      largura: 0, altura: 0, duracao: 0, rosto: null, miniatura: "",
      blocos: [], sugestoes: [], origem: "", escolha: 0, headline: { titulo: "", subtitulo: "" },
      yHead: 0.05, yLeg: 0.66, manualHead: false, manualLeg: false, apertado: false,
      tema: ehMega(file.name) ? "mega" : "padrao", temaManual: false, cores: TEMAS[ehMega(file.name) ? "mega" : "padrao"],
      amostras: [], headlineSegundos: +cfg.headline, saida: null,
    });
  }
  if (!novos.length) return;
  $("#inicio").hidden = true; $("#trabalho").hidden = false;
  if (!aberto()) selecionar(videos.at(-novos.length).id);
  desenharLista();
  processarFila();
}

function remover(id) {
  const i = videos.findIndex((v) => v.id === id);
  if (i < 0) return;
  const [v] = videos.splice(i, 1);
  v.removido = true;
  URL.revokeObjectURL(v.url);
  if (atual === id) { atual = null; const prox = videos[i] || videos[i - 1]; if (prox) selecionar(prox.id); }
  if (!videos.length) { $("#inicio").hidden = false; $("#trabalho").hidden = true; $("#video").removeAttribute("src"); }
  desenharLista();
}

// ---------------------------------------------------------------- preparar (transcrever + rosto + headlines)
let preparando = false;
async function processarFila() {
  if (preparando) return;
  preparando = true;
  for (let v; (v = videos.find((x) => x.status === "fila"));) await preparar(v);
  preparando = false;
}

async function preparar(v) {
  const etapa = (texto, progresso) => { v.etapa = texto; v.progresso = progresso; mudou(v); };
  try {
    v.status = "preparando";
    etapa("lendo o vídeo e procurando o rosto", 0.05);
    Object.assign(v, await analisarVideo(v.url));
    if (v.id === atual) ajustarMoldura();
    etapa("separando o áudio", 0.3);
    const audio = await extrairAudio(v.file);
    let palavras = [];
    if (audio && audio.length > 1600) {
      etapa("preparando a transcrição", 0.35);
      const r = await transcrever(audio, cfg.modelo, (m) => {
        if (m.tipo === "baixando" && m.pct < 100) etapa(`baixando o modelo de transcrição: ${m.pct}% (só na primeira vez)`, 0.35 + 0.002 * m.pct);
        else if (m.tipo === "baixando") etapa("carregando o modelo de transcrição", 0.55);
        else etapa("transcrevendo a fala", 0.6);
      });
      v.aparelho = r.aparelho;  // "webgpu" (placa de vídeo) ou "wasm" (processador)
      palavras = T.corrigir(r.palavras.filter((p) => p.inicio != null).map((p) => ({ ...p, fim: p.fim ?? p.inicio + 0.3 })), T.lerCorrecoes(cfg.correcoes));
    }
    palavras = T.padronizar(palavras, cfg.nomes);
    if (cfg.chave && palavras.length) {
      etapa("corrigindo a legenda com IA", 0.8);
      try { palavras = await revisarComIA(v, palavras); } catch (e) { console.warn("correção com IA falhou", e); }
    }
    if (v.removido) return;
    v.blocos = T.montarBlocos(palavras, T.lerNomes(cfg.nomes));
    if (!v.temaManual && ehMega(v.nome + " " + palavras.map((p) => p.texto).join(" "))) definirTema(v, "mega");
    etapa("criando as headlines", 0.9);
    await sugerir(v, false);
    v.status = "revisar"; v.progresso = 0;
  } catch (e) {
    console.error(e);
    v.status = "erro"; v.erro = e.message || String(e);
  }
  mudou(v, true);
  if (!aberto() || aberto().status !== "revisar") { const prox = videos.find((x) => x.status === "revisar"); if (prox && aberto()?.status !== "preparando") selecionar(prox.id); }
}

/** Aplica as regras de correção (ortografia, numerais, R$, nomes próprios) com IA e devolve as palavras revisadas. */
async function revisarComIA(v, palavras) {
  const revisadas = T.padronizar(T.aplicarTrocas(palavras, await corrigirIA(cfg.chave, palavras, cfg.nomes)), cfg.nomes);
  v.revisadoIA = true;
  return revisadas;
}

/** Preenche v.sugestoes. Com chave usa a IA; sem chave (ou se falhar) usa as automáticas. */
async function sugerir(v, avisarErro) {
  const fala = v.blocos.map(T.textoDoBloco).join(" "), pista = T.pistaDoNome(v.nome);
  let opcoes = null;
  if (cfg.chave && fala) {
    try { opcoes = await sugerirIA(cfg.chave, pista, fala); v.origem = "ia"; }
    catch (e) { console.warn(e); if (avisarErro) throw e; }
  }
  if (!opcoes) { opcoes = T.sugerirAutomatico(pista, fala); v.origem = "auto"; }
  v.sugestoes = opcoes;
  if (!avisarErro || !v.headline.titulo) { v.escolha = 0; v.headline = { ...opcoes[0] }; }
  else v.escolha = opcoes.findIndex((o) => o.titulo === v.headline.titulo && o.subtitulo === v.headline.subtitulo);
  reposicionar(v);
}

const rostoDaHeadline = (v) => rostoAte(v, v.headlineSegundos);
function definirTema(v, tema) { v.tema = tema; v.cores = TEMAS[tema]; }

function reposicionar(v, tudo = false) {
  if (!v.largura) return;
  if (tudo) v.manualHead = v.manualLeg = false;
  const p = posicionar(v.largura, v.altura, v.rosto, rostoDaHeadline(v), v.headline);
  if (!v.manualHead) v.yHead = p.yHead;
  if (!v.manualLeg) v.yLeg = p.yLeg;
  v.apertado = headlineSobreRosto(v.largura, v.altura, v, rostoDaHeadline(v));
}

// ---------------------------------------------------------------- exportar
let exportando = false;
async function exportarFila() {
  if (exportando) return;
  exportando = true;
  for (let v; (v = videos.find((x) => x.status === "aguardando"));) {
    try {
      v.status = "exportando"; v.progresso = 0; mudou(v, true);
      let ultimo = 0;
      const blob = await exportar(v, cfg, (p) => { v.progresso = p; if (p - ultimo > 0.01) { ultimo = p; mudou(v); } });
      if (v.status === "exportando") { v.saida = blob; v.status = "pronto"; }
    } catch (e) {
      console.error(e);
      v.status = "erro"; v.erro = e.message || String(e);
    }
    v.progresso = 0; mudou(v, true);
  }
  exportando = false;
}

function aprovar() {
  const v = aberto();
  if (!v || v.status !== "revisar") return;
  v.status = "aguardando"; mudou(v, true);
  exportarFila();
  $("#video").pause();
  const prox = videos.find((x) => x.status === "revisar");
  if (prox) selecionar(prox.id);
}

/** Qualquer edição depois de exportar invalida o arquivo pronto. */
function editado(v) {
  if (v.status === "pronto") { v.saida = null; v.status = "revisar"; mudou(v, true); }
}

function baixar(v) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(v.saida); a.download = nomeSaida(v);
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  v.baixado = true;
}

async function baixarTodos() {
  const prontos = videos.filter((v) => v.status === "pronto");
  if (!prontos.length) return;
  if (prontos.length > 1 && window.showDirectoryPicker) {
    let pasta;
    try { pasta = await window.showDirectoryPicker({ mode: "readwrite" }); } catch { return; }  // cancelou
    for (const v of prontos) {
      const w = await (await pasta.getFileHandle(nomeSaida(v), { create: true })).createWritable();
      await w.write(v.saida); await w.close();
      v.baixado = true;
    }
    $("#contagem").textContent = `${prontos.length} vídeos salvos na pasta "${pasta.name}".`;
    return;
  }
  for (const v of prontos) { baixar(v); await new Promise((r) => setTimeout(r, 500)); }
}

// ---------------------------------------------------------------- lista
let pendente = false;
/** Algo mudou num vídeo: redesenha a lista e o rodapé. O editor só é refeito se o vídeo aberto mudou de fase
 *  (preparando -> revisão -> erro), para não tirar o foco de quem está digitando. */
function mudou() {
  if (pendente) return;
  pendente = true;
  requestAnimationFrame(() => {
    pendente = false;
    desenharLista();
    const a = aberto();
    if (!a) return;
    if (estadoEditor !== faseDe(a)) desenharEditor(); else atualizarCentro(a);
    desenharRodape();
  });
}
const faseDe = (v) => v.id + (["fila", "preparando"].includes(v.status) ? ":preparo" : v.status === "erro" ? ":erro" : ":revisao");

function desenharLista() {
  const n = (s) => videos.filter((v) => v.status === s).length;
  const partes = [`${videos.length} vídeo${videos.length === 1 ? "" : "s"}`];
  if (n("fila") + n("preparando")) partes.push(`${n("fila") + n("preparando")} preparando`);
  if (n("revisar")) partes.push(`${n("revisar")} para revisar`);
  if (n("aguardando") + n("exportando")) partes.push(`${n("aguardando") + n("exportando")} exportando`);
  if (n("pronto")) partes.push(`${n("pronto")} pronto${n("pronto") === 1 ? "" : "s"}`);
  $("#contagem").textContent = videos.length ? partes.join(" · ") : "";
  $("#btnBaixarTodos").hidden = !n("pronto");
  $("#btnBaixarTodos").textContent = n("pronto") > 1 ? `⬇ Baixar todos (${n("pronto")})` : "⬇ Baixar vídeo pronto";
  $("#itens").innerHTML = videos.map((v) => {
    const info = v.status === "preparando" ? v.etapa : v.status === "exportando" ? `${Math.round(v.progresso * 100)}%` : v.status === "erro" ? v.erro : "";
    const prog = ["preparando", "exportando"].includes(v.status) ? `<i class="prog" style="width:${Math.round(v.progresso * 100)}%"></i>` : "";
    return `<div class="item ${v.id === atual ? "ativo" : ""}" data-id="${v.id}">
      <div class="mini" style="${v.miniatura ? `background-image:url(${v.miniatura})` : ""}"></div>
      <div style="min-width:0"><div class="nome" title="${esc(v.nome)}">${esc(v.nome.replace(/\.[^.]+$/, ""))}</div>
        <div class="info" title="${esc(info)}"><span class="chip ${v.status}">${ROTULO[v.status]}</span>${esc(info)}</div></div>
      <button class="tirar" data-tirar="${v.id}" title="Tirar da lista">✕</button>${prog}</div>`;
  }).join("");
}

$("#itens").addEventListener("click", (e) => {
  const tirar = e.target.closest("[data-tirar]");
  if (tirar) { e.stopPropagation(); remover(tirar.dataset.tirar); return; }
  const item = e.target.closest(".item");
  if (item) selecionar(item.dataset.id);
});

function selecionar(id) {
  if (atual === id) return;
  atual = id;
  const v = aberto(), video = $("#video");
  video.src = v.url;
  ajustarMoldura();
  desenharLista(); desenharEditor(); desenharRodape();
}

// ---------------------------------------------------------------- editor
let estadoEditor = "";
function atualizarCentro(v) {
  const t = $("#centroTexto"), b = $("#centroBarra");
  if (t) t.textContent = v.status === "fila" ? "Aguardando a vez…" : v.etapa;
  if (b) b.style.width = `${Math.round(v.progresso * 100)}%`;
}

function desenharEditor() {
  const v = aberto(), ed = $("#editor");
  if (!v) { ed.innerHTML = ""; return; }
  estadoEditor = faseDe(v);
  $("#dicaArrastar").hidden = !v.blocos.length && !v.headline.titulo;
  if (v.status === "fila" || v.status === "preparando") {
    ed.innerHTML = `<div class="centro"><b>Preparando este vídeo</b><br><span id="centroTexto"></span>
      <div class="barra-prog"><i id="centroBarra"></i></div>
      <p>Você pode revisar outros vídeos enquanto isso.</p></div>`;
    atualizarCentro(v);
    return;
  }
  if (v.status === "erro") {
    ed.innerHTML = `<div class="centro"><b>Não deu certo</b><br>${esc(v.erro)}<br><button class="grande" id="btnDeNovo">Tentar de novo</button></div>`;
    $("#btnDeNovo").onclick = () => { v.status = v.largura && (v.blocos.length || v.sugestoes.length) ? "aguardando" : "fila"; v.erro = ""; mudou(v, true); v.status === "fila" ? processarFila() : exportarFila(); };
    return;
  }
  const h = v.headline;
  ed.innerHTML = `
    <div class="secao">
      <h2>Headline <small>${v.origem === "ia" ? "sugeridas pela IA" : "sugestões automáticas"}
        <button class="mini-botao" id="btnSugerir" title="Cria 3 headlines novas com IA a partir da legenda">✨ gerar com IA</button></small></h2>
      ${v.sugestoes.map((o, i) => `
        <div class="opcao ${v.escolha === i ? "escolhida" : ""}" data-i="${i}">
          <span class="tecla">${i + 1}</span><div><div class="t">${esc(o.titulo)}</div><div class="s">${esc(o.subtitulo)}</div></div>
        </div>`).join("")}
      <div class="campos">
        <div class="rotulo"><span>Linha 1</span><span id="nT"></span></div>
        <input type="text" id="inTitulo" value="${esc(h.titulo)}" placeholder="Primeira linha">
        <div class="rotulo"><span>Linha 2</span><span id="nS"></span></div>
        <input type="text" id="inSub" value="${esc(h.subtitulo)}" placeholder="Segunda linha (opcional)">
      </div>
      <div class="cores">Cores ${Object.entries(TEMAS).map(([k, t]) => `<button class="cor ${k === v.tema ? "escolhida" : ""}" data-tema="${k}" title="${t.nome}"
        style="background:linear-gradient(90deg, ${t.barra} 45%, ${t.caixa} 45%)"></button>`).join("")}
        <span id="nomeTema">${TEMAS[v.tema].nome}</span></div>
      <div id="avisoRosto"></div>
    </div>
    <div class="secao">
      <h2>Legenda <small>${v.revisadoIA ? "revisada pela IA" : "clique numa linha para corrigir"}
        <button class="mini-botao" id="btnRevisar" title="Corrige ortografia, pontuação, números e nomes com IA">✨ revisar com IA</button></small></h2>
      <div id="blocos">${v.blocos.length ? v.blocos.map((b, i) => `
        <div class="bloco" data-i="${i}">
          <button class="quando" data-i="${i}" title="Ouvir este trecho">${fmt(b.ini)}</button>
          <input type="text" data-i="${i}" value="${esc(T.textoDoBloco(b))}">
        </div>`).join("") : `<p style="color:var(--fraco)">Não encontrei fala neste vídeo. Ele sai só com a headline.</p>`}</div>
    </div>
    <div class="secao atalhos">
      <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> escolher headline · <kbd>Espaço</kbd> play/pausa ·
      <kbd>Enter</kbd> próxima linha · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> aprovar e ir ao próximo
    </div>`;

  ed.querySelectorAll(".opcao").forEach((el) => { el.onclick = () => escolher(+el.dataset.i); });
  ed.querySelectorAll(".cor").forEach((el) => { el.onclick = () => {
    definirTema(v, el.dataset.tema); v.temaManual = true; editado(v);
    ed.querySelectorAll(".cor").forEach((c) => c.classList.toggle("escolhida", c === el));
    $("#nomeTema").textContent = TEMAS[v.tema].nome;
  }; });
  $("#btnSugerir").onclick = gerarComIA;
  $("#btnRevisar").onclick = revisarLegenda;
  $("#inTitulo").oninput = $("#inSub").oninput = () => {
    v.headline = { titulo: $("#inTitulo").value, subtitulo: $("#inSub").value };
    const s = v.sugestoes[v.escolha];
    if (!s || s.titulo !== v.headline.titulo || s.subtitulo !== v.headline.subtitulo) {
      v.escolha = -1; ed.querySelectorAll(".opcao").forEach((el) => el.classList.remove("escolhida"));
    }
    reposicionar(v); contarHeadline(); editado(v);
  };
  ed.querySelectorAll("#blocos input").forEach((inp) => {
    const i = +inp.dataset.i;
    inp.oninput = () => { T.aplicarTexto(v.blocos[i], inp.value); editado(v); };
    inp.onfocus = () => { $("#video").currentTime = v.blocos[i].ini + 0.02; };
    inp.onkeydown = (e) => {
      if (e.key !== "Enter" || e.ctrlKey) return;
      e.preventDefault();
      const prox = ed.querySelector(`#blocos input[data-i="${i + 1}"]`);
      prox ? prox.focus() : inp.blur();
    };
  });
  ed.querySelectorAll(".quando").forEach((b) => { b.onclick = () => { const video = $("#video"); video.currentTime = v.blocos[+b.dataset.i].ini + 0.02; video.play(); }; });
  contarHeadline();
}

function contarHeadline() {
  const v = aberto(); if (!v || !$("#nT")) return;
  const t = v.headline.titulo.length, s = v.headline.subtitulo.length;
  $("#nT").innerHTML = `<span class="${t > 22 ? "longo" : ""}">${t}/22</span>`;
  $("#nS").innerHTML = `<span class="${s > 22 ? "longo" : ""}">${s}/22</span>`;
  $("#avisoRosto").innerHTML = v.apertado
    ? `<div class="aviso">A headline está em cima do rosto. Arraste-a no vídeo ou <button class="link" id="btnAuto">reposicione automaticamente</button>.</div>`
    : (v.manualHead || v.manualLeg) ? `<div style="margin-top:8px;font-size:12px"><button class="link" id="btnAuto">Voltar à posição automática</button></div>` : "";
  const b = $("#btnAuto"); if (b) b.onclick = () => { reposicionar(v, true); contarHeadline(); editado(v); };
}

function escolher(i) {
  const v = aberto();
  if (!v || !v.sugestoes[i] || !$("#inTitulo")) return;
  v.escolha = i; v.headline = { ...v.sugestoes[i] };
  $("#inTitulo").value = v.headline.titulo; $("#inSub").value = v.headline.subtitulo;
  document.querySelectorAll(".opcao").forEach((el) => el.classList.toggle("escolhida", +el.dataset.i === i));
  reposicionar(v); contarHeadline(); editado(v);
}

async function gerarComIA() {
  const v = aberto(), b = $("#btnSugerir");
  if (!cfg.chave) { abrirAjustes(true); return; }
  b.disabled = true; b.textContent = "gerando…";
  try { await sugerir(v, true); editado(v); }
  catch (e) { alert(`A IA não respondeu: ${e.message}`); }
  if (aberto() === v) desenharEditor();
}

/** Botão "revisar com IA": corrige o texto atual da legenda (inclusive o que já foi editado à mão). */
async function revisarLegenda() {
  const v = aberto(), b = $("#btnRevisar");
  if (!cfg.chave) { abrirAjustes(true); return; }
  if (!v.blocos.length) return;
  b.disabled = true; b.textContent = "revisando…";
  try {
    const palavras = await revisarComIA(v, v.blocos.flatMap((bl) => bl.palavras));
    v.blocos = T.montarBlocos(palavras, T.lerNomes(cfg.nomes));
    editado(v);
  } catch (e) { alert(`A IA não respondeu: ${e.message}`); }
  if (aberto() === v) desenharEditor();
}

function desenharRodape() {
  const v = aberto(), r = $("#rodape");
  if (!v) { r.innerHTML = ""; return; }
  const mb = v.saida ? `${(v.saida.size / 1e6).toFixed(1)} MB` : "";
  const partes = {
    fila: [`Aguardando a vez…`, ""],
    preparando: [`Preparando…`, ""],
    revisar: [`Confira a legenda e a headline.`, `<button class="primario" id="btnAprovar" title="Ctrl+Enter">Aprovar e exportar</button>`],
    aguardando: [`Na fila para exportar…`, `<button disabled>Aguardando</button>`],
    exportando: [`Gerando o vídeo… pode revisar os outros.`, `<button disabled>Exportando ${Math.round(v.progresso * 100)}%</button>`],
    pronto: [`Vídeo pronto (${mb}).`, `<button class="primario" id="btnBaixar">⬇ Baixar vídeo</button>`],
    erro: [``, ""],
  }[v.status];
  r.innerHTML = `<span class="estado">${partes[0]}</span>${partes[1]}`;
  if ($("#btnAprovar")) $("#btnAprovar").onclick = aprovar;
  if ($("#btnBaixar")) $("#btnBaixar").onclick = () => baixar(v);
}

// ---------------------------------------------------------------- prévia (canvas por cima do vídeo)
const video = $("#video"), tela = $("#tela"), ctx = tela.getContext("2d");
let arrasto = null, blocoMarcado = -1, mexendoBarra = false;

function ajustarMoldura() {
  const v = aberto();
  $("#moldura").style.setProperty("--hw", v && v.largura ? v.altura / v.largura : 16 / 9);
}
new ResizeObserver(() => {
  const r = tela.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  tela.width = Math.max(1, Math.round(r.width * dpr)); tela.height = Math.max(1, Math.round(r.height * dpr));
}).observe($("#moldura"));

(function quadro() {
  requestAnimationFrame(quadro);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, tela.width, tela.height);
  const v = aberto();
  if (!v || !v.largura) return;
  const t = video.currentTime || 0, k = tela.width / v.largura;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (v.status !== "fila" && v.status !== "preparando") desenhar(ctx, v.largura, v.altura, t, v);
  const zona = arrasto && (arrasto.qual === "head" ? rostoDaHeadline(v) : v.rosto);
  if (zona) {  // mostra onde está o rosto enquanto arrasta
    ctx.fillStyle = "rgba(239,91,91,.18)"; ctx.strokeStyle = "rgba(239,91,91,.9)"; ctx.lineWidth = 2 / k; ctx.setLineDash([8 / k, 6 / k]);
    const y0 = zona[0] * v.altura, alt = (zona[1] - zona[0]) * v.altura;
    ctx.fillRect(0, y0, v.largura, alt); ctx.strokeRect(-5, y0, v.largura + 10, alt); ctx.setLineDash([]);
    ctx.fillStyle = "#ffb3b3"; ctx.font = `600 ${13 / k}px system-ui`; ctx.textAlign = "right"; ctx.textBaseline = "top";
    ctx.fillText("rosto", v.largura - 8 / k, y0 + 5 / k);
  }
  if (!mexendoBarra && v.duracao) { $("#barra").value = t / v.duracao; }
  $("#tempo").textContent = fmt(t);
  const bi = blocoNoTempo(v.blocos, t);
  if (bi !== blocoMarcado) {
    blocoMarcado = bi;
    document.querySelectorAll(".bloco").forEach((el) => el.classList.toggle("atual", +el.dataset.i === bi));
    const el = document.querySelector(`.bloco[data-i="${bi}"]`);
    if (el && !video.paused && document.activeElement.tagName !== "INPUT") el.scrollIntoView({ block: "nearest" });
  }
})();

const alternar = () => (video.paused ? video.play() : video.pause());
$("#btnPlay").onclick = alternar;
video.onplay = () => { $("#btnPlay").textContent = "❚❚"; };
video.onpause = () => { $("#btnPlay").textContent = "▶"; };
$("#barra").oninput = (e) => { mexendoBarra = true; const v = aberto(); if (v) video.currentTime = e.target.value * v.duracao; };
$("#barra").onchange = () => { mexendoBarra = false; };

// arrastar a headline ou a legenda para cima/baixo
function alvoEm(e) {
  const v = aberto();
  if (!v || !v.largura || ["fila", "preparando"].includes(v.status)) return null;
  const y = e.offsetY / tela.clientHeight, f = faixas(v.largura, v.altura, v), folga = 0.012;
  if ((v.headline.titulo || v.headline.subtitulo) && y >= f.head[0] - folga && y <= f.head[1] + folga) return { qual: "head", dif: y - v.yHead };
  if (v.blocos.length && y >= f.leg[0] && y <= f.leg[1]) return { qual: "leg", dif: y - v.yLeg };
  return null;
}
tela.onpointerdown = (e) => {
  arrasto = alvoEm(e);
  if (arrasto) { arrasto.y0 = e.offsetY; arrasto.moveu = false; tela.setPointerCapture(e.pointerId); }
  else alternar();
};
tela.onpointermove = (e) => {
  if (!arrasto) { tela.style.cursor = alvoEm(e) ? "ns-resize" : "pointer"; return; }
  if (Math.abs(e.offsetY - arrasto.y0) > 3) arrasto.moveu = true;
  if (!arrasto.moveu) return;
  const v = aberto(), y = e.offsetY / tela.clientHeight - arrasto.dif, f = faixas(v.largura, v.altura, v);
  if (arrasto.qual === "head") { v.yHead = Math.min(0.97 - (f.head[1] - f.head[0]), Math.max(0.01, y)); v.manualHead = true; }
  else { v.yLeg = Math.min(0.95, Math.max(0.05, y)); v.manualLeg = true; }
  v.apertado = headlineSobreRosto(v.largura, v.altura, v, rostoDaHeadline(v));
};
tela.onpointerup = tela.onpointercancel = () => {
  if (!arrasto) return;
  const moveu = arrasto.moveu; arrasto = null;
  if (!moveu) { alternar(); return; }
  contarHeadline(); editado(aberto());
};

// ---------------------------------------------------------------- arquivos
const escolher_arquivos = () => $("#arquivos").click();
$("#btnEscolher").onclick = (e) => { e.stopPropagation(); escolher_arquivos(); };
$("#soltarInicio").onclick = $("#btnMais").onclick = escolher_arquivos;
$("#arquivos").onchange = (e) => { adicionar(e.target.files); e.target.value = ""; };
let profundidade = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); profundidade++; document.body.classList.add("arrastando"); });
addEventListener("dragleave", () => { if (--profundidade <= 0) { profundidade = 0; document.body.classList.remove("arrastando"); } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => { e.preventDefault(); profundidade = 0; document.body.classList.remove("arrastando"); adicionar(e.dataTransfer.files); });
$("#btnBaixarTodos").onclick = baixarTodos;
addEventListener("beforeunload", (e) => { if (videos.some((v) => !v.baixado)) { e.preventDefault(); e.returnValue = ""; } });

// ---------------------------------------------------------------- teclado
addEventListener("keydown", (e) => {
  if (!$("#modal").hidden) { if (e.key === "Escape") fecharAjustes(); return; }
  const digitando = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); aprovar(); return; }
  if (e.ctrlKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const prox = videos[videos.findIndex((v) => v.id === atual) + (e.key === "ArrowDown" ? 1 : -1)];
    if (prox) selecionar(prox.id);
    return;
  }
  if (e.key === "Escape" && digitando) { document.activeElement.blur(); return; }
  if (digitando) return;
  if (["1", "2", "3"].includes(e.key)) escolher(+e.key - 1);
  else if (e.key === " ") { e.preventDefault(); alternar(); }
});

// ---------------------------------------------------------------- ajustes
function abrirAjustes(focarChave = false) {
  $("#cfgModelo").value = cfg.modelo; $("#cfgResolucao").value = cfg.resolucao; $("#cfgHeadline").value = cfg.headline;
  $("#cfgCorrecoes").value = cfg.correcoes; $("#cfgNomes").value = cfg.nomes; $("#cfgChave").value = ""; $("#iaErro").textContent = "";
  situacaoIA();
  $("#modal").hidden = false;
  if (focarChave) $("#cfgChave").focus();
}
function situacaoIA() {
  $("#iaSituacao").textContent = cfg.chave ? "ligada" : "desligada";
  $("#iaSituacao").style.color = cfg.chave ? "var(--ok)" : "";
  $("#btnRemoverChave").hidden = !cfg.chave;
  $("#cfgChave").placeholder = cfg.chave ? "chave salva — cole outra para trocar" : "sk-ant-...";
}
function fecharAjustes() {
  cfg.modelo = $("#cfgModelo").value; cfg.resolucao = $("#cfgResolucao").value;
  cfg.headline = $("#cfgHeadline").value; cfg.correcoes = $("#cfgCorrecoes").value; cfg.nomes = $("#cfgNomes").value;
  salvarCfg();
  for (const v of videos) if (v.headlineSegundos !== +cfg.headline) { v.headlineSegundos = +cfg.headline; reposicionar(v); editado(v); }
  contarHeadline();
  $("#modal").hidden = true;
}
$("#btnAjustes").onclick = () => abrirAjustes();
$("#btnFechar").onclick = fecharAjustes;
$("#modal").onclick = (e) => { if (e.target.id === "modal") fecharAjustes(); };
$("#btnTestarChave").onclick = async () => {
  const b = $("#btnTestarChave"), chave = $("#cfgChave").value.trim();
  b.disabled = true; b.textContent = "Testando…"; $("#iaErro").textContent = "";
  try { await testarChave(chave); cfg.chave = chave; salvarCfg(); $("#cfgChave").value = ""; }
  catch (e) { $("#iaErro").textContent = e.message; }
  b.disabled = false; b.textContent = "Salvar chave"; situacaoIA();
};
$("#btnRemoverChave").onclick = () => { cfg.chave = ""; salvarCfg(); situacaoIA(); };

// ---------------------------------------------------------------- início
if (!exportacaoSuportada()) {
  $("#avisoNavegador").hidden = false;
  $("#avisoNavegador").textContent = "Este navegador não consegue gerar o vídeo final. Abra esta página no Chrome ou no Edge, no computador.";
}
carregarFonte();
window.legendas = { adicionar, videos };  // para testes e automação
