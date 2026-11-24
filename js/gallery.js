document.addEventListener('DOMContentLoaded', () => {
    const gallery = document.getElementById('main-gallery');
    const preloader = document.getElementById('gallery-preloader');
    const preloaderImg = document.getElementById('preloader-img');
    const preloaderTextLabel = document.getElementById('preloader-text-label');
    const lb = document.getElementById('custom-lightbox');
    const lbContainer = document.getElementById('lb-container');
    const lbCounter = document.getElementById('lb-counter');

    // 1. Рандомная сортировка при каждой загрузке/обновлении страницы
    const items = Array.from(gallery.querySelectorAll('.m-item'));
    items.sort(() => Math.random() - 0.5);
    gallery.innerHTML = '';
    items.forEach(item => gallery.appendChild(item));

    const imgs = Array.from(gallery.querySelectorAll('img'));
    let currentIndex = 0;

    // 2. "loading gallery" при обычном заходе, случайная фраза — только при обновлении страницы (F5)
    const shufflePhrases = [
        'shuffling',
        'mixing the order',
        'reshuffling frames',
        'randomizing',
        'reordering the gallery',
        'rolling the film',
    ];
    const navEntry = performance.getEntriesByType('navigation')[0];
    const isReload = navEntry && navEntry.type === 'reload';
    preloaderTextLabel.textContent = isReload
        ? shufflePhrases[Math.floor(Math.random() * shufflePhrases.length)]
        : 'loading gallery';

    // 3. БЕСШОВНЫЙ ПРЕЛОАДЕР
    let flashIndex = 0;
    const totalImagesCount = imgs.length;
    const preloaderStartTime = Date.now();
    const MIN_PRELOADER_MS = isReload ? 1500 : 2600; // на обновлении держим короче, на первом заходе — как и раньше

    // в прелоадере мелькают только уже скачанные фото
    const loadedImgs = [];
    const nextFlashImage = () => {
        if (preloader.style.visibility === 'hidden' || !loadedImgs.length) return;
        let randomIndex = Math.floor(Math.random() * loadedImgs.length);
        if (loadedImgs.length > 1 && randomIndex === flashIndex) {
            randomIndex = (randomIndex + 1) % loadedImgs.length;
        }
        flashIndex = randomIndex;
        preloaderImg.src = loadedImgs[flashIndex].src;
        preloaderImg.classList.add('loaded');
    };

    const flashInterval = setInterval(nextFlashImage, 1000);

    // 4. Галерею показываем, только когда скачано ВСЁ: картинки сетки и большие версии
    // для лайтбокса. Открывается дольше, зато потом любое фото открывается сразу.
    // На совсем плохой сети через 60 с показываем как есть — остальное докачается и проявится.
    const MAX_PRELOADER_MS = 60000;
    let revealed = false;
    const revealGallery = () => {
        if (revealed) return;
        revealed = true;
        clearInterval(flashInterval);

        setTimeout(() => {
            preloader.style.opacity = '0';
            setTimeout(() => {
                preloader.style.visibility = 'hidden';
                gallery.style.opacity = '1';
                document.body.classList.add('is-loaded');
            }, 600);
        }, 800);
    };

    // размеры кадра известны заранее (width/height в HTML) — место под фото есть ещё до загрузки
    imgs.forEach((img) => {
        img.style.aspectRatio = `${img.getAttribute('width')} / ${img.getAttribute('height')}`;
    });
    // какие фото видны на первом экране (галерея пока прозрачная, но уже разложена)
    const firstScreen = imgs.filter((img) => img.getBoundingClientRect().top < window.innerHeight);
    const rest = imgs.filter((img) => !firstScreen.includes(img));

    const revealWhenReady = () => {
        const remaining = Math.max(0, MIN_PRELOADER_MS - (Date.now() - preloaderStartTime));
        setTimeout(revealGallery, remaining);
    };

    let gridLeft = totalImagesCount;
    const onDone = (img, ok) => {
        if (ok) {
            img.classList.add('loaded');
            loadedImgs.push(img);
            if (loadedImgs.length === 1) nextFlashImage();
        }
        if (--gridLeft === 0) preloadFull().then(revealWhenReady);
    };

    if (totalImagesCount > 0) {
        // сначала первый экран, потом остальное
        [...firstScreen, ...rest].forEach((img, k) => {
            img.fetchPriority = k < firstScreen.length ? 'high' : 'low';
            img.addEventListener('load', () => onDone(img, true), { once: true });
            img.addEventListener('error', () => onDone(img, false), { once: true });
            img.src = img.dataset.src;
        });
        setTimeout(revealGallery, MAX_PRELOADER_MS);
    } else {
        preloader.style.display = 'none';
    }

    // Большие версии для лайтбокса — после сетки, по шесть за раз. Каждая качается
    // в свой <img>, и лайтбокс показывает именно его — второй раз в сеть не идём
    // (даже после Cmd+Shift+R, когда браузер не читает кэш).
    // Только на компьютере: на телефоне лайтбокс не открывается, незачем тратить трафик.
    const fullEls = new Map(); // src → скачанный <img>
    const preloadFull = () => new Promise((resolve) => {
        if (window.innerWidth <= 768) { resolve(); return; }
        const queue = imgs.map((img) => img.dataset.full).filter(Boolean);
        let left = queue.length;
        if (!left) { resolve(); return; }
        const pump = () => {
            const src = queue.shift();
            if (!src) return;
            const im = new Image();
            im.onload = im.onerror = () => {
                if (--left === 0) resolve();
                pump();
            };
            im.src = src;
            fullEls.set(src, im);
        };
        for (let k = 0; k < 6; k++) pump();
    });

    // --- ЛАЙТБОКС ---
    const showImage = (index) => {
        if (index < 0) index = imgs.length - 1;
        if (index >= imgs.length) index = 0;
        currentIndex = index;
        lbContainer.innerHTML = '';
        const src = imgs[currentIndex].dataset.full || imgs[currentIndex].src;
        // уже скачанная большая версия — показываем сразу; иначе грузим и проявляем
        let img = fullEls.get(src);
        if (!img) {
            img = new Image();
            img.src = src;
        }
        img.className = 'lightbox-content';
        if (img.complete && img.naturalWidth) img.style.opacity = '1';
        else img.onload = () => { img.style.opacity = '1'; };
        lbContainer.appendChild(img);
        lbCounter.textContent = `${currentIndex + 1} / ${imgs.length}`;
        fitLightbox();
    };

    // размер фото: по центру, как можно крупнее, но не под кнопками в углу (js/viewer-fit.js)
    const lbControls = document.getElementById('lb-controls');
    const fitLightbox = () => {
        const img = lbContainer.querySelector('img');
        if (!img || lb.style.display !== 'flex') return;
        const grid = imgs[currentIndex];
        const pw = img.naturalWidth || +grid.getAttribute('width');
        const ph = img.naturalHeight || +grid.getAttribute('height');
        const [w, h] = window.fitPhoto(pw, ph, window.innerWidth, window.innerHeight, lbControls);
        img.style.width = `${w}px`;
        img.style.height = `${h}px`;
    };
    window.addEventListener('resize', fitLightbox);

    const closeLightbox = () => {
        lb.style.display = 'none';
        document.body.style.overflow = '';
        lbContainer.innerHTML = '';
    };

    gallery.addEventListener('click', (e) => {
        const item = e.target.closest('.m-item');
        if (item && window.innerWidth > 768) {
            const clickedImg = item.querySelector('img');
            currentIndex = imgs.indexOf(clickedImg);
            lb.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            showImage(currentIndex);
        }
    });

    document.getElementById('lb-next').onclick = (e) => { e.stopPropagation(); showImage(currentIndex + 1); };
    document.getElementById('lb-prev').onclick = (e) => { e.stopPropagation(); showImage(currentIndex - 1); };
    document.getElementById('lb-close').onclick = closeLightbox;
    // клик по фото: правая половина экрана — дальше, левая — назад; по пустому месту — к сетке
    lb.onclick = (e) => {
        if (e.target.classList.contains('lightbox-content')) {
            showImage(currentIndex + (e.clientX > window.innerWidth / 2 ? 1 : -1));
        } else if (e.target === lb || e.target === lbContainer) {
            closeLightbox();
        }
    };

    document.addEventListener('keydown', (e) => {
        if (lb.style.display !== 'flex') return;
        if (e.key === 'ArrowRight') showImage(currentIndex + 1);
        if (e.key === 'ArrowLeft') showImage(currentIndex - 1);
        if (e.key === 'Escape') closeLightbox();
    });

    document.getElementById('topBtn').onclick = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
});
