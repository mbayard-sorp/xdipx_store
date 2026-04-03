import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useLocation } from 'react-router';
import { ReviewCard } from './ReviewCard';
import { RatingSummary } from './RatingSummary';
const SORT_OPTIONS = [
    { value: 'newest', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'highest', label: 'Highest rated' },
    { value: 'lowest', label: 'Lowest rated' },
    { value: 'helpful', label: 'Most helpful' },
];
const FILTER_TABS = [
    { value: 'all', label: 'All' },
    { value: 'verified', label: 'Verified' },
    { value: 'with_photo', label: 'With photo' },
    { value: '5star', label: '5★' },
    { value: '4star', label: '4★' },
    { value: '3star', label: '3★ & below' },
];
function buildReviewUrl(pathname, search, overrides) {
    const params = new URLSearchParams(search);
    for (const [k, v] of Object.entries(overrides)) {
        params.set(k, String(v));
    }
    return `${pathname}?${params.toString()}`;
}
export function ReviewList({ reviews, aggregate, productId, total, page, sort, filter, }) {
    const { pathname, search } = useLocation();
    const perPage = 10;
    const totalPages = Math.ceil(total / perPage);
    return (_jsxs("section", { className: "mt-8", children: [_jsx("h2", { className: "text-xl font-bold text-brand-charcoal mb-4", style: { fontFamily: 'var(--font-display)' }, children: "Customer Reviews" }), _jsx(RatingSummary, { aggregate: aggregate, productId: productId }), _jsx("div", { className: "flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-hide", children: FILTER_TABS.map(tab => (_jsx(Link, { to: buildReviewUrl(pathname, search, { reviewFilter: tab.value, reviewPage: 1 }), className: [
                        'shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors',
                        filter === tab.value
                            ? 'bg-brand-purple text-white border-brand-purple'
                            : 'border-brand-mist text-brand-charcoal/60 hover:border-brand-purple/40',
                    ].join(' '), style: { fontFamily: 'var(--font-display)' }, prefetch: "intent", children: tab.label }, tab.value))) }), _jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("span", { className: "text-sm text-brand-charcoal/50", children: [total, " review", total !== 1 ? 's' : ''] }), _jsxs("label", { className: "flex items-center gap-2 text-sm text-brand-charcoal/60", children: ["Sort:", _jsx("select", { className: "border border-brand-mist rounded-lg px-2 py-1 text-sm text-brand-charcoal bg-white", value: sort, onChange: e => {
                                    window.location.href = buildReviewUrl(pathname, search, { reviewSort: e.target.value, reviewPage: 1 });
                                }, children: SORT_OPTIONS.map(o => (_jsx("option", { value: o.value, children: o.label }, o.value))) })] })] }), reviews.length === 0 ? (_jsxs("div", { className: "text-center py-12 text-brand-charcoal/40", children: [_jsx("p", { className: "text-4xl mb-3", "aria-hidden": "true", children: "\u2665" }), _jsx("p", { className: "font-medium", children: "No reviews yet \u2014 be the first!" }), _jsx(Link, { to: `/review?productId=${productId}`, className: "inline-block mt-4 bg-brand-gradient text-white font-semibold text-sm px-6 py-2.5 rounded-full hover:opacity-90 transition-opacity", style: { fontFamily: 'var(--font-display)' }, children: "Write a Review \u2665" })] })) : (_jsx("div", { className: "space-y-4", children: reviews.map(review => (_jsx(ReviewCard, { review: review }, review.id))) })), totalPages > 1 && (_jsxs("div", { className: "flex items-center justify-center gap-2 mt-6", children: [page > 1 && (_jsx(Link, { to: buildReviewUrl(pathname, search, { reviewPage: page - 1 }), className: "px-4 py-2 text-sm border border-brand-mist rounded-full text-brand-charcoal/60 hover:border-brand-purple/40 transition-colors", prefetch: "intent", children: "\u2190 Prev" })), _jsxs("span", { className: "text-sm text-brand-charcoal/50", children: [page, " / ", totalPages] }), page < totalPages && (_jsx(Link, { to: buildReviewUrl(pathname, search, { reviewPage: page + 1 }), className: "px-4 py-2 text-sm border border-brand-mist rounded-full text-brand-charcoal/60 hover:border-brand-purple/40 transition-colors", prefetch: "intent", children: "Next \u2192" }))] }))] }));
}
