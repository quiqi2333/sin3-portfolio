(() => {
  'use strict';

  const PAGE_COUNT = Number(document.querySelector('#book')?.dataset.pageCount) || 13;
  const NAMESPACE = document.querySelector('#book')?.dataset.namespace || 'sin3-salt-album';
  const PAGE_RATIO = Number(document.querySelector('#book')?.dataset.pageRatio) || 1.295;
  const PAGE_LABEL = document.querySelector('#book')?.dataset.pageLabel || '空间影集';
  const params = new URLSearchParams(location.search);
  const requestedPage = Number(params.get('page')) || 1;
  const canSpread = params.get('canSpread') === '1';
  const mode = params.get('mode') === 'spread' && canSpread ? 'spread' : 'single';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = document.querySelector('#reader-stage');
  const book = document.querySelector('#book');
  const pageElements = [...book.querySelectorAll('.page')];
  const pageImages = pageElements.map(page => page.querySelector('img'));
  const zoomPageLeft = document.querySelector('#zoom-page-left');
  const zoomPageRight = document.querySelector('#zoom-page-right');
  const openCurrentImage = document.querySelector('#reader-open-current');
  const staticBook = document.createElement('div');
  const pageReadout = document.querySelector('#reader-page-readout');
  const pageJump = document.querySelector('#reader-jump');
  const previousButton = document.querySelector('#reader-prev');
  const nextButton = document.querySelector('#reader-next');
  const jumpButton = document.querySelector('#reader-jump-button');
  const modeLabel = document.querySelector('#reader-mode');
  const zoomToggle = document.querySelector('#reader-zoom-toggle');
  const zoomLayer = document.querySelector('#zoom-layer');
  const zoomView = document.querySelector('#zoom-view');
  const zoomImage = document.querySelector('#zoom-image');
  const zoomPageLabel = document.querySelector('#zoom-current-page');
  const errorPanel = document.querySelector('#reader-error');
  const errorTitle = document.querySelector('#reader-error-title');
  const errorCopy = document.querySelector('#reader-error-copy');
  const retryButton = document.querySelector('#reader-retry');
  const liveRegion = document.querySelector('#reader-live');
  const pendingLoads = new Map();

  let flipbook = null;
  let activePage = Math.max(0, Math.min(PAGE_COUNT - 1, requestedPage - 1));
  let zoomOpen = false;
  let busy = false;
  let waitingForPage = false;
  let errorPage = null;
  let suppressFlipEvent = false;
  let started = false;
  let zoomPageIndex = activePage;
  let zoomSize = 'fit';

  staticBook.className = 'static-book';
  staticBook.hidden = true;
  staticBook.dataset.mode = mode;
  stage.appendChild(staticBook);
  pageJump.value = String(activePage + 1);
  pageJump.max = String(PAGE_COUNT);

  function post(type, extra = {}) {
    if (window.parent !== window) window.parent.postMessage({namespace: NAMESPACE, type, ...extra}, location.origin);
  }

  function visiblePages(index) {
    const page = Math.max(0, Math.min(PAGE_COUNT - 1, index));
    if (mode !== 'spread') return [page];
    const first = page - page % 2;
    return first + 1 < PAGE_COUNT ? [first, first + 1] : [first];
  }

  function currentStartPage() {
    return flipbook ? flipbook.getCurrentPageIndex() : visiblePages(activePage)[0];
  }

  function stepTarget(startPage, direction) {
    if (mode !== 'spread') return Math.max(0, Math.min(PAGE_COUNT - 1, startPage + direction));
    if (direction > 0) {
      const lastStart = Math.floor((PAGE_COUNT - 1) / 2) * 2;
      return Math.min(lastStart, startPage + 2);
    }
    return Math.max(0, startPage - 2);
  }

  function adjacentPageSet(index) {
    const firstVisible = visiblePages(index)[0];
    const targets = new Set(visiblePages(firstVisible));
    const previous = stepTarget(firstVisible, -1);
    const next = stepTarget(firstVisible, 1);
    visiblePages(previous).forEach(page => targets.add(page));
    visiblePages(next).forEach(page => targets.add(page));
    return [...targets];
  }

  function setError(pageIndex, retry = true) {
    errorPage = pageIndex;
    errorTitle.textContent = `第 ${pageIndex + 1} 页暂时无法载入`;
    errorCopy.textContent = retry ? '请检查网络后重试，也可以在新窗口打开当前页面图。' : '请在新窗口打开当前页面图继续阅读。';
    openCurrentImage.href = pageImages[pageIndex]?.dataset.src || pageImages[activePage]?.dataset.src || pageImages[0]?.dataset.src || './assets/new/salt-album-01.webp';
    retryButton.hidden = !retry;
    errorPanel.hidden = false;
  }

  function clearError() {
    errorPage = null;
    errorPanel.hidden = true;
  }

  async function ensurePage(pageIndex, retry = false) {
    const index = Math.max(0, Math.min(PAGE_COUNT - 1, pageIndex));
    const image = pageImages[index];
    if (retry) {
      image.removeAttribute('src');
      pendingLoads.delete(index);
    }
    if (image.complete && image.naturalWidth > 0) {
      if (typeof image.decode === 'function') {
        try { await image.decode(); } catch (_) {}
      }
      return true;
    }
    if (pendingLoads.has(index)) return pendingLoads.get(index);

    const promise = new Promise(resolve => {
      let finished = false;
      const finish = ok => {
        if (finished) return;
        finished = true;
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        resolve(ok);
      };
      const onLoad = () => finish(image.naturalWidth > 0);
      const onError = () => finish(false);
      image.addEventListener('load', onLoad, {once: true});
      image.addEventListener('error', onError, {once: true});
      const src = image.dataset.src;
      image.src = retry ? `${src}?retry=${Date.now()}` : src;
      if (image.complete) finish(image.naturalWidth > 0);
    }).then(async loaded => {
      if (!loaded) return false;
      if (typeof image.decode === 'function') {
        try { await image.decode(); } catch (_) { return false; }
      }
      return image.naturalWidth > 0;
    }).finally(() => {
      if (pendingLoads.get(index) === promise) pendingLoads.delete(index);
    });
    pendingLoads.set(index, promise);
    return promise;
  }

  async function ensureVisiblePages(index) {
    const visible = visiblePages(index);
    for (const page of visible) {
      if (!(await ensurePage(page))) {
        setError(page);
        return false;
      }
    }
    return true;
  }

  function warmAdjacentPages(index) {
    adjacentPageSet(index).forEach(page => { ensurePage(page); });
  }

  function updateControls() {
    const start = currentStartPage();
    const visible = visiblePages(start);
    zoomPageLeft.hidden = mode !== 'spread';
    zoomPageRight.hidden = mode !== 'spread' || visible.length < 2;
    const first = visible[0] + 1;
    const last = visible[visible.length - 1] + 1;
    pageReadout.textContent = first === last ? `第 ${first} 页 / ${PAGE_COUNT}` : `第 ${first}–${last} 页 / ${PAGE_COUNT}`;
    if (document.activeElement !== pageJump) pageJump.value = String(activePage + 1);
    previousButton.disabled = busy || waitingForPage || start === 0;
    nextButton.disabled = busy || waitingForPage || visible[visible.length - 1] === PAGE_COUNT - 1;
    jumpButton.disabled = waitingForPage;
    pageJump.disabled = waitingForPage;
    liveRegion.textContent = pageReadout.textContent;
  }

  function reportPage() {
    post('page', {page: activePage + 1});
  }

  async function showStatic(index) {
    if (!(await ensureVisiblePages(index))) return false;
    const visible = visiblePages(index);
    staticBook.replaceChildren(...visible.map(page => pageElements[page]));
    staticBook.dataset.mode = mode;
    book.hidden = true;
    staticBook.hidden = false;
    return true;
  }

  function failToStatic(reason) {
    flipbook = null;
    book.hidden = true;
    staticBook.dataset.mode = mode;
    const notice = document.createElement('div');
    notice.className = 'reader-fallback-note';
    notice.textContent = reason || '翻页效果无法载入，可使用页码控件继续查看。';
    stage.appendChild(notice);
    showStatic(activePage).then(ok => { if (!ok) setError(activePage); });
  }

  function measurePageSize() {
    const styles = getComputedStyle(stage);
    const availableWidth = Math.max(1, stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight));
    const availableHeight = Math.max(1, stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom));
    const columns = mode === 'spread' ? 2 : 1;
    const width = Math.max(1, Math.floor(Math.min(availableWidth / columns, availableHeight * PAGE_RATIO)));
    const height = Math.max(1, Math.floor(width / PAGE_RATIO));
    return {width, height, bookWidth: width * columns};
  }

  function initializeFlipbook() {
    if (reducedMotion) {
      showStatic(activePage).then(ok => { if (!ok) setError(activePage); });
      return;
    }
    const PageFlip = window.St && window.St.PageFlip;
    if (!PageFlip) {
      failToStatic('翻页效果未能载入，可使用页码控件继续查看。');
      return;
    }
    const dimensions = measurePageSize();
    book.style.width = `${dimensions.bookWidth}px`;
    book.style.height = `${dimensions.height}px`;
    try {
      flipbook = new PageFlip(book, {
        width: dimensions.width,
        height: dimensions.height,
        size: 'fixed',
        minWidth: dimensions.width,
        maxWidth: dimensions.width,
        minHeight: dimensions.height,
        maxHeight: dimensions.height,
        startPage: activePage,
        drawShadow: true,
        flippingTime: 700,
        usePortrait: mode === 'single',
        startZIndex: 10,
        autoSize: false,
        maxShadowOpacity: 0.28,
        // The library keeps portrait pages one-by-one; this prevents landscape cover/last-page exceptions.
        showCover: false,
        mobileScrollSupport: true,
        clickEventForward: true,
        useMouseEvents: true,
        swipeDistance: 36,
        showPageCorners: true,
        disableFlipByClick: false
      });
      flipbook.on('flip', event => {
        if (suppressFlipEvent) return;
        const index = Number(event.data);
        if (!Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) return;
        activePage = index;
        clearError();
        updateControls();
        reportPage();
        warmAdjacentPages(index);
      });
      flipbook.on('changeState', event => {
        busy = event.data === 'flipping' || event.data === 'user_fold';
        updateControls();
      });
      suppressFlipEvent = true;
      flipbook.loadFromHTML(pageElements);
      suppressFlipEvent = false;
      book.hidden = false;
      staticBook.hidden = true;
      updateControls();
    } catch (_) {
      failToStatic('翻页效果未能载入，可使用页码控件继续查看。');
    }
  }

  async function navigate(direction) {
    if (waitingForPage || busy || zoomOpen) return;
    const start = currentStartPage();
    const target = stepTarget(start, direction);
    if (target === start) return;
    waitingForPage = true;
    updateControls();
    const ready = await ensureVisiblePages(target);
    waitingForPage = false;
    updateControls();
    if (!ready) return;
    warmAdjacentPages(target);
    if (flipbook) {
      if (direction > 0) flipbook.flipNext();
      else flipbook.flipPrev();
    } else {
      activePage = target;
      await showStatic(activePage);
      updateControls();
      reportPage();
    }
  }

  async function jumpToPage(value) {
    if (waitingForPage) return;
    const pageNumber = Number(value);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > PAGE_COUNT) {
      pageJump.value = String(activePage + 1);
      pageJump.focus({preventScroll: true});
      return;
    }
    const target = pageNumber - 1;
    waitingForPage = true;
    updateControls();
    const ready = await ensureVisiblePages(target);
    waitingForPage = false;
    updateControls();
    if (!ready) return;
    clearError();
    warmAdjacentPages(target);
    if (flipbook) {
      flipbook.turnToPage(target);
      activePage = target;
      updateControls();
      reportPage();
    } else {
      activePage = target;
      await showStatic(activePage);
      updateControls();
      reportPage();
    }
  }

  async function selectZoomPage(index, resetFit = false) {
    const target = Math.max(0, Math.min(PAGE_COUNT - 1, index));
    if (!(await ensurePage(target))) {
      setError(target);
      return false;
    }
    zoomPageIndex = target;
    zoomImage.src = pageImages[target].currentSrc || pageImages[target].src;
    zoomImage.alt = `${PAGE_LABEL}第 ${target + 1} 页，放大查看`;
    zoomPageLabel.textContent = `第 ${target + 1} 页`;
    if (resetFit) zoomSize = 'fit';
    const visible = visiblePages(currentStartPage());
    zoomPageLeft.setAttribute('aria-pressed', String(target === visible[0]));
    zoomPageRight.setAttribute('aria-pressed', String(visible.length > 1 && target === visible[1]));
    if (zoomOpen) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      applyZoom(zoomSize);
    }
    return true;
  }

  async function openZoom(index = activePage) {
    if (zoomOpen) {
      await selectZoomPage(index);
      return;
    }
    zoomOpen = true;
    zoomLayer.hidden = false;
    zoomToggle.setAttribute('aria-pressed', 'true');
    zoomToggle.textContent = '退出放大';
    if (!(await selectZoomPage(index, true))) return;
    document.querySelector('#zoom-close').focus({preventScroll: true});
  }

  function closeZoom(restoreFocus = true) {
    if (!zoomOpen) return;
    zoomOpen = false;
    zoomLayer.hidden = true;
    zoomToggle.setAttribute('aria-pressed', 'false');
    zoomToggle.textContent = '放大查看';
    if (restoreFocus) zoomToggle.focus({preventScroll: true});
  }

  function applyZoom(size) {
    if (!zoomOpen) return;
    const naturalWidth = zoomImage.naturalWidth || 1427;
    const naturalHeight = zoomImage.naturalHeight || Math.round(1427 / PAGE_RATIO);
    const fitScale = Math.min(zoomView.clientWidth / naturalWidth, zoomView.clientHeight / naturalHeight);
    const scale = size === 'fit' ? fitScale : Number(size);
    zoomSize = size;
    zoomView.dataset.fit = String(size === 'fit');
    zoomImage.style.width = `${Math.max(1, Math.round(naturalWidth * scale))}px`;
    zoomImage.style.height = `${Math.max(1, Math.round(naturalHeight * scale))}px`;
    document.querySelectorAll('[data-zoom-size]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.zoomSize === String(size))));
    requestAnimationFrame(() => zoomView.scrollTo({left: 0, top: 0, behavior: 'auto'}));
  }

  previousButton.addEventListener('click', () => navigate(-1));
  nextButton.addEventListener('click', () => navigate(1));
  modeLabel.hidden = !canSpread;
  zoomPageLeft.hidden = mode !== 'spread';
  zoomPageRight.hidden = mode !== 'spread';
  modeLabel.textContent = mode === 'spread' ? '单页阅读' : '双页总览';
  modeLabel.setAttribute('aria-label', mode === 'spread' ? '切换到单页阅读' : '切换到双页总览');
  modeLabel.addEventListener('click', () => {
    if (!canSpread || zoomOpen || waitingForPage || busy) return;
    post('set-mode', {mode: mode === 'spread' ? 'single' : 'spread', page: activePage + 1});
  });
  jumpButton.addEventListener('click', () => jumpToPage(pageJump.value));
  pageJump.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      jumpToPage(pageJump.value);
    }
  });
  zoomToggle.addEventListener('click', () => zoomOpen ? closeZoom() : openZoom());
  document.querySelector('#zoom-close').addEventListener('click', () => closeZoom());
  zoomPageLeft.addEventListener('click', () => openZoom(visiblePages(currentStartPage())[0]));
  zoomPageRight.addEventListener('click', () => { const visible = visiblePages(currentStartPage()); if (visible.length > 1) openZoom(visible[1]); });
  document.querySelectorAll('[data-zoom-size]').forEach(button => button.addEventListener('click', () => applyZoom(button.dataset.zoomSize)));
  retryButton.addEventListener('click', async () => {
    if (errorPage === null) return;
    const target = errorPage;
    clearError();
    if (!(await ensurePage(target, true))) {
      setError(target);
      return;
    }
    if (!started) {
      activePage = target;
      await startReader();
      return;
    }
    if (flipbook) {
      if (!(await ensureVisiblePages(target))) return;
      flipbook.turnToPage(target);
    } else {
      activePage = target;
      if (!(await showStatic(target))) return;
      reportPage();
    }
    clearError();
    updateControls();
  });
  staticBook.addEventListener('click', event => {
    if (event.target.closest('button,a,input')) return;
    const rect = staticBook.getBoundingClientRect();
    navigate(event.clientX < rect.left + rect.width / 2 ? -1 : 1);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (zoomOpen) {
        event.preventDefault();
        closeZoom();
      } else {
        event.preventDefault();
        post('close');
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigate(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(1);
    }
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.namespace !== NAMESPACE || data.type !== 'sync') return;
    if (data.mode !== mode || !Number.isInteger(data.page) || data.page < 1 || data.page > PAGE_COUNT) return;
    if (data.page !== activePage + 1) jumpToPage(data.page);
  });

  async function startReader() {
    const required = await ensureVisiblePages(activePage);
    if (!required) return false;
    warmAdjacentPages(activePage);
    initializeFlipbook();
    updateControls();
    reportPage();
    post('ready', {page: activePage + 1, mode});
    started = true;
    return true;
  }

  startReader();
})();
