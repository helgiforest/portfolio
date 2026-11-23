// Просмотр раздела (archive / 2025 / 2026).
// Список фото берётся из /<раздел>/photos.js — его пишет tools/build_photos.py.
document.addEventListener('DOMContentLoaded', () => {
    const section = document.body.dataset.section;
    // при каждой загрузке — случайный порядок (как на главной)
    const photos = (window.SECTION_PHOTOS || []).slice();
    for (let i = photos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [photos[i], photos[j]] = [photos[j], photos[i]];
    }

    const viewer = document.getElementById('viewer');
    const bar = document.getElementById('section-bar');
    const counterEl = document.getElementById('sb-counter');
    const statusEl = document.getElementById('sb-status');
    const toggleEl = document.getElementById('sb-toggle');
    let mainImg = document.getElementById('stage-img');
    const miniEl = document.getElementById('stage-mini');
    const thumbsEl = document.getElementById('thumbs');

    // фото лежат прямо в /images/<раздел>/ (экспорт из Lightroom), превью — в thumb/
    const url = (size, p) => {
        const name = encodeURIComponent(p.file);
        return size === 'thumb'
            ? `/images/${section}/thumb/${name}.webp`
            : `/images/${section}/${name}.${p.ext}`;
    };
    const wrap = (i) => (i + photos.length) % photos.length;
    const isDesktop = () => window.matchMedia('(min-width: 769px)').matches;

    // --- ПУСТОЙ РАЗДЕЛ ---
    if (!photos.length) {
        bar.classList.remove('is-loading');
        toggleEl.style.display = 'none';
        counterEl.style.display = 'none';
        mainImg.remove();
        viewer.insertAdjacentHTML('afterbegin', '<div class="stage-empty">no photos here yet</div>');
        viewer.style.cursor = 'default';
        document.body.classList.add('is-loaded');
        return;
    }

    // --- ПРЕДЗАГРУЗКА ---
    const cache = new Map();
    const preload = (src) => {
        if (!cache.has(src)) {
            cache.set(src, new Promise((resolve) => {
                const im = new Image();
                im.onload = im.onerror = () => resolve();
                im.src = src;
            }));
        }
        return cache.get(src);
    };

    // картинка загружена и раскодирована — можно показывать без мигания.
    // decode() ждём не дольше 300 мс: в неактивной вкладке браузер может его откладывать.
    const decoded = (imgOrSrc) => {
        const im = typeof imgOrSrc === 'string' ? Object.assign(new Image(), { src: imgOrSrc }) : imgOrSrc;
        return preload(im.src).then(() => {
            if (!im.decode) return;
            return Promise.race([
                im.decode().catch(() => {}),
                new Promise((r) => setTimeout(r, 300)),
            ]);
        });
    };

    // --- РАЗМЕР ФОТО: вписываем так, чтобы подпись оставалась сразу под ним ---
    let current = 0;

    const fit = () => {
        const p = photos[current];
        const cs = getComputedStyle(viewer);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const sideGap = isDesktop() && photos.length > 1
            ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side-gap')) || 0
            : 0;
        const availW = viewer.clientWidth - padX - sideGap;
        const availH = viewer.clientHeight - padY - bar.offsetHeight;
        const scale = Math.max(0, Math.min(availW / p.w, availH / p.h, 1));
        mainImg.style.width = `${Math.floor(p.w * scale)}px`;
        mainImg.style.height = `${Math.floor(p.h * scale)}px`;
    };

    // --- ПОКАЗ ФОТО ---
    let token = 0;

    const show = (i) => {
        i = wrap(i);
        current = i;
        const my = ++token;
        const p = photos[i];

        counterEl.textContent = `${i + 1} — ${photos.length}`;
        history.replaceState(null, '', `#${encodeURIComponent(p.file)}`); // ссылка на кадр — по имени файла

        // Новый кадр готовим отдельно (загрузка + декодирование) и только потом
        // подменяем им старый. Если просто поменять src у текущего <img>, браузер
        // на долю секунды растягивает старую картинку под размеры новой.
        const img = new Image();
        img.className = 'stage-img';
        img.id = 'stage-img';
        img.alt = '';
        img.src = url('large', p);

        return decoded(img).then(() => {
            if (my !== token) return; // пока грузилось, уже перелистнули дальше
            mainImg.replaceWith(img);
            mainImg = img;
            fit();

            markCurrentThumb();

            [1, -1, 2].forEach((d) => preload(url('large', photos[wrap(i + d)])));
        });
    };

    const next = () => show(current + 1);
    const prev = () => show(current - 1);

    window.addEventListener('resize', fit);
    if (document.fonts) document.fonts.ready.then(fit);

    // --- ЗАГРУЗКА: быстро мелькают имена файлов ---
    const startedAt = performance.now();
    const MIN_LOADING_MS = 700;
    let flickIndex = 0;
    const flick = setInterval(() => {
        statusEl.textContent = photos[flickIndex++ % photos.length].file;
    }, 60);

    // если открыли ссылку на конкретный кадр (#имя-файла) — начинаем с него.
    // При обновлении страницы (F5) ссылку игнорируем — всё случайно, включая первый кадр.
    const navEntry = performance.getEntriesByType('navigation')[0];
    const isReload = navEntry && navEntry.type === 'reload';
    let fromHash = '';
    if (!isReload) {
        try { fromHash = decodeURIComponent(location.hash.slice(1)); } catch (e) { /* битая ссылка */ }
    }
    const startIndex = Math.max(0, photos.findIndex((p) => p.file === fromHash));

    show(startIndex).then(() => {
        const wait = Math.max(0, MIN_LOADING_MS - (performance.now() - startedAt));
        setTimeout(() => {
            clearInterval(flick);
            bar.classList.remove('is-loading');
            document.body.classList.add('is-loaded');
            fit();
        }, wait);
    });

    // --- КЛИКИ / ТАПЫ: правая половина — дальше, левая — назад ---
    const thumbsOpen = () => document.body.classList.contains('thumbs-open');
    let lastSwipeAt = 0;

    // мини-сетка справа внизу — значок галереи: 6 первых кадров (порядок уже перемешан).
    // Клик открывает общую сетку превью — то же, что thumbnails [+].
    if (photos.length > 1) {
        photos.slice(0, 6).forEach((p) => {
            const t = new Image();
            t.src = url('thumb', p);
            t.alt = '';
            miniEl.appendChild(t);
        });
        miniEl.hidden = false;
    }
    miniEl.addEventListener('click', (e) => {
        e.stopPropagation();
        setThumbs(true);
    });

    viewer.addEventListener('click', (e) => {
        if (thumbsOpen() || e.target.closest('.section-bar, .thumbs')) return;
        if (Date.now() - lastSwipeAt < 400) return;
        if (e.clientX > window.innerWidth / 2) next();
        else prev();
    });

    // свайп на телефоне
    let touchX = null;
    let touchY = null;
    viewer.addEventListener('touchstart', (e) => {
        touchX = e.touches[0].clientX;
        touchY = e.touches[0].clientY;
    }, { passive: true });
    viewer.addEventListener('touchend', (e) => {
        if (touchX === null || thumbsOpen()) return;
        const dx = e.changedTouches[0].clientX - touchX;
        const dy = e.changedTouches[0].clientY - touchY;
        touchX = touchY = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            lastSwipeAt = Date.now();
            if (dx < 0) next();
            else prev();
        }
    }, { passive: true });

    // --- СЕТКА ПРЕВЬЮ ---
    let thumbsBuilt = false;
    const buildThumbs = () => {
        if (thumbsBuilt) return;
        thumbsBuilt = true;
        photos.forEach((p, i) => {
            const t = new Image();
            t.src = url('thumb', p);
            t.alt = '';
            t.loading = 'lazy';
            t.width = p.w;
            t.height = p.h;
            t.addEventListener('click', (e) => {
                e.stopPropagation(); // иначе клик дойдёт до просмотра и перелистнёт ещё раз
                // закрываем сетку только когда выбранное фото уже готово —
                // иначе на мгновение мелькнёт предыдущее
                show(i).then(() => {
                    if (current === i) setThumbs(false);
                });
            });
            thumbsEl.appendChild(t);
        });
    };

    function markCurrentThumb() {
        if (!thumbsBuilt) return;
        thumbsEl.querySelectorAll('img.current').forEach((t) => t.classList.remove('current'));
        thumbsEl.children[current]?.classList.add('current');
    }

    const setThumbs = (open) => {
        if (open) {
            buildThumbs();
            markCurrentThumb();
        }
        document.body.classList.toggle('thumbs-open', open);
        toggleEl.textContent = open ? 'thumbnails [−]' : 'thumbnails [+]';
        if (open) thumbsEl.children[current]?.scrollIntoView({ block: 'nearest' });
        else fit();
    };

    toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        setThumbs(!thumbsOpen());
    });

    // --- КЛАВИАТУРА ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && thumbsOpen()) {
            setThumbs(false);
            return;
        }
        if (thumbsOpen()) return;
        if (e.key === 'ArrowRight') next();
        if (e.key === 'ArrowLeft') prev();
    });
});
