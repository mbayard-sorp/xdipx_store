import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router';
import { StarRating } from './StarRating';
export function RatingSummary({ aggregate, productId }) {
    const { approvedCount, averageRating, rating1Count, rating2Count, rating3Count, rating4Count, rating5Count, verifiedCount, withPhotoCount, } = aggregate;
    const total = approvedCount || 1; // avoid division by zero
    const bars = [
        { stars: 5, count: rating5Count },
        { stars: 4, count: rating4Count },
        { stars: 3, count: rating3Count },
        { stars: 2, count: rating2Count },
        { stars: 1, count: rating1Count },
    ];
    const recommendPct = approvedCount > 0
        ? Math.round(((rating4Count + rating5Count) / approvedCount) * 100)
        : 0;
    return (_jsxs("section", { className: "bg-white rounded-2xl border border-brand-mist p-6 mb-6", children: [_jsxs("div", { className: "flex flex-col sm:flex-row gap-6 items-start", children: [_jsxs("div", { className: "flex flex-col items-center sm:items-start shrink-0", children: [_jsx("span", { className: "text-6xl font-black text-brand-charcoal", style: { fontFamily: 'var(--font-display)' }, children: averageRating.toFixed(1) }), _jsx(StarRating, { value: Math.round(averageRating), readonly: true, size: "lg" }), _jsxs("span", { className: "text-sm text-brand-charcoal/50 mt-1", children: [approvedCount, " review", approvedCount !== 1 ? 's' : ''] })] }), _jsx("div", { className: "flex-1 w-full space-y-1.5", children: bars.map(({ stars, count }) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs text-brand-charcoal/60 w-4 text-right shrink-0", children: stars }), _jsx("span", { className: "text-brand-charcoal/40 text-xs shrink-0", children: "\u2605" }), _jsx("div", { className: "flex-1 h-2 bg-brand-mist rounded-full overflow-hidden", children: _jsx("div", { className: "h-full rounded-full transition-all duration-500", style: {
                                            width: `${Math.round((count / total) * 100)}%`,
                                            background: '#7B2FBE',
                                        } }) }), _jsx("span", { className: "text-xs text-brand-charcoal/50 w-6 shrink-0", children: count })] }, stars))) })] }), approvedCount > 0 && (_jsxs("div", { className: "flex flex-wrap gap-3 mt-5 pt-4 border-t border-brand-mist", children: [_jsxs("span", { className: "inline-flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-medium px-3 py-1 rounded-full", children: [_jsx("span", { "aria-hidden": "true", children: "\u2665" }), recommendPct, "% recommend"] }), verifiedCount > 0 && (_jsxs("span", { className: "inline-flex items-center gap-1.5 bg-brand-mist text-brand-purple text-xs font-medium px-3 py-1 rounded-full", children: [_jsx("span", { "aria-hidden": "true", children: "\u2713" }), verifiedCount, " verified purchase", verifiedCount !== 1 ? 's' : ''] })), withPhotoCount > 0 && (_jsxs("span", { className: "inline-flex items-center gap-1.5 bg-brand-mist text-brand-charcoal/60 text-xs font-medium px-3 py-1 rounded-full", children: [_jsx("span", { "aria-hidden": "true", children: "\uD83D\uDCF7" }), withPhotoCount, " with photo", withPhotoCount !== 1 ? 's' : ''] }))] })), _jsx("div", { className: "mt-5", children: _jsx(Link, { to: `/review?productId=${productId}`, className: "inline-block bg-brand-gradient text-white font-semibold text-sm px-6 py-2.5 rounded-full hover:opacity-90 transition-opacity", style: { fontFamily: 'var(--font-display)' }, children: "Write a Review \u2665" }) })] }));
}
