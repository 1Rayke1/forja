import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { launchBrowser, root, startServer, waitReady } from './helpers/browser.mjs';
import { installBrowserAuth } from './helpers/browser-auth.mjs';
import { AuthFixture, PROFILE, USERS } from './helpers/auth-fixture.mjs';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';

function makeHorizontalPng(width = 320, height = 180) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = buf => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height, 0x12);
  for (let y = 0; y < height; y++) raw[y * rowLen] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

async function click(page, selector) {
  await scrollToInteractable(page, selector);
  await page.click(selector);
}

/* Miniatura no tamanho real do YouTube (mqdefault), para o vídeo continuar disponível na sonda. */
const VALID_THUMB_PNG = makeHorizontalPng(320, 180);

const captureDir = path.join(root, '.cache', 'capturas');
fs.mkdirSync(captureDir, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const server = await startServer();
const browser = await launchBrowser();

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('✅ ' + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    const diag = error && error.interaction ? '\n   interaction=' + JSON.stringify(error.interaction) : '';
    console.error('❌ ' + name + '\n   ' + (error && error.stack ? error.stack : error) + diag);
  }
}

try {
  const page = await browser.newPage();
  const errors = [];

  page.on('pageerror', err => errors.push('pageerror: ' + err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });

  const fixture = new AuthFixture();
  await page.evaluateOnNewDocument((values, allowedOrigin) => {
    if (window.location.origin !== allowedOrigin) return;
    if (!localStorage.getItem('__forja_auth_fixture_seeded__')) {
      Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
      localStorage.setItem('__forja_auth_fixture_seeded__', '1');
    }
  }, fixture.seed(USERS.A, { 'forja-perfil-v1': PROFILE }), server.origin);

  await installBrowserAuth(page, fixture, server.origin, {
    seed: false,
    async respondApi(req) {
      const url = req.url();
      if (url.startsWith('https://www.youtube-nocookie.com/embed/')) {
        await req.respond({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html><body style="margin:0;background:#0d0f0d;color:#f4f7f3;display:grid;place-items:center;height:100vh;font:600 14px sans-serif"><span>Player Oficial 16:9 (sem autoplay)</span></body></html>'
        });
        return true;
      }
      if (url.startsWith('https://i.ytimg.com/vi/') || url.startsWith('https://img.youtube.com/vi/')) {
        await req.respond({
          status: 200,
          contentType: 'image/png',
          body: VALID_THUMB_PNG
        });
        return true;
      }
      return false;
    }
  });

  /* Viewport Android prioritário (Pixel / Galaxy S: 412×915 e 390×844). */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await step('1. Abrir treino real com dados dinâmicos, foto exata, anéis SVG e faixa de séries', async () => {
    await page.goto(server.origin + '/forja/treino/', { waitUntil: 'networkidle0' });
    await waitReady(page);

    await page.evaluate(() => {
      const ex1 = {
        id: 'ex-remada',
        libraryId: 'mus-puxada-frontal',
        name: 'Puxada frontal aberta',
        section: 'warmup',
        sets: 3,
        type: 'reps',
        reps: '12',
        duration: 45,
        rest: 45,
        load: '45 kg',
        notes: ''
      };
      const ex2 = {
        id: 'ex-supino',
        libraryId: 'mus-supino-reto',
        name: 'Supino reto com barra',
        section: 'main',
        sets: 4,
        type: 'reps',
        reps: '8 - 12',
        duration: 45,
        rest: 60,
        load: '60 kg',
        notes: 'Alternativa compatível: Supino com halteres.',
        youtubeVideo: {
          videoId: 'BenchDemo01',
          title: 'Supino Reto Execução',
          channelTitle: 'FORJA Técnica',
          durationSeconds: 32,
          orientation: 'horizontal',
          framing: 'original'
        }
      };
      const ex3 = {
        id: 'ex-elevacao',
        libraryId: null,
        name: 'Elevação lateral unilateral no banco inclinado',
        section: 'finisher',
        sets: 3,
        type: 'reps',
        reps: '12 - 15',
        duration: 45,
        rest: 45,
        load: '12 kg',
        notes: ''
      };

      const routine = {
        id: 'rotina-peito-costas',
        name: 'Força Tronco B',
        modality: 'weights',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sections: { warmup: [ex1], main: [ex2], abs: [], finisher: [ex3] }
      };

      const store = { calisthenics: [], weights: [routine] };
      window.Forja.store.driver().setItem('forja-treino-rotinas-v1', JSON.stringify(store));

      const today = new Date().toISOString().slice(0, 10);
      window.Forja.store.driver().setItem('forja-treino-sessao-ativa-v1', JSON.stringify({
        version: 2,
        id: 'sess-real-mobile',
        date: today,
        modality: 'weights',
        routineId: routine.id,
        routineName: routine.name,
        startedAt: Date.now() - 420000,
        elapsedMs: 0,
        running: true,
        currentIndex: 1,
        completedSets: { 'ex-remada': 3, 'ex-supino': 1, 'ex-elevacao': 0 },
        totalPlannedSets: 10,
        queue: [ex1, ex2, ex3],
        status: 'active',
        restEndAt: null,
        restRemainingMs: 0,
        restPaused: false,
        pendingAdvance: false,
        restPlannedSeconds: 0,
        setTimer: null,
        setLogs: {
          'ex-remada': [
            { set: 1, reps: '12', load: '45 kg', seconds: null, distance: null, rpe: 7, editedAt: null },
            { set: 2, reps: '12', load: '45 kg', seconds: null, distance: null, rpe: 8, editedAt: null },
            { set: 3, reps: '12', load: '45 kg', seconds: null, distance: null, rpe: 8, editedAt: null }
          ],
          'ex-supino': [
            { set: 1, reps: '10', load: '60 kg', seconds: null, distance: null, rpe: 8, editedAt: null }
          ],
          'ex-elevacao': []
        },
        logDraft: {}
      }));
    });

    await page.goto(server.origin + '/forja/treino/executar.html', { waitUntil: 'networkidle0' });
    await waitReady(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(150);

    const ui = await page.evaluate(() => {
      const heroImg = document.querySelector('#execution-hero-media img');
      const heroBox = document.getElementById('execution-hero').getBoundingClientRect();
      const heroImgBox = heroImg ? heroImg.getBoundingClientRect() : null;
      const ringOffset = document.getElementById('execution-ring-progress').style.strokeDashoffset;
      const dialOffset = document.getElementById('series-ring-arc').style.strokeDashoffset;
      return {
        heroHeight: Math.round(heroBox.height),
        heroWidth: Math.round(heroBox.width),
        heroImgHeight: heroImgBox ? Math.round(heroImgBox.height) : 0,
        viewportWidth: window.innerWidth,
        heroImgFit: heroImg ? getComputedStyle(heroImg).objectFit : "",
        logo: document.querySelector('.exec-brand-logo')?.textContent.trim(),
        endVisible: !document.getElementById('end-session').hidden,
        eyebrow: document.getElementById('execution-status-eyebrow').textContent.trim(),
        title: document.getElementById('execution-title').textContent.trim(),
        modality: document.getElementById('execution-mode').textContent.trim(),
        estimate: document.getElementById('execution-estimate').textContent.trim(),
        percent: document.getElementById('execution-progress-percent').textContent.trim(),
        exCount: document.getElementById('execution-progress-count').textContent.trim(),
        ringOffset: Number(ringOffset),
        position: document.getElementById('current-position').textContent.trim(),
        name: document.getElementById('current-name').textContent.trim(),
        complement: document.getElementById('current-complement').textContent.trim(),
        hasExactPhoto: Boolean(heroImg && heroImg.complete && heroImg.naturalWidth > 0 && heroImg.currentSrc.includes('supino-barra')),
        seriesStrip: document.getElementById('active-series-value').textContent.replace(/\s+/g, ' ').trim(),
        repsStrip: document.getElementById('current-plan-value').textContent.trim(),
        restStrip: document.getElementById('current-rest-value').textContent.trim(),
        dialEyebrow: document.getElementById('series-dial-eyebrow').textContent.trim(),
        dialValue: document.getElementById('series-dial-value').textContent.trim(),
        dialUnit: document.getElementById('series-dial-unit').textContent.trim(),
        dialOffset: Number(dialOffset),
        hasSessionNotes: Boolean(document.getElementById('session-notes')),
        hasLogPanel: Boolean(document.getElementById('log-panel') || document.getElementById('execution-details-zone')),
        hasAnatomyFigure: Boolean(document.getElementById('execution-figure') || document.querySelector('.figura-svg')),
        hasReferenceBlock: Boolean(document.getElementById('execution-demo')) ||
          /Referência\s*·\s*Treino|Registre as séries conforme forem concluídas|Alternativa compatível/i.test(document.body.textContent),
        prevDisabled: document.getElementById('previous-exercise').disabled,
        nextDisabled: document.getElementById('next-exercise').disabled
      };
    });

    assert.equal(ui.logo, 'FORJA');
    assert.equal(ui.endVisible, true);
    assert.equal(ui.eyebrow, 'TREINO EM ANDAMENTO');
    assert.equal(ui.title, 'Força Tronco B');
    assert.equal(ui.modality, 'Musculação');
    assert.match(ui.estimate, /^· ~\d+ min$/);
    assert.equal(ui.percent, '40%'); // 4 de 10 séries reais concluídas
    assert.equal(ui.exCount, '1 de 3'); // 1 de 3 exercícios totalmente concluídos
    assert.ok(ui.ringOffset > 0 && ui.ringOffset < 201, 'Anel SVG deve refletir 40%');
    assert.equal(ui.position, 'Exercício 2 de 3');
    assert.equal(ui.name, 'Supino reto com barra');
    assert.equal(ui.complement, 'Barra · Carga: 60 kg');
    assert.equal(ui.hasExactPhoto, true, 'Deveria exibir foto exata local do supino reto');
    /*
      A imagem de demonstração precisa aparecer grande: o herói ocupa toda a
      largura do celular e passa da altura antiga (192 px), com a foto
      inteira no quadro (cover sem esticar) — e sem empurrar os controles de
      série/descanso para fora da primeira tela.
    */
    assert.equal(ui.heroWidth, ui.viewportWidth, 'A imagem deve ocupar toda a largura disponível');
    assert.ok(ui.heroHeight >= 205, 'Imagem de demonstração pequena: ' + ui.heroHeight + 'px');
    assert.equal(ui.heroImgHeight, ui.heroHeight, 'A foto deve preencher o bloco de demonstração');
    assert.equal(ui.heroImgFit, 'cover');
    assert.equal(ui.seriesStrip, '2 de 4');
    assert.equal(ui.repsStrip, '8 - 12');
    assert.equal(ui.restStrip, '60 s');
    assert.equal(ui.dialEyebrow, 'SÉRIE EM ANDAMENTO');
    assert.equal(ui.dialValue, '8');
    assert.equal(ui.dialUnit, 'DE 12 REPETIÇÕES');
    assert.ok(ui.dialOffset > 180 && ui.dialOffset < 210, 'Arco central deve refletir 8 de 12 repetições');
    assert.equal(ui.hasSessionNotes, false, 'Card de Observação deve ser completamente removido');
    assert.equal(ui.hasLogPanel, false, 'Card Registro da série deve ser completamente removido');
    assert.equal(ui.hasAnatomyFigure, false, 'Ilustração anatômica deve ser completamente removida');
    assert.equal(ui.hasReferenceBlock, false, 'Seção Referência · Treino Principal deve ser completamente removida');
    assert.equal(ui.prevDisabled, false);
    assert.equal(ui.nextDisabled, false);

    await page.screenshot({ path: path.join(captureDir, 'treino-em-andamento-mobile-390.png') });
  });

  await step('2. Círculo central interativo: conta repetições, conclui série e vira TEMPO DE DESCANSO no mesmo círculo', async () => {
    /* Tocar duas vezes no círculo central incrementa 8 -> 9 -> 10 repetições reais. */
    await click(page, '#series-dial-trigger');
    await click(page, '#series-dial-trigger');
    const tapped = await page.evaluate(() => ({
      dialValue: document.getElementById('series-dial-value').textContent.trim(),
      dialUnit: document.getElementById('series-dial-unit').textContent.trim(),
      dialOffset: Number(document.getElementById('series-ring-arc').style.strokeDashoffset)
    }));
    assert.equal(tapped.dialValue, '10');
    assert.equal(tapped.dialUnit, 'DE 12 REPETIÇÕES');
    assert.ok(tapped.dialOffset > 90 && tapped.dialOffset < 105, 'Arco central deve avançar para 10/12');

    /* Três cliques rápidos consecutivos em Concluir série concluem apenas 1 série. */
    await page.evaluate(() => {
      const btn = document.getElementById('complete-set');
      btn.click();
      btn.click();
      btn.click();
    });
    await sleep(180);

    const afterSet = await page.evaluate(() => ({
      completedSupino: window.Forja.state.activeWorkout.completedSets['ex-supino'],
      loggedReps: window.Forja.state.activeWorkout.setLogs['ex-supino'].at(-1).reps,
      percent: document.getElementById('execution-progress-percent').textContent.trim(),
      seriesStrip: document.getElementById('active-series-value').textContent.replace(/\s+/g, ' ').trim(),
      dialEyebrow: document.getElementById('series-dial-eyebrow').textContent.trim(),
      dialValue: document.getElementById('series-dial-value').textContent.trim(),
      dialUnit: document.getElementById('series-dial-unit').textContent.trim(),
      dialIsRest: document.getElementById('series-dial-trigger').classList.contains('is-rest'),
      restVisible: !document.getElementById('execution-rest').hidden,
      restTimer: document.getElementById('rest-timer').textContent.trim(),
      completeDisabled: document.getElementById('complete-set').disabled
    }));

    assert.equal(afterSet.completedSupino, 2, 'Clique duplo não pode concluir duas séries');
    assert.equal(afterSet.loggedReps, '10', 'Repetições ajustadas no círculo central devem ser gravadas no log da série');
    assert.equal(afterSet.percent, '50%');
    assert.equal(afterSet.seriesStrip, '3 de 4');
    assert.equal(afterSet.dialEyebrow, 'TEMPO DE DESCANSO', 'Mesmo círculo central deve assumir o estado de descanso');
    assert.match(afterSet.dialValue, /^0(0:5\d|1:00)$/, 'Círculo central deve exibir o cronômetro regressivo');
    assert.equal(afterSet.dialUnit, 'PRÓXIMA: SÉRIE 3 DE 4');
    assert.equal(afterSet.dialIsRest, true);
    assert.equal(afterSet.restVisible, true);
    assert.match(afterSet.restTimer, /^0(0:5\d|1:00)$/);
    assert.equal(afterSet.completeDisabled, true);

    await sleep(1100);
    const tickedDial = await page.$eval('#series-dial-value', el => el.textContent.trim());
    assert.match(tickedDial, /^00:5\d$/, 'Círculo central deve atualizar a contagem regressiva a cada segundo');

    await page.screenshot({ path: path.join(captureDir, 'treino-em-andamento-descanso-390.png') });

    /* Pular descanso encerra timer, restaura o círculo central para SÉRIE EM ANDAMENTO e reabilita Concluir série. */
    await click(page, '#skip-rest');
    await sleep(160);

    const afterSkip = await page.evaluate(() => ({
      restHidden: document.getElementById('execution-rest').hidden,
      restEndAt: window.Forja.state.activeWorkout.restEndAt,
      dialEyebrow: document.getElementById('series-dial-eyebrow').textContent.trim(),
      dialUnit: document.getElementById('series-dial-unit').textContent.trim(),
      completeDisabled: document.getElementById('complete-set').disabled
    }));
    assert.equal(afterSkip.restHidden, true);
    assert.equal(afterSkip.restEndAt, null);
    assert.equal(afterSkip.dialEyebrow, 'SÉRIE EM ANDAMENTO');
    assert.equal(afterSkip.dialUnit, 'DE 12 REPETIÇÕES');
    assert.equal(afterSkip.completeDisabled, false);
  });

  await step('3. Navegação Anterior e Próximo preserva séries, não auto-conclui e respeita bordas + fallback sem foto', async () => {
    /* Avançar para o 3º exercício (último, sem foto exata e sem vídeo customizado). */
    await click(page, '#next-exercise');
    await sleep(150);

    const onLast = await page.evaluate(() => ({
      index: window.Forja.state.activeWorkout.currentIndex,
      supinoSets: window.Forja.state.activeWorkout.completedSets['ex-supino'],
      elevacaoSets: window.Forja.state.activeWorkout.completedSets['ex-elevacao'],
      name: document.getElementById('current-name').textContent.trim(),
      semFotoClass: document.getElementById('execution-hero').classList.contains('sem-foto'),
      heroImgCount: document.querySelectorAll('#execution-hero-media img').length,
      prevDisabled: document.getElementById('previous-exercise').disabled,
      nextDisabled: document.getElementById('next-exercise').disabled
    }));

    assert.equal(onLast.index, 2);
    assert.equal(onLast.supinoSets, 2, 'Navegar não pode concluir nem zerar séries do exercício anterior');
    assert.equal(onLast.elevacaoSets, 0);
    assert.equal(onLast.name, 'Elevação lateral unilateral no banco inclinado');
    assert.equal(onLast.semFotoClass, true, 'Exercício sem foto exata deve usar fallback neutro sem foto emprestada');
    assert.equal(onLast.heroImgCount, 0, 'Não pode carregar foto de outro exercício');
    assert.equal(onLast.prevDisabled, false);
    assert.equal(onLast.nextDisabled, true, 'No último exercício pendente, Próximo deve ficar desabilitado');

    /* Voltar até o 1º exercício e verificar borda esquerda + séries preservadas. */
    await click(page, '#previous-exercise');
    await sleep(100);
    await click(page, '#previous-exercise');
    await sleep(120);

    const onFirst = await page.evaluate(() => ({
      index: window.Forja.state.activeWorkout.currentIndex,
      name: document.getElementById('current-name').textContent.trim(),
      remadaSets: window.Forja.state.activeWorkout.completedSets['ex-remada'],
      prevDisabled: document.getElementById('previous-exercise').disabled,
      nextDisabled: document.getElementById('next-exercise').disabled
    }));

    assert.equal(onFirst.index, 0);
    assert.equal(onFirst.name, 'Puxada frontal aberta');
    assert.equal(onFirst.remadaSets, 3);
    assert.equal(onFirst.prevDisabled, true, 'No primeiro exercício, Anterior deve ficar desabilitado');
    assert.equal(onFirst.nextDisabled, false);

    /* Retorna ao 2º exercício (Supino). */
    await click(page, '#next-exercise');
    await sleep(300);
  });

  await step('4. Ver demonstração mostra só atlas + vídeo, sem textos editoriais, e fallback limpo sem vídeo', async () => {
    await click(page, '#execution-instructions');
    await page.waitForSelector('.modal-backdrop', { timeout: 4000 });
    await page.waitForSelector('.modal-backdrop .video-demo-iframe', { timeout: 4000 });

    const demoSrc = await page.$eval('.modal-backdrop .video-demo-iframe', el => el.getAttribute('src'));
    assert.match(demoSrc, /^https:\/\/www\.youtube-nocookie\.com\/embed\/BenchDemo01\?/);
    assert.match(demoSrc, /autoplay=0/);
    assert.match(demoSrc, /controls=1/);

    const screen = await page.evaluate(() => {
      const card = document.querySelector('.modal-backdrop .modal-card');
      const atlas = card.querySelector('[data-detail-section="atlas"]');
      return {
        sections: Array.from(card.querySelectorAll('.modal-details > *'))
          .map(node => node.getAttribute('data-detail-section')).filter(Boolean),
        headings: Array.from(card.querySelectorAll('.bl-detail-heading'))
          .map(node => node.textContent.trim()),
        regions: atlas
          ? Array.from(atlas.querySelectorAll('.figura-region')).map(node => node.dataset.region + ':' + node.dataset.role)
          : [],
        atlasFigures: atlas ? atlas.querySelectorAll('.figura-svg').length : 0,
        writtenLegend: Boolean(card.querySelector('.bl-detail-atlas-key, .atlas-legenda')),
        /* O canal do vídeo pode conter palavras como "Técnica"; a checagem
           ignora a linha de créditos do player e olha só o conteúdo do modal. */
        editorialText: (() => {
          const clone = card.cloneNode(true);
          clone.querySelectorAll('.video-demo-meta').forEach(node => node.remove());
          return /Técnica|Cuidados|Suas observações|Observação salva|Alternativa compatível|Principal|Secundário/.test(clone.textContent);
        })(),
        hasPhotoBlock: Boolean(card.querySelector('.bl-detail-photo, [data-detail-section="identificacao"]'))
      };
    });

    assert.deepEqual(screen.sections, ['atlas', 'video'], 'Demonstração deve ter somente atlas e vídeo');
    assert.deepEqual(screen.headings, ['Atlas muscular', 'Demonstração']);
    assert.equal(screen.atlasFigures, 2, 'O atlas deve mostrar as duas vistas da prancha existente');
    assert.ok(screen.regions.includes('peito:primary'), 'Peitoral deve ser o grupo principal do supino');
    assert.ok(screen.regions.includes('triceps:secondary'), 'Tríceps deve aparecer como secundário');
    assert.equal(screen.writtenLegend, false, 'Legenda escrita/tabela de papéis não entra na demonstração');
    assert.equal(screen.editorialText, false, 'Textos editoriais não podem voltar para a demonstração');
    assert.equal(screen.hasPhotoBlock, false, 'A demonstração não repete a foto de identificação');

    await page.keyboard.press('Escape');
    await sleep(150);
    assert.equal(await page.$('.modal-backdrop'), null);

    /* No 3º exercício sem vídeo cadastrado, Ver demonstração mostra fallback sem quebrar. */
    await click(page, '#next-exercise');
    await sleep(120);
    await click(page, '#execution-instructions');
    await page.waitForSelector('.modal-backdrop [data-detail-section="video"]', { timeout: 4000 });

    const fallbackInfo = await page.evaluate(() => ({
      hasIframe: Boolean(document.querySelector('.modal-backdrop .video-demo-iframe')),
      unavailableNote: document.querySelector('.modal-backdrop .video-demo-unavailable')?.textContent.trim() || ''
    }));
    assert.equal(fallbackInfo.hasIframe, false);
    assert.match(fallbackInfo.unavailableNote, /não há vídeo|não disponível/i);

    await page.keyboard.press('Escape');
    await sleep(150);
    await click(page, '#previous-exercise');
    await sleep(120);
  });

  await step('5. Pausar treino, Mais opções e Encerrar com confirmação funcionam e preservam estado', async () => {
    await click(page, '#pause-session');
    await sleep(150);

    const pausedState = await page.evaluate(() => ({
      running: window.Forja.state.activeWorkout.running,
      bannerVisible: !document.getElementById('session-paused-overlay').hidden,
      resumeVisible: !document.getElementById('resume-session').hidden,
      dialEyebrow: document.getElementById('series-dial-eyebrow').textContent.trim()
    }));
    assert.equal(pausedState.running, false);
    assert.equal(pausedState.bannerVisible, true);
    assert.equal(pausedState.resumeVisible, true);
    assert.equal(pausedState.dialEyebrow, 'TREINO PAUSADO');

    /* Recarregar mantém pausado e todas as séries intactas. */
    await page.reload({ waitUntil: 'networkidle0' });
    await waitReady(page);
    assert.equal(await page.evaluate(() => window.Forja.state.activeWorkout.running), false);
    assert.equal(await page.evaluate(() => window.Forja.state.activeWorkout.completedSets['ex-supino']), 2);

    await click(page, '#resume-session');
    await sleep(150);
    assert.equal(await page.evaluate(() => window.Forja.state.activeWorkout.running), true);

    /* Mais opções abre apenas opções reais e fechar não altera a sessão. */
    await click(page, '#execution-more-options');
    await page.waitForSelector('.modal-backdrop', { timeout: 4000 });
    const optionLabels = await page.$$eval('.modal-backdrop [data-modal-action]', btns =>
      btns.map(b => b.textContent.trim())
    );
    assert.ok(optionLabels.includes('Registrar carga / repetições'));
    assert.ok(optionLabels.includes('Corrigir série 2'));
    assert.ok(optionLabels.some(label => label.startsWith('Iniciar descanso')));
    assert.ok(!optionLabels.includes('Ver músculos trabalhados'), 'Não deve expor figura anatômica na execução');
    assert.ok(optionLabels.includes('Pular exercício'));
    assert.ok(optionLabels.includes('Voltar aos treinos (manter ativo)'));

    /* Registrar carga / repetições usa modal limpo, nunca card inferior na página. */
    await page.click('[data-modal-action="log"]');
    await page.waitForSelector('[data-modal-field="load"]', { timeout: 4000 });
    await page.$eval('[data-modal-field="load"]', el => {
      el.value = '62 kg';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('[data-modal-action="save"]');
    await sleep(150);
    assert.equal(await page.$('#log-panel'), null, 'Nenhum card inferior pode aparecer após salvar parâmetros');
    assert.equal(await page.evaluate(() => window.Forja.state.activeWorkout.logDraft['ex-supino'].load), '62 kg');

    /* Encerrar pede confirmação: cancelar mantém treino; salvar registra parcial. */
    await click(page, '#end-session');
    await page.waitForSelector('.modal-backdrop', { timeout: 4000 });
    assert.equal(await page.$eval('#modal-title', el => el.textContent.trim()), 'Encerrar sessão?');
    await page.click('[data-modal-action="cancel"]');
    await sleep(150);
    assert.ok(await page.evaluate(() => Boolean(window.Forja.state.activeWorkout)));
  });

  await step('6. Responsividade Android/mobile e desktop: zero overflow, nomes sem corte e alvos >= 44px', async () => {
    for (const vp of [
      { width: 320, height: 568 },
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
      { width: 768, height: 1024 },
      { width: 1280, height: 900 }
    ]) {
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await sleep(80);

      const layout = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const nameEl = document.getElementById('current-name');
        const titleEl = document.getElementById('execution-title');
        const heroEl = document.getElementById('execution-hero');
        const heroImg = document.querySelector('#execution-hero-media img');
        const heroBox = heroEl.getBoundingClientRect();
        const heroImgBox = heroImg ? heroImg.getBoundingClientRect() : null;
        const targets = [
          '#end-session',
          '#execution-instructions',
          '#series-dial-trigger',
          '#previous-exercise',
          '#next-exercise',
          '#complete-set',
          '#pause-session',
          '#execution-more-options'
        ].map(sel => {
          const el = document.querySelector(sel);
          const r = el.getBoundingClientRect();
          return { sel, w: Math.round(r.width), h: Math.round(r.height) };
        });
        return {
          overflow,
          nameClipped: nameEl.scrollWidth > nameEl.clientWidth + 1,
          titleClipped: titleEl.scrollWidth > titleEl.clientWidth + 1,
          smallTargets: targets.filter(t => t.h < 44 || t.w < 44),
          heroWidth: Math.round(heroBox.width),
          heroHeight: Math.round(heroBox.height),
          heroImgHeight: heroImgBox ? Math.round(heroImgBox.height) : 0
        };
      });

      assert.ok(layout.overflow <= 1, `Overflow horizontal (${layout.overflow}px) em ${vp.width}x${vp.height}`);
      assert.equal(layout.nameClipped, false, `Nome do exercício cortado em ${vp.width}px`);
      assert.equal(layout.titleClipped, false, `Título do treino cortado em ${vp.width}px`);
      assert.deepEqual(layout.smallTargets, [], `Alvos menores que 44px em ${vp.width}px: ${JSON.stringify(layout.smallTargets)}`);
      /* A demonstração continua grande e proporcional em toda a matriz. */
      assert.equal(layout.heroWidth, Math.min(vp.width, 540),
        `Demonstração fora da largura disponível em ${vp.width}px`);
      assert.ok(layout.heroHeight >= 190 && layout.heroHeight <= 320,
        `Altura da demonstração fora da faixa em ${vp.width}px: ${layout.heroHeight}`);
      assert.equal(layout.heroImgHeight, layout.heroHeight,
        `Foto não preenche a demonstração em ${vp.width}px`);

      if (vp.width === 412) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(80);
        await page.screenshot({ path: path.join(captureDir, 'treino-em-andamento-android-412x915.png') });
      }
    }
  });

  await step('7. Encerrar e salvar grava progresso parcial real no histórico sem erros de JS', async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await click(page, '#end-session');
    await page.waitForSelector('[data-modal-action="save"]', { timeout: 4000 });
    await page.click('[data-modal-action="save"]');
    await page.waitForSelector('#execution-summary:not([hidden])', { timeout: 4000 });

    const summary = await page.evaluate(() => ({
      endHidden: document.getElementById('end-session').hidden,
      sets: document.getElementById('summary-sets').textContent.trim(),
      status: document.getElementById('summary-status-stat').textContent.trim()
    }));
    assert.equal(summary.endHidden, true);
    assert.equal(summary.sets, '5/10');
    assert.equal(summary.status, 'Parcial');
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter(r => !r.ok);
console.log('\n' + '='.repeat(66));
console.log(`EXECUÇÃO REFERÊNCIA E2E — ${results.length - failed.length}/${results.length} cenários aprovados`);
console.log('='.repeat(66));
if (failed.length > 0) process.exit(1);
