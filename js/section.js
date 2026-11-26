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

    // фото лежат прямо в /images/<раздел>/ (экспорт из Lightroom), превью — в thumb/,
    // версии для телефона (1170px по ширине, вдвое легче) — в phone/.
    // Телефон — по размеру самого экрана, а не окна: узкое окно на компьютере получает полные фото.
    const isPhoneScreen = Math.min(screen.width, screen.height) <= 500;
    const url = (size, p) => {
        const name = encodeURIComponent(p.file);
        if (size === 'thumb') return `/images/${section}/thumb/${name}.webp`;
        if (isPhoneScreen && p.phone) return `/images/${section}/phone/${name}.avif`;
        return `/images/${section}/${name}.${p.ext}`;
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
    // Если сеть моргнула и файл не скачался — ещё две попытки с паузой. Не вышло и так —
    // забываем этот <img>, чтобы битая картинка не осталась в памяти: при следующем
    // открытии кадра файл качается заново.
    const preload = (src, priority) => {
        if (!cache.has(src)) {
            cache.set(src, new Promise((resolve) => {
                const im = new Image();
                if (priority) im.fetchPriority = priority;
                let tries = 0;
                im.onload = () => { done.add(src); resolve(); };
                im.onerror = () => {
                    if (++tries <= 2) {
                        setTimeout(() => { im.src = `${src}?retry=${tries}`; }, 1000 * tries);
                        return;
                    }
                    if (elements.get(src) === im) {
                        cache.delete(src);
                        elements.delete(src);
                    }
                    resolve();
                };
                im.src = src;
                elements.set(src, im);
            }));
        }
        return cache.get(src);
    };

    // Кадр, который человек открыл (если ещё не скачан), и соседние:
    // пока они качаются, фоновая загрузка не берёт новые файлы.
    let urgent = null;
    let resumeQueue = () => {}; // фоновая очередь (ниже) подставит сюда свой запуск
    const makeUrgent = (wait) => {
        urgent = wait;
        wait.then(() => {
            if (urgent !== wait) return;
            urgent = null;
            resumeQueue();
        });
    };

    // картинка загружена и раскодирована — можно показывать без мигания.
    // decode() ждём не дольше 300 мс: в неактивной вкладке браузер может его откладывать.
    const decoded = (im, src) => preload(src).then(() => {
        if (!done.has(src) || !im.decode) return;
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
        // Нерезкое не показываем никогда: если файл ещё не скачан, на экране пусто
        // (через 0,3 с в счётчике — «loading»), а потом сразу резкое фото с лёгким проявлением.
        const bigSrc = url('large', p);
        const big = stageImg(bigSrc, 'high');
        const neighbourSrcs = [1, -1, 2].map((d) => url('large', photos[wrap(i + d)]));
        const waiting = !done.has(bigSrc);
        if (waiting) startWaiting(my, i);
        const ready = decoded(big, bigSrc).then(() => {
            if (my !== token) return; // пока грузилось, уже перелистнули дальше
            stopWaiting(i);
            if (done.has(bigSrc)) { swapTo(big, waiting); return; }
            // большой файл так и не скачался (сеть) — битую картинку не показываем, вместо неё превью
            const thumbSrc = url('thumb', p);
            const small = stageImg(thumbSrc);
            return decoded(small, thumbSrc).then(() => {
                if (my === token && done.has(thumbSrc)) swapTo(small, true);
            });
        });
        // сразу за открытым кадром — соседние, чтобы листать без ожидания;
        // следующий ещё и распаковываем заранее, чтобы «дальше» было мгновенным
        const withNeighbours = ready.then(() => {
            if (my !== token) return;
            return Promise.all(neighbourSrcs.map((s) => preload(s))).then(() => {
                const nextEl = elements.get(neighbourSrcs[0]);
                if (my === token && nextEl && done.has(neighbourSrcs[0]) && nextEl.decode) nextEl.decode().catch(() => {});
            });
        });
        if ([bigSrc, ...neighbourSrcs].some((s) => !done.has(s))) makeUrgent(withNeighbours);
        return ready;
    };

    // ожидание не скачанного кадра: старое фото убираем, через 0,3 с — «loading» рядом со счётчиком
    let waitTimer = null;
    function startWaiting(my, i) {
        viewer.classList.add('is-waiting');
        clearTimeout(waitTimer);
        waitTimer = setTimeout(() => {
            if (my === token) counterEl.textContent = `${i + 1} / ${photos.length}   loading`;
        }, 300);
    }
    function stopWaiting(i) {
        clearTimeout(waitTimer);
        viewer.classList.remove('is-waiting');
        counterEl.textContent = `${i + 1} / ${photos.length}`;
    }

    // <img> для просмотра — тот самый, в который файл уже скачан (или качается)
    function stageImg(src, priority) {
        preload(src, priority);
        const img = elements.get(src);
        img.className = 'stage-img';
        img.id = 'stage-img';
        img.alt = '';
        return img;
    }
    function swapTo(img, fadeIn) {
        if (img !== mainImg) {
            mainImg.replaceWith(img);
            mainImg = img;
        }
        // после ожидания — мягкое проявление (0,15 с); уже скачанные кадры листаются мгновенно
        img.classList.remove('fade-in');
        if (fadeIn) {
            void img.offsetWidth; // перезапуск анимации
            img.classList.add('fade-in');
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

        // Намерение открыть: мышь задержалась на кадре 60 мс или палец коснулся —
        // сразу качаем его полную версию первой (обычно это даёт ~0,1–0,3 с форы до клика).
        let hoverTimer = null;
        const want = () => {
            const src = url('large', p);
            if (done.has(src)) return;
            makeUrgent(preload(src, 'high'));
        };
        item.addEventListener('pointerenter', (e) => {
            if (e.pointerType === 'mouse') hoverTimer = setTimeout(want, 60);
        });
        item.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
        item.addEventListener('pointerdown', want);
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

    // открыть кадр из сетки. Скачанный — сетку закрываем, когда он распакован (без мигания).
    // Ещё не скачанный — просмотр открываем сразу: пустой экран и «loading», потом резкое фото.
    // Кнопка «назад» браузера вернёт к сетке.
    let pushed = false;
    const openPhoto = (i) => {
        if (!pushed) {
            history.pushState({ photo: true }, '', `#${encodeURIComponent(photos[i].file)}`);
            pushed = true;
        }
        const ready = show(i);
        if (viewer.classList.contains('is-waiting')) setGrid(false);
        ready.then(() => {
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
    // по фото: правая половина — дальше, левая — назад; по пустому месту — назад к сетке (как на главной).
    // На телефоне узкие поля слева и справа от фото (на всю его высоту) тоже листают —
    // к сетке ведут только поля над и под фото.
    let lastSwipeAt = 0;
    const isPhone = () => window.matchMedia('(max-width: 768px)').matches;

    viewer.addEventListener('click', (e) => {
        if (gridOpen() || isZoomed() || e.target.closest('.thumbs, .lb-controls-corner')) return;
        if (Date.now() - lastSwipeAt < 400) return;
        const r = mainImg.getBoundingClientRect();
        const besidePhoto = isPhone() && e.clientY >= r.top && e.clientY <= r.bottom;
        if (e.target !== mainImg && !besidePhoto) {
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

    // --- ЗАГРУЗКА ---
    // Сетку показываем, когда скачаны все превью и первые FIRST_FULL полных кадров
    // (а не все 100 МБ — так делают все большие галереи). Остальные полные фото
    // докачиваются в фоне по одному-два, в порядке сетки: когда файлов в работе мало,
    // каждый приходит быстро, и кадр, на который смотрят или наводят, не ждёт в толпе.
    // Пока грузится — «2025 loading» и мелькают имена загруженных файлов (как у Энтони).
    const startedAt = performance.now();
    const MIN_LOADING_MS = 700;
    const MAX_LOADING_MS = 30000; // предохранитель на совсем плохую сеть: остальное догрузится в фоне
    // экономия трафика или медленная сеть (Chrome/Android сообщают) — полные фото только по требованию
    const conn = navigator.connection;
    const lite = !!conn && (conn.saveData || /(^|-)(2g|3g)$/.test(conn.effectiveType || ''));
    const FIRST_FULL = lite ? 0 : Math.min(4, photos.length);

    const thumbJobs = photos.map((p) => ({ src: url('thumb', p), name: p.file }));
    const fullJobs = lite ? [] : photos.map((p) => ({ src: url('large', p), name: p.file }));
    const queue = [...thumbJobs, ...fullJobs]; // сначала превью — они лёгкие
    const mustHave = [...thumbJobs, ...fullJobs.slice(0, FIRST_FULL)].map((j) => j.src);
    let revealed = false;

    // имена показываем по очереди не чаще раза в 60 мс — эффект «бегущих» файлов
    const names = [];
    const flick = setInterval(() => {
        if (names.length) statusEl.textContent = names.shift();
    }, 60);

    // а посреди экрана, как на главной, раз в секунду мелькает скачанное фото
    // в «неспойлерном» виде — пиксели, пятно или кусочек кадра (js/flash.js).
    // Новых скачиваний нет: берём превью (они грузятся первыми), а если уже есть — большое фото.
    // Под ним — подпись «loading gallery...», тоже как на главной.
    const flashBox = document.createElement('div');
    flashBox.className = 'section-flash';
    flashBox.setAttribute('aria-hidden', 'true');
    flashBox.innerHTML = '<canvas></canvas><div class="preloader-text"><span></span><span class="typewriter-dots"></span></div>';
    flashBox.querySelector('.preloader-text span').textContent = window.loadingLabel();
    document.body.appendChild(flashBox);
    const flashCanvas = flashBox.querySelector('canvas');
    const drawFlash = window.photoFlash(flashCanvas);
    const flashPool = []; // кадры, у которых уже есть превью
    let flashLast = -1;
    const flashNext = () => {
        if (revealed || !flashPool.length) return;
        let k = Math.floor(Math.random() * flashPool.length);
        if (flashPool.length > 1 && k === flashLast) k = (k + 1) % flashPool.length;
        flashLast = k;
        const p = flashPool[k];
        const big = url('large', p);
        drawFlash(elements.get(done.has(big) ? big : url('thumb', p)));
        flashCanvas.classList.add('on');
    };
    const flashTimer = setInterval(flashNext, 1000);
    const onLoaded = (src) => {
        if (revealed || !done.has(src)) return;
        const p = photos.find((q) => url('thumb', q) === src);
        if (!p) return;
        flashPool.push(p);
        if (flashPool.length === 1) flashNext();
    };

    // до показа сетки — 6 файлов одновременно (превью маленькие), после — по 2
    const parallel = () => (revealed ? 1 : 6);
    let active = 0;
    let started = false;
    let mustLeft = mustHave.length;
    let onMustHave = () => {};
    const mustSet = new Set(mustHave);
    const pump = () => {
        if (!started) return;
        while (active < parallel() && queue.length && !urgent) { // открытый / выбранный кадр — первым
            const item = queue.shift();
            if (done.has(item.src)) { finished(item); continue; }
            active++;
            preload(item.src, 'low').then(() => {
                active--;
                finished(item);
                pump();
            });
        }
    };
    function finished(item) {
        if (!revealed) names.push(item.name);
        onLoaded(item.src);
        if (mustSet.delete(item.src) && --mustLeft === 0) onMustHave();
    }
    resumeQueue = pump;
    const loadAll = () => new Promise((resolve) => {
        onMustHave = resolve;
        if (!mustLeft) resolve();
        started = true;
        pump();
    });

    const reveal = () => {
        if (revealed) return;
        const wait = Math.max(0, MIN_LOADING_MS - (performance.now() - startedAt));
        setTimeout(() => {
            revealed = true;
            clearInterval(flick);
            clearInterval(flashTimer);
            flashBox.classList.add('done');
            setTimeout(() => flashBox.remove(), 600);
            bar.classList.remove('is-loading');
            document.body.classList.add('is-loaded');
            fit();
            pump(); // дальше — фоновая докачка по 2
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
