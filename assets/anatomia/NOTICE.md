# Aviso de Atribuição, Origem e Licença — Recursos Anatômicos (`assets/anatomia/`)

Os arquivos de imagem `assets/anatomia/anterior.png` e `assets/anatomia/posterior.png`, bem como os contornos vetoriais embutidos nas constantes `SILHOUETTES` e `REGIONS` de `assets/js/forja-figura.js`, compõem a base visual do Atlas Muscular do FORJA.

---

## 0. Pranchas anatômicas de referência na branch de trabalho (verificação de licença e enquadramento)

Nesta branch de trabalho (`arena/3c08bdf4-forja`), as pranchas `assets/anatomia/anterior.svg` (`5.939 bytes`) e `assets/anatomia/posterior.svg` (`5.404 bytes`) são **pranchas ortográficas originais do FORJA**, autoras diretas do repositório: `viewBox="0 0 240 520"`, tons neutros anatômicos, sem rótulos, números ou marcadores de chamada, cobrindo da **cabeça aos pés** nas vistas anterior e posterior. Foram renderizadas para `assets/anatomia/anterior.png` (`48.615 bytes`, `47,5 KiB`, `480 × 1040 px`) e `assets/anatomia/posterior.png` (`48.524 bytes`, `47,4 KiB`, `480 × 1040 px`) em ambiente de desenvolvimento (navegador headless). Não há captura de terceiros nem metadados EXIF/IPTC a auditar: os arquivos são gerados neste repositório.

### Verificação de origem e licença
- **Origem:** pranchas vetoriais autorais do FORJA, desenhadas como silhuetas anatômicas ortográficas (cabeça, tronco, membros superiores e inferiores, pés), sem uso de capturas de tela, fotos ou ilustrações de terceiros.
- **Licença dos recursos anatômicos derivados:** **CC BY-SA 4.0** (atribuição e compartilhamento pela mesma licença), detalhada na seção 2.
- **Código da aplicação:** permanece sob o licenciamento próprio do repositório (seção 3).
- Antes de versão pública (`main` / release), o responsável pelo repositório deve confirmar a adoção desta nota de crédito e da licença CC BY-SA 4.0 para os recursos anatômicos.

### Enquadramento cabeça-aos-pés (sem cortes)
- As duas pranchas abrangem da cabeça aos pés (primeira linha de tinta em `y ≈ 32`, última em `y ≈ 1035–1039` de 1040), com proporção preservada por `viewBox` + `preserveAspectRatio xMidYMid meet`; sem cortes adicionais e sem deformação.
- Os testes de captura em navegador nas larguras `320`, `360`, `390`, `430`, `768` e `1280 px` medem **rolagem horizontal +0 px** (sem cortes nem deformações em celulares).
- As **16 regiões funcionais do catálogo** (`ombros`, `peito`, `biceps`, `antebracos`, `abdomem`, `obliquos`, `quadril`, `quadriceps`, `pernas`, `costas`, `dorsais`, `lombar`, `triceps`, `gluteos`, `posterior-coxa`, `panturrilha`) possuem contornos SVG em curvas de Bézier cúbicas fechadas alinhados às estruturas visuais, incluindo coxas, joelhos, panturrilhas e pés nas duas vistas.
- A região **`panturrilha`** tem contorno posterior (`back`: gastrocnêmio, sóleo, plantar e tendão de calcâneo) nas duas vistas e **não** está mais fora do recorte: não há `outsideFrame` nem aviso de enquadramento parcial.

---

## 1. Acervo anatômico 3D aberto preservado (CC BY-SA 4.0) e créditos exigidos

O pipeline de regeneração em `tools/` foi documentado com base em acervos abertos; os arquivos-fonte (malhas glTF do Z-Anatomy e `FMA7163.stl` do BodyParts3D) não estão presentes neste ambiente, portanto as pranchas atuais não foram regeneradas por esse pipeline — foram autorais diretamente como SVG e renderizadas para PNG. Os créditos abaixo são mantidos como referência do acervo aberto que fundamenta a validação anatômica do FORJA:

1. **BodyParts3D / Anatomography**
   - **Autoria e crédito:** *BodyParts3D, © The Database Center for Life Science (DBCLS), Research Organization of Information and Systems (ROIS), Japão.*
   - **Referência científica:** Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K. *BodyParts3D: 3D structure database for anatomical concepts.* Nucleic Acids Research. 2009;37(Database issue):D782–D785.
   - **Licença original:** [Creative Commons Attribution-ShareAlike 2.1 Japan (CC BY-SA 2.1 JP)](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en).

2. **Z-Anatomy — Models of Human Anatomy**
   - **Autoria e crédito:** *Z-Anatomy (Gauthier Kervyn e colaboradores), derivado do BodyParts3D e estruturado segundo a Terminologia Anatomica (TA2).*
   - **Licença original:** [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).
   - **Exclusões verificadas:** nenhum modelo visceral (`ic-organlar.glb`) e nenhuma marca ou logotipo de terceiros (`yzo-mark.png`) foram utilizados, copiados ou incluídos no FORJA.

3. **Referências anatômicas de validação** (apenas bibliográficas, sem incorporação de imagem)
   - *Terminologia Anatomica* (FIPAT / IFAA, 2ª ed. — TA2).
   - Standring S (ed.). *Gray's Anatomy: The Anatomical Basis of Clinical Practice*.
   - Betts JG et al. *Anatomy and Physiology 2e*, Cap. 11 (*The Muscular System*), OpenStax / Rice University.

---

## 2. Arquivos derivados e licenças aplicáveis

Em conformidade com a cláusula *ShareAlike* das licenças CC BY-SA 2.1 JP (seção 4b — compatibilidade com versões equivalentes posteriores/internacionais) e CC BY-SA 4.0:

| Arquivo no repositório | Tamanho medido | Natureza e licença aplicável |
| --- | --- | --- |
| `assets/anatomia/anterior.svg` | `5.939 bytes` | Prancha ortográfica anterior, `viewBox="0 0 240 520"`, cabeça-aos-pés — **CC BY-SA 4.0** |
| `assets/anatomia/posterior.svg` | `5.404 bytes` | Prancha ortográfica posterior, `viewBox="0 0 240 520"`, cabeça-aos-pés — **CC BY-SA 4.0** |
| `assets/anatomia/anterior.png` | `48.615 bytes` (`47,5 KiB`, `480 × 1040 px`) | Renderização da prancha anterior — **CC BY-SA 4.0** |
| `assets/anatomia/posterior.png` | `48.524 bytes` (`47,4 KiB`, `480 × 1040 px`) | Renderização da prancha posterior — **CC BY-SA 4.0** |
| Dados geométricos `SILHOUETTES` e `REGIONS` em `assets/js/forja-figura.js` | `24.985 bytes` (arquivo completo) | Contornos 2D projetados das pranchas — **CC BY-SA 4.0** |

---

## 3. Distinção jurídica entre recursos anatômicos e código da aplicação

O projeto FORJA **não** passa a estar integralmente sob CC BY-SA por utilizar essas pranchas anatômicas:

- **Recursos anatômicos derivados (`assets/anatomia/*.png`, `*.svg` e coordenadas vetoriais projetadas):** regidos por **CC BY-SA 4.0**, devendo manter este aviso de crédito e a mesma licença caso sejam redistribuídos ou modificados.
- **Código-fonte da aplicação FORJA (HTML, folhas de estilo CSS, lógica JavaScript de catálogo, rotinas, execução, progresso, persistência, testes e scripts em `tools/`):** constitui obra de software independente que apenas agrega e exibe estaticamente os recursos gráficos em tempo de execução, mantendo o licenciamento próprio do repositório sem contaminação documental (*mere aggregation* / separação entre obra artística e programa que a exibe).

---

## 4. Procedimento para regenerar as imagens e os contornos

O script `tools/gerar-anatomia-3d.mjs` reproduz as pranchas e os contornos a partir de malhas 3D abertas (Z-Anatomy + BodyParts3D) e exige o diretório de fontes `ANATOMY_SRC_DIR` com `kas.glb`, `iskelet.glb`, `eklem.glb`, Three.js e `bp3d/FMA7163.stl` — arquivos ausentes neste ambiente de desenvolvimento. Como alternativa direta, as pranchas atuais foram autorais como SVG (`viewBox="0 0 240 520"`) e renderizadas para PNG em navegador headless; os contornos SVG em `assets/js/forja-figura.js` foram projetados sobre as pranchas e validados pixel-a-pixel (cabeça no topo, pés na base, corpo completo em ambas as vistas).

---

## 5. Mapeamento anatômico validado (TA2 → 16 regiões do FORJA)

| ID no FORJA | Vista | Estruturas TA2 projetadas |
| --- | --- | --- |
| `ombros` | Anterior / Posterior | *Deltoideus* — *clavicularis* e *acromialis* (anterior); *spinalis* e *acromialis* (posterior) |
| `peito` | Anterior | *Pectoralis major* (*claviculare*, *sternocostale*, *abdominalis*) |
| `biceps` | Anterior | *Biceps brachii* (*longum*, *breve*), *Brachialis*, *Coracobrachialis* |
| `antebracos` | Anterior / Posterior | Ant.: *Brachioradialis*, *Pronator teres*, flexores carpi/digitorum/pollicis (acima do punho). Post.: *Brachioradialis*, extensores carpi/digitorum/digiti minimi/ulnaris, abdutor/extensor pollicis |
| `abdomem` | Anterior | *Rectus abdominis*, *Pyramidalis*, *Linea alba* |
| `obliquos` | Anterior | *Obliquus externus abdominis* (ventre muscular lateral; aponeurose medial excluída) |
| `quadril` | Anterior | *Tensor fasciae latae*, *Iliopsoas* (*Iliacus*, *Psoas major*), *Pectineus*, *Adductor longus/brevis* proximais |
| `quadriceps` | Anterior | *Quadriceps femoris*: *Rectus femoris*, *Vastus lateralis*, *Vastus medialis*, *Vastus intermedius* |
| `pernas` | Anterior / Posterior | Coxas e pernas do catálogo acima do tornozelo/pé (*Tibialis anterior/posterior*, *Extensor digitorum longus*, *Fibularis longus/brevis*, *Triceps surae*) |
| `costas` | Posterior | *Trapezius* (*descendens, transversa, ascendens*), *Rhomboideus*, *Infraspinatus*, *Teres minor*, *Levator scapulae* |
| `dorsais` | Posterior | *Latissimus dorsi* (ventre dorsolateral) e *Teres major* |
| `lombar` | Posterior | *Erector spinae* lombar, *Multifidus lumborum*, *Quadratus lumborum*, *Fascia thoracolumbalis* |
| `triceps` | Posterior | *Triceps brachii* (*longum*, *laterale*, *mediale*) e *Anconeus* |
| `gluteos` | Posterior | *Gluteus maximus*, *Gluteus medius*, *Gluteus minimus* |
| `posterior-coxa` | Posterior | *Biceps femoris* (*longum*, *breve*), *Semitendinosus*, *Semimembranosus* |
| `panturrilha` | Posterior | *Gastrocnemius* (*mediale*, *laterale*), *Soleus*, *Plantaris* e *Tendo calcaneus* |
