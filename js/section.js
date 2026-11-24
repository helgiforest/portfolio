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
    const thumbsEl = document.getElementById('thumbs');
    const controlsEl = document.getElementById('viewer-controls');

    // фото лежат прямо в /images/<раздел>/ (экспорт из Lightroom), превью — в thumb/
    const url = (size, p) => {
        const name = encodeURIComponent(p.file);
        return size === 'thumb'
            ? `/images/${section}/thumb/${name}.webp`
            : `/images/${section}/${name}.${p.ext}`;
    };
    const wrap = (i) => (i + photos.length) % photos.length;
    const gridOpen = () => document.body.classList.contains('thumbs-open');

    // --- ПУСТОЙ РАЗДЕЛ ---
    if (!photos.length) {
        bar.classList.remove('is-loading');
        controlsEl.remove();
        mainImg.remove();
        viewer.insertAdjacentHTML('beforeend', '<div class="stage-empty">no photos here yet</div>');
        document.body.classList.add('thumbs-open', 'is-loaded');
        return;
    }

    totalEl.textContent = `${photos.length} frames`;

    // --- ПРЕДЗАГРУЗКА ---
    // Каждый файл качается один раз в свой <img>, и при просмотре показывается
    // именно он — уже скачанный. Так не нужно второй раз идти в сеть или кэш браузера
    // (после Cmd+Shift+R браузер кэш не читает и качал бы фото заново).
    const cache = new Map();    // src → обещание «скачан»
    const elements = new Map(); // src → сам <img>
    const done = new Set();     // уже скачанные файлы
    const preload = (src, priority) => {
        if (!cache.has(src)) {
            cache.set(src, new Promise((resolve) => {
                const im = new Image();
                if (priority) im.fetchPriority = priority;
                im.onload = () => { done.add(src); resolve(); };
                im.onerror = () => resolve();
                im.src = src;
                elements.set(src, im);
            }));
        }
        return cache.get(src);
    };

    // Кадр, который человек открыл (если ещё не скачан), и соседние:
    // пока они качаются, фоновая загрузка не берёт новые файлы.
    let urgent = null;
    const makeUrgent = (wait) => {
        urgent = wait;
        wait.then(() => { if (urgent === wait) urgent = null; });
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

    // --- РАЗМЕР ФОТО: по центру экрана, как можно крупнее, но не под кнопками в углу ---
    // (общий расчёт с главной — js/viewer-fit.js)
    let current = -1;

    const fit = () => {
        const p = photos[current];
        if (!p || gridOpen()) return;
        // на телефоне кнопки — строкой под фото (не поверх), фото делит с ними высоту
        const inRow = getComputedStyle(controlsEl).position === 'static';
        const availH = viewer.clientHeight - (inRow ? controlsEl.offsetHeight : 0);
        const [w, h] = window.fitPhoto(p.w, p.h, viewer.clientWidth, availH, inRow ? null : controlsEl);
        mainImg.style.width = `${w}px`;
        mainImg.style.height = `${h}px`;
    };

    // --- ПОКАЗ ФОТО ---
    let token = 0;

    const show = (i) => {
        i = wrap(i);
        current = i;
        const my = ++token;
        const p = photos[i];

        counterEl.textContent = `${i + 1} / ${photos.length}`;
        history.replaceState(history.state, '', `#${encodeURIComponent(p.file)}`); // ссылка на кадр — по имени файла

        // Новый кадр готовим отдельно (загрузка + декодирование) и только потом
        // подменяем им старый. Если просто поменять src у текущего <img>, браузер
        // на долю секунды растягивает старую картинку под размеры новой.
        const bigSrc = url('large', p);
        const big = stageImg(bigSrc, 'high');
        const neighbourSrcs = [1, -1, 2].map((d) => url('large', photos[wrap(i + d)]));
        const ready = decoded(big).then(() => {
            if (my !== token) return; // пока грузилось, уже перелистнули дальше
            swapTo(big);
        });
        // сразу за открытым кадром — соседние, чтобы листать без ожидания
        const withNeighbours = ready.then(() => {
            if (my === token) return Promise.all(neighbourSrcs.map((s) => preload(s)));
        });
        if ([bigSrc, ...neighbourSrcs].some((s) => !done.has(s))) makeUrgent(withNeighbours);
        if (done.has(bigSrc)) return ready;

        // Большой файл ещё не скачан: пока он качается, показываем превью этого же кадра
        // (оно уже есть), растянутое до размера фото, — через миг его сменит резкая версия.
        const thumbSrc = url('thumb', p);
        if (!done.has(thumbSrc)) return ready;
        const small = stageImg(thumbSrc);
        return decoded(small).then(() => {
            if (my === token && !big.isConnected) swapTo(small);
        });
    };

    // <img> для просмотра — тот самый, в который файл уже скачан (или качается)
    function stageImg(src, priority) {
        preload(src, priority);
        const img = elements.get(src);
        img.className = 'stage-img';
        img.id = 'stage-img';
        img.alt = '';
        return img;
    }
    function swapTo(img) {
        if (img !== mainImg) {
            mainImg.replaceWith(img);
            mainImg = img;
        }
        fit();
    }

    const next = () => show(current + 1);
    const prev = () => show(current - 1);

    window.addEventListener('resize', fit);
    if (document.fonts) document.fonts.ready.then(fit);

    // --- СЕТКА ПРЕВЬЮ (главный вид раздела) ---
    // Ровные строки на всю ширину: ширина кадра пропорциональна его соотношению сторон (--r),
    // поэтому все кадры в строке одной высоты. Кадры «проявляются» по очереди.
    const thumbItems = photos.map((p, i) => {
        // не <a href>: иначе браузер при наведении показывает ссылку внизу слева
        // и закрывает ею строку «2025 · 71 frames»
        const item = document.createElement('div');
        item.className = 'thumb';
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPhoto(i);
            }
        });
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
            e.stopPropagation(); // иначе клик дойдёт до просмотра и перелистнёт
            openPhoto(i);
        });
        thumbsEl.appendChild(item);
        return item;
    });

    // --- ПЕРЕКЛЮЧЕНИЕ СЕТКА ⇄ ПРОСМОТР ---
    // В сетке скроллится вся страница; при открытии кадра запоминаем, где были,
    // и возвращаемся туда же, когда снова показываем сетку.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    // Строка «2025 · 71 frames» / «2025 loading …»: в сетке она сверху —
    // на широком экране в шапке по центру, на узком над превью.
    // В просмотре фото — снизу под кадром (там счётчик и show thumbnails).
    const header = document.querySelector('.main-header');
    const wideHeader = window.matchMedia('(min-width: 900px)');
    const placeBar = () => {
        const grid = gridOpen();
        const inHeader = grid && wideHeader.matches;
        if (inHeader) {
            if (bar.parentNode !== header) header.appendChild(bar);
        } else if (grid) {
            if (bar.nextElementSibling !== thumbsEl) viewer.insertBefore(bar, thumbsEl);
        } else if (bar.previousElementSibling !== thumbsEl) {
            thumbsEl.after(bar);
        }
        document.body.classList.toggle('bar-in-header', inHeader);
    };
    wideHeader.addEventListener('change', placeBar);

    let gridScrollY = 0;
    const setGrid = (open) => {
        const wasOpen = gridOpen();
        if (wasOpen && !open) gridScrollY = window.scrollY;
        document.body.classList.toggle('thumbs-open', open);
        placeBar();
        if (open) {
            if (!wasOpen) window.scrollTo(0, gridScrollY);
        } else {
            window.scrollTo(0, 0);
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

    toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        backToGrid();
    });
    document.getElementById('viewer-prev').addEventListener('click', (e) => { e.stopPropagation(); prev(); });
    document.getElementById('viewer-next').addEventListener('click', (e) => { e.stopPropagation(); next(); });

    // --- КЛИКИ / ТАПЫ В ПРОСМОТРЕ ---
    // по фото: правая половина — дальше, левая — назад; по пустому месту — назад к сетке (как на главной)
    let lastSwipeAt = 0;

    viewer.addEventListener('click', (e) => {
        if (gridOpen() || isZoomed() || e.target.closest('.thumbs, .lb-controls-corner')) return;
        if (Date.now() - lastSwipeAt < 400) return;
        if (e.target !== mainImg) {
            backToGrid();
            return;
        }
        if (e.clientX > window.innerWidth / 2) next();
        else prev();
    });

    // свайп на телефоне.
    // Зум двумя пальцами и движение по увеличенному фото не должны листать:
    // жест с двумя пальцами игнорируем целиком, а пока страница увеличена — свайпы и тапы не листают.
    const isZoomed = () => !!window.visualViewport && window.visualViewport.scale > 1.05;
    let touchX = null;
    let touchY = null;
    let multiTouch = false;
    viewer.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) {
            multiTouch = true;
            touchX = touchY = null;
            return;
        }
        multiTouch = false;
        touchX = e.touches[0].clientX;
        touchY = e.touches[0].clientY;
    }, { passive: true });
    viewer.addEventListener('touchend', (e) => {
        if (multiTouch) {
            lastSwipeAt = Date.now(); // гасим «клик», который браузер может прислать после жеста
            if (e.touches.length === 0) multiTouch = false;
            return;
        }
        if (touchX === null || gridOpen() || isZoomed()) return;
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

    // --- ЗАГРУЗКА: сетку показываем, только когда скачаны ВСЕ фото в полном размере —
    // открытие дольше, зато потом любой кадр открывается сразу резким.
    // Пока грузится — «2025 loading» и мелькают имена загруженных файлов (как у Энтони).
    const startedAt = performance.now();
    const MIN_LOADING_MS = 700;
    const MAX_LOADING_MS = 60000; // предохранитель на совсем плохую сеть: остальное догрузится в фоне

    const queue = [
        ...photos.map((p) => ({ src: url('thumb', p), name: p.file })), // сначала превью — они лёгкие
        ...photos.map((p) => ({ src: url('large', p), name: p.file })),
    ];
    let loadedCount = 0;
    let revealed = false;

    // имена показываем по очереди не чаще раза в 60 мс — эффект «бегущих» файлов
    const names = [];
    const flick = setInterval(() => {
        if (names.length) statusEl.textContent = names.shift();
    }, 60);

    const loadAll = () => new Promise((resolve) => {
        const PARALLEL = 6;
        const total = queue.length;
        const pump = () => {
            if (!queue.length) return;
            if (urgent) { urgent.then(pump); return; } // сначала то, что открыли
            const item = queue.shift();
            preload(item.src, 'low').then(() => {
                loadedCount++;
                if (!revealed) names.push(item.name);
                if (loadedCount === total) resolve();
                pump();
            });
        };
        for (let k = 0; k < PARALLEL; k++) pump();
    });

    const reveal = () => {
        if (revealed) return;
        const wait = Math.max(0, MIN_LOADING_MS - (performance.now() - startedAt));
        setTimeout(() => {
            revealed = true;
            clearInterval(flick);
            bar.classList.remove('is-loading');
            document.body.classList.add('is-loaded');
            fit();
        }, wait);
    };

    // Ссылка на конкретный кадр (#имя-файла) открывает сразу его, остальное грузится в фоне.
    // Обычный заход и обновление страницы (F5) — сетка, после загрузки всех фото.
    const navEntry = performance.getEntriesByType('navigation')[0];
    const isReload = navEntry && navEntry.type === 'reload';
    let fromHash = '';
    if (!isReload) {
        try { fromHash = decodeURIComponent(location.hash.slice(1)); } catch (e) { /* битая ссылка */ }
    }
    const startIndex = photos.findIndex((p) => p.file === fromHash);

    if (startIndex !== -1) {
        show(startIndex).then(() => {
            reveal();
            loadAll();
        });
    } else {
        if (location.hash) history.replaceState(null, '', location.pathname);
        setGrid(true);
        Promise.race([loadAll(), new Promise((r) => setTimeout(r, MAX_LOADING_MS))]).then(reveal);
    }
});
