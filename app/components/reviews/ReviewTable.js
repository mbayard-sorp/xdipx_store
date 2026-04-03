import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { StarRating } from './StarRating';
const STATUS_STYLES = {
    pending: 'bg-amber-50  text-amber-700',
    approved: 'bg-green-50  text-green-700',
    rejected: 'bg-red-50    text-red-700',
    spam: 'bg-gray-100  text-gray-500',
};
function relativeDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}
export function ReviewTable({ reviews, total, selectedIds, onSelect, onView, }) {
    const allSelected = reviews.length > 0 && reviews.every(r => selectedIds.includes(r.id));
    const toggleAll = () => {
        if (allSelected) {
            onSelect(selectedIds.filter(id => !reviews.some(r => r.id === id)));
        }
        else {
            onSelect([...new Set([...selectedIds, ...reviews.map(r => r.id)])]);
        }
    };
    const toggleOne = (id) => {
        if (selectedIds.includes(id)) {
            onSelect(selectedIds.filter(sid => sid !== id));
        }
        else {
            onSelect([...selectedIds, id]);
        }
    };
    return (_jsxs("div", { className: "overflow-x-auto rounded-2xl border border-brand-mist bg-white", children: [_jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-brand-mist text-left", children: [_jsx("th", { className: "px-4 py-3 w-8", children: _jsx("input", { type: "checkbox", checked: allSelected, onChange: toggleAll, "aria-label": "Select all reviews", className: "rounded border-brand-mist" }) }), _jsx("th", { className: "px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider", children: "Reviewer" }), _jsx("th", { className: "px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider", children: "Rating" }), _jsx("th", { className: "px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider", children: "Title / Preview" }), _jsx("th", { className: "px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider", children: "Status" }), _jsx("th", { className: "px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider", children: "Date" }), _jsx("th", { className: "px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider", children: "Actions" })] }) }), _jsxs("tbody", { children: [reviews.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 7, className: "px-4 py-12 text-center text-brand-charcoal/40", children: "No reviews found." }) })), reviews.map(review => (_jsxs("tr", { className: "border-b border-brand-mist last:border-0 hover:bg-brand-mist/40 transition-colors", children: [_jsx("td", { className: "px-4 py-3", children: _jsx("input", { type: "checkbox", checked: selectedIds.includes(review.id), onChange: () => toggleOne(review.id), "aria-label": `Select review by ${review.reviewerName}`, className: "rounded border-brand-mist" }) }), _jsx("td", { className: "px-4 py-3", children: _jsxs("div", { children: [_jsx("p", { className: "font-medium text-brand-charcoal text-xs", children: review.reviewerName }), review.isVerifiedPurchase && (_jsx("span", { className: "text-[10px] text-green-600", children: "\u2713 Verified" }))] }) }), _jsx("td", { className: "px-4 py-3", children: _jsx(StarRating, { value: review.rating, readonly: true, size: "sm" }) }), _jsxs("td", { className: "px-4 py-3 max-w-xs", children: [review.title && (_jsx("p", { className: "font-semibold text-xs text-brand-charcoal truncate", children: review.title })), review.body && (_jsx("p", { className: "text-xs text-brand-charcoal/50 truncate", children: review.body.slice(0, 80) }))] }), _jsx("td", { className: "px-4 py-3", children: _jsx("span", { className: [
                                                'text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize',
                                                STATUS_STYLES[review.status] ?? 'bg-brand-mist text-brand-charcoal',
                                            ].join(' '), children: review.status }) }), _jsx("td", { className: "px-4 py-3 text-xs text-brand-charcoal/50 whitespace-nowrap", children: relativeDate(review.createdAt) }), _jsx("td", { className: "px-4 py-3", children: _jsx("button", { type: "button", onClick: () => onView(review), className: "text-xs font-medium text-brand-purple hover:text-brand-purple-light transition-colors", style: { fontFamily: 'var(--font-display)' }, children: "View \u2192" }) })] }, review.id)))] })] }), total > reviews.length && (_jsxs("div", { className: "px-4 py-2 border-t border-brand-mist text-xs text-brand-charcoal/40 text-right", children: ["Showing ", reviews.length, " of ", total] }))] }));
}
