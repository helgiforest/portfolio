// Ждем, пока загрузится всё (включая тяжелую картинку)
window.addEventListener('load', () => {
    document.body.classList.add('is-loaded');
});
