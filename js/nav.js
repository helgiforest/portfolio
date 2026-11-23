// Меню "more": на компьютере открывается наведением (CSS), на телефоне — тапом.
document.addEventListener('DOMContentLoaded', () => {
    const more = document.querySelector('.nav-more');
    if (!more) return;
    const label = more.querySelector('.nav-more-label');

    const setOpen = (open) => {
        more.classList.toggle('open', open);
        label.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    label.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!more.classList.contains('open'));
    });

    document.addEventListener('click', (e) => {
        if (!more.contains(e.target)) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            setOpen(false);
            if (more.contains(document.activeElement)) document.activeElement.blur();
        }
    });
});
