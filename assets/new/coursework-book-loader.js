(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const albumId = params.get('album');
  const pageLabel = document.querySelector('#reader-page-readout');
  const pageJump = document.querySelector('#reader-jump');
  const book = document.querySelector('#book');

  async function loadAlbum() {
    const response = await fetch('./assets/new/coursework/coursework-albums.json');
    if (!response.ok) throw new Error('album manifest unavailable');
    const manifest = await response.json();
    const album = manifest.albums?.[albumId];
    if (!album || !Array.isArray(album.pages) || album.pages.length !== album.pageCount) throw new Error('album unavailable');
    document.title = `${album.title} · 翻页阅读器`;
    document.querySelector('#reader-shell').setAttribute('aria-label', `${album.title}翻页阅读器`);
    document.querySelector('#reader-stage').setAttribute('aria-label', `${album.title}页面`);
    document.querySelector('#zoom-layer').setAttribute('aria-label', `${album.title}页面放大查看`);
    book.dataset.pageCount = String(album.pageCount);
    book.dataset.pageRatio = String(manifest.pageRatio || 16 / 9);
    book.dataset.namespace = album.namespace;
    book.dataset.pageLabel = album.pageLabel || album.title;
    book.setAttribute('aria-label', `${album.pageCount} 页${album.title}`);
    for (const page of album.pages) {
      const article = document.createElement('article');
      article.className = 'page';
      article.dataset.page = String(page.page);
      const image = document.createElement('img');
      image.dataset.src = page.src;
      image.alt = `${page.label}，第 ${page.page} 页`;
      image.draggable = false;
      article.appendChild(image);
      book.appendChild(article);
    }
    pageLabel.textContent = `第 1 页 / ${album.pageCount}`;
    pageJump.max = String(album.pageCount);
    pageJump.setAttribute('aria-label', `跳转到${album.title}页码`);
    document.querySelector('#zoom-current-page').textContent = '第 1 页';
    document.querySelector('#zoom-image').alt = `${album.title}页面放大查看`;
    document.querySelector('#reader-open-current').href = album.pages[0].src;
    const runtime = document.createElement('script');
    runtime.src = './assets/new/coursework-flipbook.js';
    document.body.appendChild(runtime);
  }

  loadAlbum().catch(() => {
    document.querySelector('#reader-error').hidden = false;
    document.querySelector('#reader-error-title').textContent = '课设页面暂时无法载入';
    document.querySelector('#reader-error-copy').textContent = '请返回上一页后重试。';
    document.querySelector('#reader-retry').hidden = true;
    document.querySelector('#reader-open-current').hidden = true;
  });
})();
