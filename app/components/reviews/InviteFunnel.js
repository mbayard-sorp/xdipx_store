import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
function pct(numerator, denominator) {
    if (denominator === 0)
        return '0%';
    return `${Math.round((numerator / denominator) * 100)}%`;
}
export function InviteFunnel({ sent, opened, clicked, completed }) {
    const stages = [
        { label: 'Sent', count: sent, pctOf: sent, color: '#7B2FBE' },
        { label: 'Opened', count: opened, pctOf: sent, color: '#A855F7' },
        { label: 'Clicked', count: clicked, pctOf: opened, color: '#FF8C38' },
        { label: 'Reviewed', count: completed, pctOf: clicked, color: '#F04E37' },
    ];
    const maxCount = sent || 1;
    return (_jsxs("div", { className: "bg-white rounded-2xl border border-brand-mist p-5", children: [_jsx("p", { className: "text-xs font-semibold text-brand-charcoal/50 uppercase tracking-widest mb-4", style: { fontFamily: 'var(--font-display)' }, children: "Invite Funnel" }), _jsx("div", { className: "space-y-3", children: stages.map((stage, i) => {
                    const width = maxCount > 0 ? `${Math.round((stage.count / maxCount) * 100)}%` : '0%';
                    const conversion = pct(stage.count, stage.pctOf);
                    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsx("span", { className: "text-xs font-medium text-brand-charcoal", children: stage.label }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-xs text-brand-charcoal/50", children: i > 0 && `${conversion} → ` }), _jsx("span", { className: "text-sm font-bold", style: { color: stage.color, fontFamily: 'var(--font-display)' }, children: stage.count.toLocaleString() })] })] }), _jsx("div", { className: "h-2 bg-brand-mist rounded-full overflow-hidden", children: _jsx("div", { className: "h-full rounded-full transition-all duration-700", style: { width, background: stage.color } }) })] }, stage.label));
                }) }), _jsxs("div", { className: "mt-4 pt-3 border-t border-brand-mist flex justify-between text-xs text-brand-charcoal/50", children: [_jsx("span", { children: "Overall conversion" }), _jsx("span", { className: "font-semibold text-brand-charcoal", children: pct(completed, sent) })] })] }));
}
