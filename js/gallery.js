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
    let imagesLoadedTotal = 0;
    const totalImagesCount = imgs.length;
    const preloaderStartTime = Date.now();
    const MIN_PRELOADER_MS = 2600; // чтобы превьюшки успели помигать хотя бы пару раз, даже если фото загрузились почти мгновенно

    const nextFlashImage = () => {
        if (preloader.style.visibility === 'hidden') return;

        if (imgs.length > 0) {
            let randomIndex = Math.floor(Math.random() * imgs.length);
            if (imgs.length > 1 && randomIndex === flashIndex) {
                randomIndex = (randomIndex + 1) % imgs.length;
            }
            flashIndex = randomIndex;

            const nextSrc = imgs[flashIndex].src;
            const imgLoader = new Image();
            imgLoader.src = nextSrc;

            imgLoader.onload = () => {
                preloaderImg.src = nextSrc;
                preloaderImg.classList.add('loaded');
            };
        }
    };

    const flashInterval = setInterval(nextFlashImage, 1000);
    nextFlashImage();

    // 4. Контроль полной загрузки сайта
    const revealGallery = () => {
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

    const checkAllImagesLoaded = () => {
        imagesLoadedTotal++;
        if (imagesLoadedTotal >= totalImagesCount) {
            const elapsed = Date.now() - preloaderStartTime;
            const remaining = Math.max(0, MIN_PRELOADER_MS - elapsed);
            setTimeout(revealGallery, remaining);
        }
    };

    if (totalImagesCount > 0) {
        imgs.forEach(img => {
            if (img.complete) {
                checkAllImagesLoaded();
            } else {
                img.addEventListener('load', checkAllImagesLoaded);
                img.addEventListener('error', checkAllImagesLoaded);
            }
        });
    } else {
        preloader.style.display = 'none';
    }

    // --- ЛАЙТБОКС ---
    const showImage = (index) => {
        if (index < 0) index = imgs.length - 1;
        if (index >= imgs.length) index = 0;
        currentIndex = index;
        lbContainer.innerHTML = '';
        const img = new Image();
        img.className = 'lightbox-content';
        img.src = imgs[currentIndex].dataset.full || imgs[currentIndex].src;
        img.onload = () => img.style.opacity = '1';
        lbContainer.appendChild(img);
        lbCounter.textContent = `${currentIndex + 1} / ${imgs.length}`;
    };

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
    lb.onclick = (e) => { if (e.target === lb || e.target === lbContainer) closeLightbox(); };

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
