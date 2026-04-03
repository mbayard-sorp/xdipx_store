import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
export function MediaLightbox({ media, initialIndex = 0, onClose }) {
    const [index, setIndex] = useState(initialIndex);
    const current = media[index];
    const prev = useCallback(() => setIndex(i => (i - 1 + media.length) % media.length), [media.length]);
    const next = useCallback(() => setIndex(i => (i + 1) % media.length), [media.length]);
    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'Escape')
                onClose();
            if (e.key === 'ArrowLeft')
                prev();
            if (e.key === 'ArrowRight')
                next();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose, prev, next]);
    if (!current)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm", onClick: onClose, role: "dialog", "aria-modal": "true", "aria-label": "Media lightbox", children: _jsxs("div", { className: "relative max-w-3xl w-full mx-4", onClick: e => e.stopPropagation(), children: [_jsx("button", { onClick: onClose, className: "absolute -top-10 right-0 text-white/70 hover:text-white text-2xl leading-none", "aria-label": "Close lightbox", children: "\u00D7" }), _jsx("div", { className: "rounded-2xl overflow-hidden bg-black flex items-center justify-center min-h-64 max-h-[80vh]", children: current.mediaType === 'image' ? (_jsx("img", { src: current.url, alt: `Review media ${index + 1}`, className: "max-w-full max-h-[80vh] object-contain" })) : (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    _jsx("video", { src: current.url, controls: true, className: "max-w-full max-h-[80vh]" })) }), media.length > 1 && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: prev, className: "absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors", "aria-label": "Previous media", children: "\u2039" }), _jsx("button", { onClick: next, className: "absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors", "aria-label": "Next media", children: "\u203A" }), _jsx("div", { className: "absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5", children: media.map((_, i) => (_jsx("button", { onClick: () => setIndex(i), className: [
                                    'w-1.5 h-1.5 rounded-full transition-colors',
                                    i === index ? 'bg-white' : 'bg-white/40',
                                ].join(' '), "aria-label": `Go to media ${i + 1}` }, i))) })] }))] }) }));
}
