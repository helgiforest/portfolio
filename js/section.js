// Раздел (archive / 2025 / 2026).
// Страница открывается сеткой превью (как контактный лист); клик по кадру — просмотр.
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
    const totalEl = document.getElementById('sb-total');
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
    const gridOpen = () => document.body.classList.contains('thumbs-open');

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

    totalEl.textContent = `${photos.length} frames`;

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
    const decoded = (im) => preload(im.src).then(() => {
        if (!im.decode) return;
        return Promise.race([
            im.decode().catch(() => {}),
            new Promise((r) => setTimeout(r, 300)),
        ]);
    });

    // --- РАЗМЕР ФОТО: вписываем в свободное место над нижней строкой ---
    let current = -1;

    const fit = () => {
        const p = photos[current];
        if (!p) return;
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
        history.replaceState(history.state, '', `#${encodeURIComponent(p.file)}`); // ссылка на кадр — по имени файла

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
            [1, -1, 2].forEach((d) => preload(url('large', photos[wrap(i + d)])));
        });
    };

    const next = () => show(current + 1);
    const prev = () => show(current - 1);

    window.addEventListener('resize', fit);
    if (document.fonts) document.fonts.ready.then(fit);

    // --- СЕТКА ПРЕВЬЮ (главный вид раздела) ---
    // Ровные строки на всю ширину: ширина кадра пропорциональна его соотношению сторон (--r),
    // поэтому все кадры в строке одной высоты. Кадры «проявляются» по очереди.
    const thumbItems = photos.map((p, i) => {
        const item = document.createElement('a');
        item.className = 'thumb';
        item.href = `#${encodeURIComponent(p.file)}`;
        item.style.setProperty('--r', (p.w / p.h).toFixed(4));
        if (i < 30) item.style.setProperty('--d', `${i * 40}ms`); // первые кадры — с задержкой по очереди

        const t = new Image();
        t.alt = '';
        t.loading = i < 18 ? 'eager' : 'lazy';
        t.decoding = 'async';
        t.addEventListener('load', () => item.classList.add('loaded'));
        // не загрузилось (сеть моргнула) — без битой иконки, ещё одна попытка через секунду
        t.addEventListener('error', () => {
            if (t.dataset.retried) return;
            t.dataset.retried = '1';
            setTimeout(() => { t.src = `${url('thumb', p)}?r=1`; }, 1000);
        });
        t.src = url('thumb', p);
        item.appendChild(t);

        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // иначе клик дойдёт до просмотра и перелистнёт
            openPhoto(i);
        });
        thumbsEl.appendChild(item);
        return item;
    });

    // --- ПЕРЕКЛЮЧЕНИЕ СЕТКА ⇄ ПРОСМОТР ---
    const setGrid = (open) => {
        document.body.classList.toggle('thumbs-open', open);
        if (open) {
            thumbItems[current]?.scrollIntoView({ block: 'nearest' });
        } else {
            fit();
        }
    };

    // открыть кадр из сетки: сетку закрываем только когда фото готово —
    // иначе на мгновение мелькнёт предыдущее. Кнопка «назад» браузера вернёт к сетке.
    let pushed = false;
    const openPhoto = (i) => {
        if (!pushed) {
            history.pushState({ photo: true }, '', `#${encodeURIComponent(photos[i].file)}`);
            pushed = true;
        }
        show(i).then(() => {
            if (current === i && gridOpen()) setGrid(false);
        });
    };

    const backToGrid = () => {
        if (pushed) {
            history.back(); // дальше сработает popstate
        } else {
            history.replaceState(null, '', location.pathname);
            setGrid(true);
        }
    };

    window.addEventListener('popstate', () => {
        let f = '';
        try { f = decodeURIComponent(location.hash.slice(1)); } catch (e) { /* битая ссылка */ }
        const i = photos.findIndex((p) => p.file === f);
        if (i === -1) {
            pushed = false;
            setGrid(true);
        } else {
            pushed = true;
            show(i).then(() => { if (current === i) setGrid(false); });
        }
    });

    // мини-сетка над «show thumbnails» — значок галереи, клик возвращает к сетке
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
        backToGrid();
    });
    toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        backToGrid();
    });

    // --- КЛИКИ / ТАПЫ В ПРОСМОТРЕ: правая половина — дальше, левая — назад ---
    let lastSwipeAt = 0;

    viewer.addEventListener('click', (e) => {
        if (gridOpen() || e.target.closest('.section-bar, .thumbs')) return;
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
        if (touchX === null || gridOpen()) return;
        const dx = e.changedTouches[0].clientX - touchX;
        const dy = e.changedTouches[0].clientY - touchY;
        touchX = touchY = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            lastSwipeAt = Date.now();
            if (dx < 0) next();
            else prev();
        }
    }, { passive: true });

    // --- КЛАВИАТУРА ---
    document.addEventListener('keydown', (e) => {
        if (gridOpen()) return;
        if (e.key === 'Escape') backToGrid();
        if (e.key === 'ArrowRight') next();
        if (e.key === 'ArrowLeft') prev();
    });

    // --- ЗАГРУЗКА: быстро мелькают имена файлов ---
    const startedAt = performance.now();
    const MIN_LOADING_MS = 700;
    let flickIndex = 0;
    const flick = setInterval(() => {
        statusEl.textContent = photos[flickIndex++ % photos.length].file;
    }, 60);

    const reveal = () => {
        const wait = Math.max(0, MIN_LOADING_MS - (performance.now() - startedAt));
        setTimeout(() => {
            clearInterval(flick);
            bar.classList.remove('is-loading');
            document.body.classList.add('is-loaded');
            fit();
        }, wait);
    };

    // Ссылка на конкретный кадр (#имя-файла) открывает сразу его.
    // Обычный заход и обновление страницы (F5) — сетка.
    const navEntry = performance.getEntriesByType('navigation')[0];
    const isReload = navEntry && navEntry.type === 'reload';
    let fromHash = '';
    if (!isReload) {
        try { fromHash = decodeURIComponent(location.hash.slice(1)); } catch (e) { /* битая ссылка */ }
    }
    const startIndex = photos.findIndex((p) => p.file === fromHash);

    if (startIndex !== -1) {
        show(startIndex).then(reveal);
    } else {
        if (location.hash) history.replaceState(null, '', location.pathname);
        setGrid(true);
        // ждём первые кадры сетки (но не дольше 2.5 с), потом показываем
        const firstBatch = thumbItems.slice(0, 12).map((item) => new Promise((resolve) => {
            if (item.classList.contains('loaded')) return resolve();
            const img = item.querySelector('img');
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        }));
        Promise.race([Promise.all(firstBatch), new Promise((r) => setTimeout(r, 2500))]).then(reveal);
    }
});
