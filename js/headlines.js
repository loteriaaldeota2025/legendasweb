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
    "Cada opção é UMA frase curta dividida em duas linhas: titulo é a primeira linha e subtitulo é a continuação " +
    "(até 22 caracteres por linha). Exemplo: titulo = Sexta-feira, 13, com / subtitulo = clima de virada!\n" +
    "Escreva como frase normal (só a primeira letra e os nomes próprios em maiúscula), nunca tudo em caixa alta.\n" +
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

const REGRAS_CORRECAO = `Você revisa a transcrição automática de um vídeo curto em português do Brasil, que vira legenda.
Regras:
1. Corrija ortografia, acentuação, erros de digitação e pontuação.
2. Escreva todos os números em numerais. Exemplo: "trezentos milhões" vira "300 milhões".
3. Padronize os valores monetários. Exemplo: "duzentos milhões de reais" vira "R$ 200 milhões".
4. Preserve a construção, o sentido e a intenção das falas, incluindo gírias, regionalismos e o jeito de falar de cada pessoa. Faça apenas as correções necessárias, sem resumir e sem acrescentar informações.
5. Use a grafia confirmada dos nomes próprios (lista abaixo: marca, modalidades lotéricas e concursos especiais). Corrija nomes de modalidades lotéricas apenas quando houver certeza de que foi isso que a pessoa falou. Em caso de dúvida, preserve a forma original.
6. Prefira vírgulas e pontos finais. Não use travessões.
7. Termos comuns como bolão, cota, aposta, sorteio, concurso e prêmio ficam em minúsculas no meio da frase. Em "Rei do Bolão", "Bolão" faz parte do nome da marca e fica com maiúscula.`;

/**
 * Revisa a legenda com IA. Recebe as palavras [{texto}] e devolve trocas [{de, ate, texto}]:
 * "texto" substitui as palavras de..ate (índices, inclusive). O tempo de cada trecho é mantido por quem aplica.
 */
export async function corrigirIA(chave, palavras, nomes) {
  const { Anthropic, client } = await cliente(chave);
  const pedido =
    `${REGRAS_CORRECAO}\n\nNomes próprios com grafia confirmada: ${nomes || "(nenhum)"}\n\n` +
    "A transcrição vem como uma lista numerada de palavras (índice: palavra). Devolva SOMENTE as correções, em JSON:\n" +
    '[{"de": 4, "ate": 6, "texto": "R$ 200 milhões"}]\n' +
    '"de" e "ate" são os índices da primeira e da última palavra do trecho corrigido (inclusive); "texto" é o que entra no lugar. ' +
    "Use o menor trecho possível para cada correção e não inclua palavras que não mudam. Se nada precisar mudar, devolva [].\n\n" +
    palavras.map((p, i) => `${i}: ${p.texto}`).join("\n");
  let resposta;
  try {
    resposta = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      messages: [{ role: "user", content: pedido }],
    });
  } catch (e) { throw new Error(traduzirErro(Anthropic, e)); }
  if (resposta.stop_reason === "refusal") throw new Error("A IA recusou este pedido.");
  if (resposta.stop_reason === "max_tokens") throw new Error("O vídeo é longo demais para corrigir de uma vez.");
  const bruto = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const achado = bruto.match(/\[[\s\S]*\]/);
  if (!achado) throw new Error("A IA respondeu num formato inesperado; tente de novo.");
  return JSON.parse(achado[0]);
}
