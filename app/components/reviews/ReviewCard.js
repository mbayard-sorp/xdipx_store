import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { StarRating } from './StarRating';
import { HelpfulVote } from './HelpfulVote';
import { SellerReply } from './SellerReply';
import { MediaLightbox } from './MediaLightbox';
const TRUNCATE_AT = 300;
function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    if (days < 1)
        return 'today';
    if (days < 7)
        return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (weeks < 5)
        return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
    if (months < 12)
        return `${months} month${months !== 1 ? 's' : ''} ago`;
    return `over a year ago`;
}
function initials(name) {
    return name.split(' ').map(p => p[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}
export function ReviewCard({ review, showAiSummary = true }) {
    const [expanded, setExpanded] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(null);
    const body = review.body ?? '';
    const needsTruncation = body.length > TRUNCATE_AT;
    const displayBody = needsTruncation && !expanded ? body.slice(0, TRUNCATE_AT) + '…' : body;
    const media = review.media ?? [];
    return (_jsxs("article", { className: "bg-white rounded-xl border border-brand-mist p-5", children: [_jsxs("div", { className: "flex items-start gap-3 mb-3", children: [_jsx("div", { className: "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0", style: { background: '#7B2FBE', fontFamily: 'var(--font-display)' }, "aria-hidden": "true", children: initials(review.reviewerName) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-semibold text-sm text-brand-charcoal", style: { fontFamily: 'var(--font-display)' }, children: review.reviewerName }), review.isVerifiedPurchase && (_jsx("span", { className: "inline-flex items-center gap-0.5 bg-green-50 text-green-700 text-[10px] font-medium px-2 py-0.5 rounded-full", children: "\u2713 Verified" })), review.isIncentivized && (_jsx("span", { className: "inline-flex items-center bg-amber-50 text-amber-700 text-[10px] font-medium px-2 py-0.5 rounded-full", children: "Incentivized" }))] }), _jsxs("div", { className: "flex items-center gap-2 mt-0.5", children: [_jsx(StarRating, { value: review.rating, readonly: true, size: "sm" }), _jsx("span", { className: "text-xs text-brand-charcoal/40", children: relativeTime(review.createdAt) })] })] })] }), review.title && (_jsx("h3", { className: "font-semibold text-brand-charcoal mb-1.5 text-sm", style: { fontFamily: 'var(--font-display)' }, children: review.title })), body && (_jsxs("div", { className: "text-sm text-brand-charcoal/80 leading-relaxed", children: [_jsx("p", { children: displayBody }), needsTruncation && (_jsx("button", { onClick: () => setExpanded(e => !e), className: "text-brand-purple text-xs font-medium mt-1 hover:underline", children: expanded ? 'Read less' : 'Read more' }))] })), showAiSummary && review.aiSummary && (_jsx("p", { className: "text-xs text-brand-charcoal/50 italic mt-2 pl-3 border-l-2 border-brand-mist", children: review.aiSummary })), media.length > 0 && (_jsx("div", { className: "flex gap-2 mt-3 flex-wrap", children: media.map((m, i) => (_jsx("button", { type: "button", onClick: () => setLightboxIndex(i), className: "w-14 h-14 rounded-lg overflow-hidden bg-brand-mist border border-brand-mist hover:border-brand-purple/40 transition-colors", "aria-label": `View ${m.mediaType} ${i + 1}`, children: m.mediaType === 'image' ? (_jsx("img", { src: m.thumbnailUrl ?? m.url, alt: "", className: "w-full h-full object-cover" })) : (_jsx("div", { className: "w-full h-full flex items-center justify-center text-xl", children: "\uD83C\uDFA5" })) }, m.id))) })), _jsx(HelpfulVote, { reviewId: review.id, helpfulYes: review.helpfulYes, helpfulNo: review.helpfulNo }), review.replyBody && review.replyAt && (_jsx(SellerReply, { replyBody: review.replyBody, replyAt: review.replyAt })), lightboxIndex !== null && (_jsx(MediaLightbox, { media: media, initialIndex: lightboxIndex, onClose: () => setLightboxIndex(null) }))] }));
}
