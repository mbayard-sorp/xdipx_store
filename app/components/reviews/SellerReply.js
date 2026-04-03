import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    if (mins < 2)
        return 'just now';
    if (mins < 60)
        return `${mins} minutes ago`;
    if (hours < 24)
        return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (days < 7)
        return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (weeks < 5)
        return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
    return `${months} month${months !== 1 ? 's' : ''} ago`;
}
export function SellerReply({ replyBody, replyAt }) {
    return (_jsxs("div", { className: "ml-4 mt-3 bg-brand-mist rounded-xl px-4 py-3 border-l-4 border-brand-purple", children: [_jsx("p", { className: "text-xs font-semibold text-brand-purple mb-1", style: { fontFamily: 'var(--font-display)' }, children: "Response from xdipx \u2665" }), _jsx("p", { className: "text-sm text-brand-charcoal/80 leading-relaxed", children: replyBody }), _jsx("p", { className: "text-xs text-brand-charcoal/40 mt-1", children: relativeTime(replyAt) })] }));
}
