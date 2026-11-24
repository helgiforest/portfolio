// Размер фото в просмотре (общий для главной и разделов).
// Фото стоит по центру экрана и должно быть как можно больше, но не залезать
// под блок кнопок в правом нижнем углу. Если залезает — пробуем два варианта
// (сузить с боков или уменьшить по высоте) и берём тот, где фото крупнее.
window.fitPhoto = (photoW, photoH, screenW, screenH, controls) => {
    const mobile = screenW <= 768;
    const padX = mobile ? 10 : Math.round(screenW * 0.05); // поля по бокам (на телефоне — как у главной)
    const padY = mobile ? 10 : 40;                        // поля сверху и снизу
    const gap = 16;                                        // зазор до кнопок

    const size = (availW, availH) => {
        const s = Math.max(0, Math.min(availW / photoW, availH / photoH, 1));
        return [Math.floor(photoW * s), Math.floor(photoH * s)];
    };

    let [w, h] = size(screenW - 2 * padX, screenH - 2 * padY);
    if (!controls) return [w, h];

    // где блок кнопок: отступ от правого/нижнего края + его размер
    const r = controls.getBoundingClientRect();
    const fromRight = screenW - r.left + gap; // сколько места справа занято кнопками
    const fromBottom = screenH - r.top + gap; // сколько места снизу
    const hitsX = (screenW + w) / 2 > screenW - fromRight;
    const hitsY = (screenH + h) / 2 > screenH - fromBottom;
    if (hitsX && hitsY) {
        const narrower = size(screenW - 2 * Math.max(padX, fromRight), screenH - 2 * padY);
        const lower = size(screenW - 2 * padX, screenH - 2 * Math.max(padY, fromBottom));
        [w, h] = narrower[0] * narrower[1] >= lower[0] * lower[1] ? narrower : lower;
    }
    return [w, h];
};
