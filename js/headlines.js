// Sugestões de headline com IA (opcional). A chave fica só no navegador de quem usa e a chamada vai direto
// do navegador para a Anthropic; este site não tem servidor.

const SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.10.0/+esm";
const MODELO = "claude-opus-5-5";

async function cliente(chave) {
  const { default: Anthropic } = await import(SDK);
  return { Anthropic, client: new Anthropic({ apiKey: chave, dangerouslyAllowBrowser: true }) };
}

function traduzirErro(Anthropic, e) {
  const texto = String(e?.message || e);
  if (e instanceof Anthropic.AuthenticationError) return "Chave inválida ou apagada. Gere outra em platform.claude.com.";
  if (e instanceof Anthropic.PermissionDeniedError) return "A chave não tem permissão para usar o modelo.";
  if (e instanceof Anthropic.RateLimitError) return "Limite de uso atingido; tente de novo em instantes.";
  if (e instanceof Anthropic.BadRequestError && /credit/i.test(texto)) return "A conta da API está sem créditos (platform.claude.com, em Billing).";
  if (e instanceof Anthropic.APIConnectionError) return "Sem conexão com a internet.";
  if (e instanceof Anthropic.APIError) return `Erro da API (${e.status ?? "?"}): ${texto.slice(0, 140)}`;
  return texto.slice(0, 160);
}

/** Confere a chave sem gastar créditos. Lança Error com mensagem em português. */
export async function testarChave(chave) {
  if (!/^sk-ant-/.test(chave)) throw new Error("Isso não parece uma chave da Anthropic (ela começa com sk-ant-).");
  const { Anthropic, client } = await cliente(chave);
  try { await client.models.retrieve(MODELO); } catch (e) { throw new Error(traduzirErro(Anthropic, e)); }
}

/** Devolve 3 opções [{titulo, subtitulo}]. */
export async function sugerirIA(chave, pista, fala) {
  const { Anthropic, client } = await cliente(chave);
  const pedido =
    "Crie 3 opções de headline para um vídeo curto vertical (Reels/TikTok).\n" +
    "Cada opção tem um TÍTULO (até 26 caracteres) e um SUBTÍTULO (até 32 caracteres) que complementa o título.\n" +
    "Português do Brasil, direto, chamativo, sem emojis, sem hashtags, sem aspas, sem prometer ganho garantido.\n" +
    "As 3 opções devem ter ângulos diferentes (ex.: benefício, número concreto, curiosidade).\n" +
    (pista.titulo ? `Nome do arquivo (pode servir de pista): ${pista.titulo} | ${pista.subtitulo}\n` : "") +
    `Fala do vídeo:\n${fala}\n\n` +
    'Responda só com JSON: [{"titulo": "...", "subtitulo": "..."}, ...]';
  let resposta;
  try {
    resposta = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      messages: [{ role: "user", content: pedido }],
    });
  } catch (e) { throw new Error(traduzirErro(Anthropic, e)); }
  if (resposta.stop_reason === "refusal") throw new Error("A IA recusou este pedido.");
  const bruto = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const achado = bruto.match(/\[[\s\S]*\]/);
  const opcoes = achado ? JSON.parse(achado[0]) : [];
  const limpas = opcoes.slice(0, 3).map((o) => ({ titulo: String(o.titulo || "").trim(), subtitulo: String(o.subtitulo || "").trim() }));
  if (limpas.length < 3) throw new Error("A IA devolveu menos de 3 opções; tente de novo.");
  return limpas;
}
