// «Мелькалка» для экрана загрузки (общая для главной и разделов).
// Рисует на холсте уже скачанное фото, но так, чтобы не спойлерить:
// каждый раз в случайном виде — пиксели, размытое пятно или кусочек кадра
// (один и тот же вид два раза подряд не повторяется).
//   const draw = window.photoFlash(canvas);  draw(img);
window.photoFlash = (canvas, BOX = 300) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = BOX * dpr;
    const ctx = canvas.getContext('2d');
    const tmp = document.createElement('canvas');
    const tctx = tmp.getContext('2d');

    // фото, вписанное в квадрат: [x, y, w, h]
    const fitRect = (img) => {
        const s = Math.min(BOX / img.naturalWidth, BOX / img.naturalHeight);
        const w = img.naturalWidth * s;
        const h = img.naturalHeight * s;
        return [(BOX - w) / 2, (BOX - h) / 2, w, h];
    };
    // уменьшенная копия: cols точек по ширине
    const shrink = (img, cols) => {
        tmp.width = cols;
        tmp.height = Math.max(1, Math.round((cols * img.naturalHeight) / img.naturalWidth));
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(img, 0, 0, tmp.width, tmp.height);
        return tmp;
    };
    const modes = {
        // пиксели: кадр из крупных квадратов — видно цвета и свет, но не что на снимке
        pixel(img) {
            const [x, y, w, h] = fitRect(img);
            const small = shrink(img, img.naturalWidth >= img.naturalHeight ? 22 : 16);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(small, x, y, w, h);
        },
        // размытие: цветное пятно
        blur(img) {
            const [x, y, w, h] = fitRect(img);
            const small = shrink(img, 20);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(small, x, y, w, h);
            canvas.style.filter = 'blur(8px)';
        },
        // кусочек кадра: случайный квадрат — текстура, угол, деталь
        fragment(img) {
            const side = Math.min(img.naturalWidth, img.naturalHeight) * 0.28;
            const sx = Math.random() * (img.naturalWidth - side);
            const sy = Math.random() * (img.naturalHeight - side);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, sx, sy, side, side, 0, 0, BOX, BOX);
        },
    };
    const names = Object.keys(modes);
    let last = '';

    return (img) => {
        if (!img || !img.naturalWidth) return;
        const choices = names.filter((m) => m !== last);
        last = choices[Math.floor(Math.random() * choices.length)];
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, BOX, BOX);
        canvas.style.filter = '';
        modes[last](img);
    };
};

// Подпись под мелькалкой: «loading gallery» при обычном заходе,
// при обновлении страницы (F5) — случайная фраза.
window.loadingLabel = () => {
    const phrases = [
        'shuffling',
        'mixing the order',
        'reshuffling frames',
        'randomizing',
        'reordering the gallery',
        'rolling the film',
    ];
    const nav = performance.getEntriesByType('navigation')[0];
    return nav && nav.type === 'reload'
        ? phrases[Math.floor(Math.random() * phrases.length)]
        : 'loading gallery';
};
