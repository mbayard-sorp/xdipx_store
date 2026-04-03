import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const SENTIMENT_STYLES = {
    positive: 'bg-green-50  text-green-700',
    neutral: 'bg-amber-50  text-amber-700',
    negative: 'bg-red-50    text-red-700',
};
export function AIAnalysisPanel({ review }) {
    if (!review.aiSentiment && review.aiSpamScore == null && !review.aiSummary) {
        return (_jsx("div", { className: "bg-brand-mist rounded-xl p-4 text-sm text-brand-charcoal/50 italic", children: "AI analysis not yet run for this review." }));
    }
    const spamPct = review.aiSpamScore != null ? Math.round(review.aiSpamScore * 100) : null;
    return (_jsxs("div", { className: "bg-brand-mist rounded-xl p-4 space-y-3", children: [_jsx("p", { className: "text-xs font-semibold text-brand-charcoal/50 uppercase tracking-widest", style: { fontFamily: 'var(--font-display)' }, children: "AI Analysis" }), review.aiSentiment && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs text-brand-charcoal/50", children: "Sentiment" }), _jsx("span", { className: [
                            'text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize',
                            SENTIMENT_STYLES[review.aiSentiment] ?? 'bg-brand-mist text-brand-charcoal',
                        ].join(' '), children: review.aiSentiment })] })), spamPct != null && (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsx("span", { className: "text-xs text-brand-charcoal/50", children: "Spam score" }), _jsxs("span", { className: [
                                    'text-xs font-semibold',
                                    spamPct >= 75 ? 'text-red-600' : spamPct >= 40 ? 'text-amber-600' : 'text-green-600',
                                ].join(' '), children: [spamPct, "%"] })] }), _jsx("div", { className: "h-1.5 bg-white rounded-full overflow-hidden", children: _jsx("div", { className: [
                                'h-full rounded-full transition-all',
                                spamPct >= 75 ? 'bg-red-500' : spamPct >= 40 ? 'bg-amber-400' : 'bg-green-500',
                            ].join(' '), style: { width: `${spamPct}%` } }) })] })), review.aiSummary && (_jsxs("p", { className: "text-xs text-brand-charcoal/70 italic leading-relaxed", children: ["\"", review.aiSummary, "\""] }))] }));
}
