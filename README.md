# Legendas em lote

Site que coloca **legenda automática e headline** em vídeos curtos (Reels, TikTok, Shorts), vários de uma vez.
Roda inteiro no navegador: os vídeos **não são enviados para nenhum servidor**.

## Como usar
1. Abra o site no **Chrome ou Edge, no computador**.
2. Arraste os vídeos. Cada um é transcrito e ganha 3 sugestões de headline.
3. Corrija a legenda, escolha a headline (teclas 1, 2, 3) e aprove (Ctrl+Enter).
4. Baixe os vídeos prontos.

Na primeira vez, o navegador baixa o modelo de transcrição (cerca de 400 MB no modo padrão). Depois fica guardado.

## O que o site faz sozinho
- A headline aparece nos 3 primeiros segundos, o mais perto possível do centro, **sem cobrir o rosto** (acima ou abaixo dele).
- Cores: azul e laranja; em vídeos sobre Mega-Sena (nome do arquivo ou fala com "mega"), verde e branco.
- A legenda fica no terço de baixo, fora da área dos botões do Reels/TikTok.
- Dá para arrastar a headline e a legenda no vídeo para mudar a posição.

## Publicar no GitHub Pages
1. Crie um repositório público no GitHub (ex.: `legendas`).
2. Envie **o conteúdo desta pasta** para ele (`index.html` na raiz, mais `css/`, `js/` e `.nojekyll`).
3. No repositório: **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**, branch `main`, pasta `/ (root)`, e salve.
4. Em 1 a 2 minutos o site fica em `https://SEU-USUARIO.github.io/legendas/`.

Não há etapa de build: são só arquivos estáticos.

## Ajustes (botão ⚙ no site)
- Qualidade da transcrição (rápida, equilibrada, máxima).
- Tamanho do vídeo exportado (Full HD ou original).
- Duração da headline.
- Correções automáticas de palavras (`errado = certo`).
- Headlines com IA: opcional; cada pessoa cola a própria chave da API da Anthropic, que fica salva só no navegador dela.

## Arquivos
- `js/desenho.js`: desenha headline e legenda (o mesmo código na prévia e na exportação) e escolhe as posições.
- `js/rosto.js`: lê o vídeo e acha a faixa do rosto (MediaPipe).
- `js/transcricao.js` + `js/worker-whisper.js`: áudio e transcrição (Whisper via transformers.js, com WebGPU quando houver).
- `js/exportar.js`: gera o MP4 final (WebCodecs via Mediabunny).
- `js/texto.js`: correções, blocos de legenda e sugestões automáticas.
- `js/headlines.js`: sugestões com IA (opcional).
- `js/app.js`: a interface.
