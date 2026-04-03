import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
const SIZE_MAP = {
    sm: 14,
    md: 20,
    lg: 32,
};
export function StarRating({ value, onChange, size = 'md', readonly = false }) {
    const [hovered, setHovered] = useState(null);
    const px = SIZE_MAP[size];
    const display = hovered ?? value;
    return (_jsx("div", { className: "inline-flex items-center gap-0.5", role: readonly ? 'img' : 'group', "aria-label": readonly ? `${value} out of 5 stars` : 'Select star rating', children: [1, 2, 3, 4, 5].map(star => {
            const filled = star <= display;
            return (_jsx("button", { type: "button", disabled: readonly, "aria-label": readonly ? undefined : `${star} star${star !== 1 ? 's' : ''}`, onClick: () => !readonly && onChange?.(star), onMouseEnter: () => !readonly && setHovered(star), onMouseLeave: () => !readonly && setHovered(null), className: [
                    'transition-transform',
                    !readonly && 'hover:scale-110 cursor-pointer',
                    readonly && 'cursor-default pointer-events-none',
                ].filter(Boolean).join(' '), style: { width: px, height: px, padding: 0, background: 'none', border: 'none' }, children: _jsxs("svg", { width: px, height: px, viewBox: "0 0 24 24", fill: filled ? 'url(#starGrad)' : 'none', stroke: filled ? 'none' : '#d1c4c4', strokeWidth: "1.5", "aria-hidden": "true", children: [_jsx("defs", { children: _jsxs("linearGradient", { id: "starGrad", x1: "0", y1: "0", x2: "1", y2: "0", children: [_jsx("stop", { offset: "0%", stopColor: "#F04E37" }), _jsx("stop", { offset: "100%", stopColor: "#FF8C38" })] }) }), _jsx("path", { d: "M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z" })] }) }, star));
        }) }));
}
