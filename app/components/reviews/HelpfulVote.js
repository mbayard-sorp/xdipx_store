import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useFetcher } from 'react-router';
export function HelpfulVote({ reviewId, helpfulYes, helpfulNo }) {
    const fetcher = useFetcher();
    // Optimistic UI
    const optimisticYes = fetcher.formData?.get('vote') === 'yes' ? helpfulYes + 1 : helpfulYes;
    const optimisticNo = fetcher.formData?.get('vote') === 'no' ? helpfulNo + 1 : helpfulNo;
    const displayYes = fetcher.data?.helpfulYes ?? optimisticYes;
    const displayNo = fetcher.data?.helpfulNo ?? optimisticNo;
    const voted = fetcher.formData != null;
    return (_jsxs("div", { className: "flex items-center gap-3 mt-3", children: [_jsx("span", { className: "text-xs text-brand-charcoal/40", children: "Helpful?" }), _jsxs(fetcher.Form, { method: "post", action: `/api/reviews/${reviewId}/helpful`, className: "flex gap-2", children: [_jsxs("button", { name: "vote", value: "yes", type: "submit", disabled: voted, className: "inline-flex items-center gap-1 text-xs text-brand-charcoal/60 hover:text-brand-purple transition-colors disabled:opacity-50", "aria-label": "Mark review as helpful", children: [_jsx("span", { "aria-hidden": "true", children: "\uD83D\uDC4D" }), displayYes > 0 && _jsx("span", { children: displayYes })] }), _jsxs("button", { name: "vote", value: "no", type: "submit", disabled: voted, className: "inline-flex items-center gap-1 text-xs text-brand-charcoal/60 hover:text-brand-coral transition-colors disabled:opacity-50", "aria-label": "Mark review as not helpful", children: [_jsx("span", { "aria-hidden": "true", children: "\uD83D\uDC4E" }), displayNo > 0 && _jsx("span", { children: displayNo })] })] })] }));
}
