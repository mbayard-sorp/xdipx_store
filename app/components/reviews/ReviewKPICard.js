import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router';
export function ReviewKPICard({ title, value, subtitle, cta }) {
    return (_jsxs("div", { className: "bg-white rounded-2xl border border-brand-mist p-5 flex flex-col gap-2", children: [_jsx("p", { className: "text-xs font-semibold text-brand-charcoal/50 uppercase tracking-widest", children: title }), _jsx("p", { className: "text-3xl font-black text-brand-charcoal", style: { fontFamily: 'var(--font-display)' }, children: value }), subtitle && (_jsx("p", { className: "text-xs text-brand-charcoal/40", children: subtitle })), cta && (_jsxs(Link, { to: cta.to, className: "mt-auto text-xs font-semibold text-brand-purple hover:text-brand-purple-light transition-colors", style: { fontFamily: 'var(--font-display)' }, children: [cta.label, " \u2192"] }))] }));
}
