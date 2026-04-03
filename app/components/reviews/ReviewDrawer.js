import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { StarRating } from './StarRating';
import { AIAnalysisPanel } from './AIAnalysisPanel';
import { MediaLightbox } from './MediaLightbox';
const STATUS_LABEL = {
    pending: '⏳ Pending',
    approved: '✓ Approved',
    rejected: '✕ Rejected',
    spam: '⚠ Spam',
};
export function ReviewDrawer({ review, onClose, onUpdate }) {
    const [lightboxIndex, setLightboxIndex] = useState(null);
    const [reply, setReply] = useState(review?.replyBody ?? '');
    const [replyMode, setReplyMode] = useState(false);
    const actionFetcher = useFetcher();
    const replyFetcher = useFetcher();
    const aiSuggestFetcher = useFetcher();
    const isLoading = actionFetcher.state !== 'idle';
    // Update reply field when AI suggestion comes back
    if (aiSuggestFetcher.data?.suggestion && reply !== aiSuggestFetcher.data.suggestion) {
        setReply(aiSuggestFetcher.data.suggestion);
    }
    const handleAction = (intent) => {
        if (!review)
            return;
        actionFetcher.submit({ intent, reviewId: review.id }, { method: 'post', action: '/api/reviews/admin' });
        onUpdate();
    };
    const handleReply = () => {
        if (!review || !reply.trim())
            return;
        replyFetcher.submit({ intent: 'reply', reviewId: review.id, replyBody: reply }, { method: 'post', action: '/api/reviews/admin' });
        setReplyMode(false);
        onUpdate();
    };
    const handleAISuggest = () => {
        if (!review)
            return;
        aiSuggestFetcher.submit({ intent: 'suggest-reply', reviewId: review.id }, { method: 'post', action: '/api/reviews/admin' });
    };
    const media = review?.media ?? [];
    if (!review)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 z-50 bg-black/30 backdrop-blur-sm", onClick: onClose, "aria-hidden": "true" }), _jsxs("div", { className: "fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-y-auto", role: "dialog", "aria-modal": "true", "aria-label": "Review details", children: [_jsxs("div", { className: "flex items-center justify-between px-6 py-4 border-b border-brand-mist shrink-0", children: [_jsx("h2", { className: "font-bold text-brand-charcoal", style: { fontFamily: 'var(--font-display)' }, children: "Review Detail" }), _jsx("button", { onClick: onClose, className: "text-brand-charcoal/40 hover:text-brand-charcoal text-xl leading-none", "aria-label": "Close panel", children: "\u00D7" })] }), _jsxs("div", { className: "flex-1 px-6 py-5 space-y-5 overflow-y-auto", children: [_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("div", { className: "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0", style: { background: '#7B2FBE', fontFamily: 'var(--font-display)' }, "aria-hidden": "true", children: review.reviewerName.slice(0, 2).toUpperCase() }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold text-sm text-brand-charcoal", children: review.reviewerName }), _jsx("p", { className: "text-xs text-brand-charcoal/50", children: review.reviewerEmail }), review.shopifyOrderId && (_jsxs("p", { className: "text-xs text-brand-charcoal/40", children: ["Order: ", review.shopifyOrderId] })), _jsxs("div", { className: "flex gap-2 mt-1 flex-wrap", children: [review.isVerifiedPurchase && (_jsx("span", { className: "text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full", children: "\u2713 Verified" })), review.isIncentivized && (_jsx("span", { className: "text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full", children: "Incentivized" })), review.source !== 'organic' && (_jsx("span", { className: "text-[10px] text-brand-charcoal/40 bg-brand-mist px-2 py-0.5 rounded-full capitalize", children: review.source }))] })] }), _jsx("div", { className: "ml-auto", children: _jsx(StarRating, { value: review.rating, readonly: true, size: "sm" }) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs text-brand-charcoal/50", children: "Status:" }), _jsx("span", { className: "text-xs font-semibold capitalize", children: STATUS_LABEL[review.status] ?? review.status })] }), review.title && (_jsx("h3", { className: "font-semibold text-brand-charcoal", style: { fontFamily: 'var(--font-display)' }, children: review.title })), review.body && (_jsx("p", { className: "text-sm text-brand-charcoal/80 leading-relaxed", children: review.body })), media.length > 0 && (_jsx("div", { className: "flex gap-2 flex-wrap", children: media.map((m, i) => (_jsx("button", { type: "button", onClick: () => setLightboxIndex(i), className: "w-16 h-16 rounded-lg overflow-hidden bg-brand-mist border border-brand-mist hover:border-brand-purple/40 transition-colors", "aria-label": `View ${m.mediaType} ${i + 1}`, children: m.mediaType === 'image' ? (_jsx("img", { src: m.thumbnailUrl ?? m.url, alt: "", className: "w-full h-full object-cover" })) : (_jsx("div", { className: "w-full h-full flex items-center justify-center text-xl", children: "\uD83C\uDFA5" })) }, m.id))) })), _jsx(AIAnalysisPanel, { review: review }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm text-brand-charcoal/60", children: "Featured review" }), _jsxs(actionFetcher.Form, { method: "post", action: "/api/reviews/admin", children: [_jsx("input", { type: "hidden", name: "intent", value: "feature" }), _jsx("input", { type: "hidden", name: "reviewId", value: review.id }), _jsx("input", { type: "hidden", name: "isFeatured", value: review.isFeatured ? 'false' : 'true' }), _jsx("button", { type: "submit", className: [
                                                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                                                    review.isFeatured ? 'bg-brand-purple' : 'bg-brand-mist',
                                                ].join(' '), "aria-label": review.isFeatured ? 'Unfeature review' : 'Feature review', children: _jsx("span", { className: [
                                                        'inline-block w-3.5 h-3.5 rounded-full bg-white transition-transform shadow',
                                                        review.isFeatured ? 'translate-x-4' : 'translate-x-0.5',
                                                    ].join(' ') }) })] })] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("p", { className: "text-sm font-semibold text-brand-charcoal", style: { fontFamily: 'var(--font-display)' }, children: "Seller reply" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: handleAISuggest, disabled: aiSuggestFetcher.state !== 'idle', className: "text-xs text-brand-purple hover:text-brand-purple-light transition-colors disabled:opacity-50", children: aiSuggestFetcher.state !== 'idle' ? 'Generating...' : '✨ AI Suggest' }), !replyMode && (_jsx("button", { type: "button", onClick: () => setReplyMode(true), className: "text-xs text-brand-charcoal/50 hover:text-brand-charcoal transition-colors", children: review.replyBody ? 'Edit' : 'Add reply' }))] })] }), review.replyBody && !replyMode && (_jsx("div", { className: "bg-brand-mist rounded-xl p-3 text-sm text-brand-charcoal/80 italic", children: review.replyBody })), replyMode && (_jsxs("div", { className: "space-y-2", children: [_jsx("textarea", { value: reply, onChange: e => setReply(e.target.value), rows: 4, className: "w-full border border-brand-mist rounded-xl px-3 py-2 text-sm text-brand-charcoal focus:outline-none focus:border-brand-purple transition-colors resize-none", placeholder: "Write a warm, on-brand reply..." }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: handleReply, disabled: replyFetcher.state !== 'idle', className: "text-xs font-semibold bg-brand-gradient text-white px-4 py-1.5 rounded-full hover:opacity-90 transition-opacity disabled:opacity-50", children: replyFetcher.state !== 'idle' ? 'Saving...' : 'Save reply' }), _jsx("button", { type: "button", onClick: () => setReplyMode(false), className: "text-xs text-brand-charcoal/50 hover:text-brand-charcoal transition-colors", children: "Cancel" })] })] }))] })] }), _jsx("div", { className: "px-6 py-4 border-t border-brand-mist shrink-0", children: _jsxs("div", { className: "flex gap-2 flex-wrap", children: [review.status !== 'approved' && (_jsx("button", { type: "button", onClick: () => handleAction('approve'), disabled: isLoading, className: "flex-1 py-2 rounded-full text-sm font-semibold bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50", style: { fontFamily: 'var(--font-display)' }, children: "\u2713 Approve" })), review.status !== 'rejected' && (_jsx("button", { type: "button", onClick: () => handleAction('reject'), disabled: isLoading, className: "flex-1 py-2 rounded-full text-sm font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition-colors disabled:opacity-50", style: { fontFamily: 'var(--font-display)' }, children: "\u2715 Reject" })), review.status !== 'spam' && (_jsx("button", { type: "button", onClick: () => handleAction('spam'), disabled: isLoading, className: "py-2 px-4 rounded-full text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50", style: { fontFamily: 'var(--font-display)' }, children: "\u26A0 Spam" }))] }) })] }), lightboxIndex !== null && (_jsx(MediaLightbox, { media: media, initialIndex: lightboxIndex, onClose: () => setLightboxIndex(null) }))] }));
}
