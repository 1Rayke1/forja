# Origem, atribuição e situação de licença — recursos anatômicos

## 1. Referências efetivamente fornecidas

As referências desta revisão são os dois anexos enviados pelo usuário na conversa. Seus bytes originais foram preservados para auditoria:

| Arquivo recebido | Cópia preservada | Dimensões | SHA-256 | Uso atual |
| --- | --- | --- | --- | --- |
| `IMG_532e0a2d-6931-447a-a6eb-c90c9ae2d1e3.jpg` | `fontes/modelo-masculino-original.jpg` | 740 × 740 | `4163b0387a1657e5c121864e663e93dbe5bf1f476cce59304b7f197102a7c39b` | Origem das vistas anterior e posterior |
| `IMG_c503be6c-c781-4b02-8fd9-fba224589ff5.webp` | `fontes/modelo-feminino-original.webp` | 644 × 644 | `ffe624b890d26420b9e3dfb42526a666325411a9fc62fd2164ed96619a30959a` | Referência preservada; não combinada com o modelo masculino |

A primeira prancha contém as duas vistas do mesmo modelo e na mesma escala. Por isso ela é a única origem das imagens exibidas atualmente. Misturar o segundo modelo com o primeiro romperia a correspondência anatômica entre as vistas.

## 2. Licença: pendência real, sem presunção

**Situação da licença de redistribuição: não verificada.**

A inspeção dos arquivos e de seus metadados não encontrou autoria, URL de origem, licença ou autorização de redistribuição. O fato de o usuário ter fornecido os anexos não comprova, por si só, a licença de publicação. Nenhuma licença Creative Commons é atribuída a estes arquivos nesta revisão.

Antes de merge em `main`, release ou outra publicação, o responsável precisa:

1. informar a origem e o titular das imagens;
2. confirmar a licença ou autorização de uso e redistribuição, incluindo recortes e remoção do fundo;
3. acrescentar aqui a atribuição exigida, se houver;
4. autorizar explicitamente a publicação.

Esta branch é apenas trabalho de revisão. Não houve merge nem release nesta correção.

## 3. Como as pranchas atuais foram produzidas

`tools/gerar-anatomia-referencia.mjs` faz somente operações de imagem:

- recorte anterior: `x=40`, `y=16`, `350 × 690` na referência masculina;
- recorte posterior: `x=360`, `y=16`, `350 × 690` na mesma referência;
- remoção por flood-fill apenas do fundo branco conectado às bordas;
- suavização de um pixel da borda externa, sem apagar fáscias ou tendões internos;
- gravação em PNG RGBA, sem redesenho, vetorização, alteração de proporções ou substituição por formas geométricas.

`manifest.json` registra origem, recortes, dimensões, limites do corpo e hashes dos arquivos gerados. O teste de navegador compara os RGB dos pixels opacos com o recorte original no mesmo pixel; a única tolerância é de 1 nível em 8 bits por canal para diferenças de decodificação entre SwiftShader e software.

## 4. Destaques funcionais

Os caminhos de `assets/js/forja-figura.js` não criam o corpo. Eles apenas indicam as regiões musculares do catálogo sobre a prancha raster:

- principal: verde-limão `#b7f34a`;
- secundária: âmbar `#f2b84b`;
- estabilizadora: azul `#8cc0e0`.

Os preenchimentos são translúcidos e usam `mix-blend-mode: color`, preservando luminância, fibras e divisões visíveis. Uma máscara referencia o canal alfa do **mesmo PNG** exibido, sem uma segunda silhueta vetorial que possa divergir.

Os contornos são projeções funcionais aproximadas de estruturas superficiais visíveis. Não constituem segmentação clínica nem afirmam mapear limites de músculos profundos. Em particular, “Quadril” e “Lombar” indicam projeções de região, não uma reconstrução de iliopsoas ou de cada estabilizador profundo.

## 5. Relação com BodyParts3D e Z-Anatomy

Nenhum arquivo BodyParts3D ou Z-Anatomy foi usado para gerar as pranchas desta correção. Esses projetos não devem ser apresentados como origem ou licença das imagens fornecidas pelo usuário.

`tools/gerar-anatomia-3d.mjs` permanece no histórico como pipeline experimental anterior, mas não participa da renderização atual. As pranchas geométricas autorais do PR #12 foram retiradas do resultado final e continuam preservadas no histórico do Git.

## 6. Auditoria do PR #12

A revisão das imagens e do código do PR #12 identificou duas causas para o resultado fragmentado:

1. as pranchas realistas foram substituídas por SVGs autorais compostos por polígonos e curvas genéricas;
2. `SILHOUETTES` e os recortes aplicados às imagens não correspondiam a esses desenhos, removendo partes do corpo e criando vazios entre os membros.

Os testes do PR verificavam viewBox, quantidade de curvas e ausência de overflow, mas não comparavam a imagem com a referência nem os destaques com o corpo renderizado. Por isso passavam apesar da falha visual.

A correção preserva o commit do PR no histórico e substitui a abordagem em commit separado. Os testes agora cobrem hashes e cabeçalhos PNG, enquadramento, correspondência pixel a pixel com a referência e 24 amostras de borda em cada um dos 41 contornos funcionais.
