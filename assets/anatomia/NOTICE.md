# Aviso de Atribuição e Licença — Recursos Anatômicos (`assets/anatomia/`)

Os arquivos de imagem `assets/anatomia/anterior.png` e `assets/anatomia/posterior.png`, bem como os contornos vetoriais projetados das 16 regiões musculares embutidos nas constantes `SILHOUETTES` e `REGIONS` de `assets/js/forja-figura.js`, são adaptações pré-renderizadas a partir de modelos anatômicos tridimensionais abertos licenciados sob Creative Commons Attribution-ShareAlike.

---

## 1. Origem dos modelos e créditos exigidos

1. **BodyParts3D / Anatomography**
   - **Autoria e crédito:** *BodyParts3D, © The Database Center for Life Science (DBCLS), Research Organization of Information and Systems (ROIS), Japão.*
   - **Referência científica:** Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K. *BodyParts3D: 3D structure database for anatomical concepts.* Nucleic Acids Research. 2009;37(Database issue):D782–D785.
   - **Licença original:** [Creative Commons Attribution-ShareAlike 2.1 Japan (CC BY-SA 2.1 JP)](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en).
   - **Material utilizado:** Geometria tridimensional derivada de ressonância magnética de corpo inteiro, incluindo o envelope craniofacial externo (`FMA7163.stl`, superfície externa isolada e alinhada à pose ortográfica).

2. **Z-Anatomy — Models of Human Anatomy**
   - **Autoria e crédito:** *Z-Anatomy (Gauthier Kervyn e colaboradores), derivado do BodyParts3D e estruturado segundo a Terminologia Anatomica (TA2).*
   - **Licença original:** [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).
   - **Material utilizado:** Malhas tridimensionais glTF dos sistemas muscular (`kas.glb`), esquelético (`iskelet.glb`) e articular (`eklem.glb`), a partir da exportação pública documentada em `Z-Anatomy/Models-of-human-anatomy` e `DrMuratAltun/anatomi-simulatoru`.
   - **Exclusões verificadas:** Nenhum modelo visceral (`ic-organlar.glb`) e nenhuma marca ou logotipo de terceiros (`yzo-mark.png`) foram utilizados, copiados ou incluídos no FORJA.

3. **Referências anatômicas de validação**
   - *Terminologia Anatomica* (FIPAT / IFAA, 2ª ed. — TA2).
   - Standring S (ed.). *Gray's Anatomy: The Anatomical Basis of Clinical Practice*.
   - Betts JG et al. *Anatomy and Physiology 2e*, Cap. 11 (*The Muscular System*), OpenStax / Rice University (usado apenas como referência bibliográfica de validação, sem incorporação de imagem).

---

## 2. Arquivos derivados e licenças aplicáveis

Em conformidade com a cláusula *ShareAlike* das licenças CC BY-SA 2.1 JP (seção 4b — compatibilidade com versões equivalentes posteriores/internacionais) e CC BY-SA 4.0:

| Arquivo no repositório | Tamanho medido | Natureza e licença aplicável |
| --- | --- | --- |
| `assets/anatomia/anterior.png` | `102.962 bytes` (`100,5 KiB`, `480 × 1040 px`) | Adaptação derivada (prancha ortográfica anterior) — **CC BY-SA 4.0** |
| `assets/anatomia/posterior.png` | `92.843 bytes` (`90,7 KiB`, `480 × 1040 px`) | Adaptação derivada (prancha ortográfica posterior) — **CC BY-SA 4.0** |
| Dados geométricos `SILHOUETTES` e `REGIONS` em `assets/js/forja-figura.js` | `52.186 bytes` (`51,0 KiB` de caminhos SVG; arquivo completo `63.118 bytes` / `61,6 KiB`) | Contornos 2D projetados das malhas 3D — **CC BY-SA 4.0** |

### Modificações realizadas sobre os modelos originais

1. Renderização ortográfica simétrica nas vistas **anterior** e **posterior** na mesma escala (`480 × 1040 px`, equivalente a `2×` Retina sobre `viewBox="0 0 240 520"`), com iluminação neutra de estúdio em tom mineral-ardósia e codificação PNG indexada de 8 bits com transparência limpa.
2. Substituição da exposição craniofacial profunda (ossos cranianos, dentes e músculos da mímica) pela casca craniofacial externa contínua do BodyParts3D (`FMA7163`), mantendo leitura calma e foco no sistema musculoesquelético de treino.
3. Ocultação de bainhas fasciais superficiais difusas, bursas e músculos do assoalho pélvico/períneo, preservando tendões estruturais de referência (`Linea alba`, `Posterior layer of thoracolumbar fascia`, `Iliotibial tract`, `Calcaneal tendon`).
4. Extração automática dos contornos 2D das 16 regiões musculares do catálogo com oclusão real de profundidade no buffer WebGL, *Marching Squares* orientado e simplificação em curvas de Bézier cúbicas fechadas, incluindo recorte geométrico de aponeuroses largas para separar `abdomem`/`obliquos` e `dorsais`/`lombar`.

---

## 3. Distinção jurídica entre recursos anatômicos e código da aplicação

O projeto FORJA **não** passa a estar integralmente sob CC BY-SA por utilizar essas pranchas anatômicas:

- **Recursos anatômicos derivados (`assets/anatomia/*.png` e coordenadas vetoriais projetadas):** regidos por **CC BY-SA 4.0**, devendo manter este aviso de crédito e a mesma licença caso sejam redistribuídos ou modificados.
- **Código-fonte da aplicação FORJA (HTML, folhas de estilo CSS, lógica JavaScript de catálogo, rotinas, execução, progresso, persistência, testes e scripts em `tools/`):** constitui obra de software independente que apenas agrega e exibe estaticamente os recursos gráficos em tempo de execução, mantendo o licenciamento próprio do repositório sem contaminação documental (*mere aggregation* / separação entre obra artística e programa que a exibe).

---

## 4. Procedimento para regenerar as imagens e os contornos

O script autocontido `tools/gerar-anatomia-3d.mjs` reproduz integralmente as pranchas e os contornos sem exigir WebGL no cliente final:

1. Reúna em um diretório externo ao Git (ex.: `/tmp/anatomy_src`):
   - `zanatomy/systems/kas.glb`, `zanatomy/systems/iskelet.glb`, `zanatomy/systems/eklem.glb` (pacote glTF Z-Anatomy);
   - `zanatomy/vendor/three/` (Three.js ESM para renderização local em navegador headless);
   - `bp3d/FMA7163.stl` (envelope externo BodyParts3D).
2. Instale as dependências de desenvolvimento na raiz do repositório (`npm ci`).
3. Execute:
   ```bash
   # Regenerar as pranchas assets/anatomia/anterior.png e posterior.png:
   ANATOMY_SRC_DIR=/tmp/anatomy_src node tools/gerar-anatomia-3d.mjs

   # Regenerar também os contornos SVG em assets/js/forja-figura.js:
   ANATOMY_SRC_DIR=/tmp/anatomy_src node tools/gerar-anatomia-3d.mjs --contornos
   ```
   *(Em ambientes Linux sem bibliotecas gráficas globais para o `@sparticuz/chromium`, adicione `AWS_LAMBDA_JS_RUNTIME=nodejs22.x` antes do comando `node`.)*

---

## 5. Mapeamento anatômico validado (TA2 → 16 regiões do FORJA)

| ID no FORJA | Vista | Estruturas TA2 projetadas da malha 3D |
| --- | --- | --- |
| `ombros` | Anterior / Posterior | *Deltoideus* — *pars clavicularis* e *pars acromialis* (anterior); *pars spinalis* e *pars acromialis* (posterior) |
| `peito` | Anterior | *Pectoralis major* (*caput claviculare*, *caput sternocostale*, *pars abdominalis*) |
| `biceps` | Anterior | *Biceps brachii* (*caput longum*, *caput breve*), *Brachialis*, *Coracobrachialis* |
| `antebracos` | Anterior / Posterior | Anterior: *Brachioradialis*, *Pronator teres*, *Flexor carpi radialis/ulnaris*, *Palmaris longus*, *Flexor digitorum superficialis/profundus*, *Flexor pollicis longus* (acima do punho). Posterior: *Brachioradialis*, *Extensor carpi radialis longus/brevis*, *Extensor digitorum*, *Extensor digiti minimi*, *Extensor carpi ulnaris*, *Abductor/Extensor pollicis* |
| `abdomem` | Anterior | *Rectus abdominis*, *Pyramidalis*, *Linea alba* |
| `obliquos` | Anterior | *Obliquus externus abdominis* (ventre muscular lateral; excluída a aponeurose medial sobre a bainha do reto) |
| `quadril` | Anterior | *Tensor fasciae latae*, *Iliopsoas* (*Iliacus*, *Psoas major*), *Pectineus*, *Adductor longus/brevis* proximais |
| `quadriceps` | Anterior | *Quadriceps femoris*: *Rectus femoris*, *Vastus lateralis*, *Vastus medialis*, *Vastus intermedius* |
| `pernas` | Anterior / Posterior | Região ampla de membros inferiores do catálogo: coxas (quadríceps/isquiotibiais, sartório, adutores, trato iliotibial) e pernas (*Tibialis anterior/posterior*, *Extensor digitorum longus*, *Fibularis longus/brevis*, *Triceps surae*), acima do tornozelo/pé |
| `costas` | Posterior | *Trapezius* (*pars descendens, transversa, ascendens*), *Rhomboideus major/minor*, *Infraspinatus*, *Teres minor*, *Levator scapulae* |
| `dorsais` | Posterior | *Latissimus dorsi* (ventre contrátil dorsolateral) e *Teres major* |
| `lombar` | Posterior | *Erector spinae* lombar (*Iliocostalis lumborum*, *Longissimus thoracis* porção lombar), *Multifidus lumborum*, *Quadratus lumborum* e *Fascia thoracolumbalis* |
| `triceps` | Posterior | *Triceps brachii* (*caput longum*, *caput laterale*, *caput mediale*) e *Anconeus* |
| `gluteos` | Posterior | *Gluteus maximus*, *Gluteus medius*, *Gluteus minimus* |
| `posterior-coxa` | Posterior | *Biceps femoris* (*caput longum*, *caput breve*), *Semitendinosus*, *Semimembranosus* |
| `panturrilha` | Posterior | *Gastrocnemius* (*caput mediale*, *caput laterale*), *Soleus*, *Plantaris* e *Tendo calcaneus* |
