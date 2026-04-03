import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { StarRating } from './StarRating';
import { MediaUploader } from './MediaUploader';
export function ReviewForm({ productId, inviteToken, reviewerName: prefillName = '', productTitle, isVerifiedPurchase, }) {
    const fetcher = useFetcher();
    const [rating, setRating] = useState(0);
    const [mediaFiles, setMediaFiles] = useState([]);
    const isSubmitting = fetcher.state !== 'idle';
    const errors = fetcher.data?.errors;
    // Show success state
    if (fetcher.data?.ok) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx("div", { className: "text-6xl mb-4 animate-bounce inline-block", "aria-hidden": "true", style: { color: '#7B2FBE' }, children: "\u2665" }), _jsx("h2", { className: "text-2xl font-bold text-brand-charcoal mb-2", style: { fontFamily: 'var(--font-display)' }, children: "Thank you!" }), _jsx("p", { className: "text-brand-charcoal/60", children: "Your review has been submitted and is pending approval." })] }));
    }
    const handleSubmit = async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const formData = new FormData(form);
        // Append rating (it's controlled, not a native input)
        formData.set('rating', String(rating));
        // Append media files
        mediaFiles.forEach((file, i) => {
            formData.append(`media_${i}`, file);
        });
        fetcher.submit(formData, {
            method: 'post',
            action: '/api/reviews',
            encType: 'multipart/form-data',
        });
    };
    return (_jsxs("div", { className: "max-w-lg mx-auto", children: [productTitle && (_jsx("p", { className: "text-sm text-brand-charcoal/50 mb-1", style: { fontFamily: 'var(--font-display)' }, children: "Reviewing" })), productTitle && (_jsx("h1", { className: "text-xl font-bold text-brand-charcoal mb-6", style: { fontFamily: 'var(--font-display)' }, children: productTitle })), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-5", children: [productId && _jsx("input", { type: "hidden", name: "shopifyProductId", value: productId }), inviteToken && _jsx("input", { type: "hidden", name: "inviteToken", value: inviteToken }), isVerifiedPurchase && _jsx("input", { type: "hidden", name: "isVerifiedPurchase", value: "true" }), _jsx("input", { type: "text", name: "website", className: "hidden", tabIndex: -1, "aria-hidden": "true", autoComplete: "off" }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-semibold text-brand-charcoal mb-2", style: { fontFamily: 'var(--font-display)' }, children: ["Your rating ", _jsx("span", { className: "text-brand-coral", children: "*" })] }), _jsx(StarRating, { value: rating, onChange: setRating, size: "lg" }), errors?.rating && (_jsx("p", { className: "text-xs text-red-500 mt-1", children: errors.rating }))] }), _jsxs("div", { children: [_jsxs("label", { htmlFor: "reviewerName", className: "block text-sm font-semibold text-brand-charcoal mb-1.5", style: { fontFamily: 'var(--font-display)' }, children: ["Your name ", _jsx("span", { className: "text-brand-coral", children: "*" })] }), _jsx("input", { id: "reviewerName", name: "reviewerName", type: "text", required: true, defaultValue: prefillName, placeholder: "Jane D.", className: "w-full border border-brand-mist rounded-xl px-4 py-2.5 text-sm text-brand-charcoal focus:outline-none focus:border-brand-purple transition-colors" }), errors?.reviewerName && (_jsx("p", { className: "text-xs text-red-500 mt-1", children: errors.reviewerName }))] }), _jsxs("div", { children: [_jsxs("label", { htmlFor: "reviewerEmail", className: "block text-sm font-semibold text-brand-charcoal mb-1.5", style: { fontFamily: 'var(--font-display)' }, children: ["Email ", _jsx("span", { className: "text-brand-coral", children: "*" }), _jsx("span", { className: "text-brand-charcoal/40 font-normal ml-1", children: "(not published)" })] }), _jsx("input", { id: "reviewerEmail", name: "reviewerEmail", type: "email", required: true, placeholder: "you@example.com", className: "w-full border border-brand-mist rounded-xl px-4 py-2.5 text-sm text-brand-charcoal focus:outline-none focus:border-brand-purple transition-colors" }), errors?.reviewerEmail && (_jsx("p", { className: "text-xs text-red-500 mt-1", children: errors.reviewerEmail }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "title", className: "block text-sm font-semibold text-brand-charcoal mb-1.5", style: { fontFamily: 'var(--font-display)' }, children: "Review title" }), _jsx("input", { id: "title", name: "title", type: "text", placeholder: "One great sentence...", maxLength: 150, className: "w-full border border-brand-mist rounded-xl px-4 py-2.5 text-sm text-brand-charcoal focus:outline-none focus:border-brand-purple transition-colors" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "body", className: "block text-sm font-semibold text-brand-charcoal mb-1.5", style: { fontFamily: 'var(--font-display)' }, children: "Your review" }), _jsx("textarea", { id: "body", name: "body", rows: 5, placeholder: "Tell us what you thought \u2014 the good, the great, and anything you'd change...", className: "w-full border border-brand-mist rounded-xl px-4 py-2.5 text-sm text-brand-charcoal focus:outline-none focus:border-brand-purple transition-colors resize-none" }), errors?.body && (_jsx("p", { className: "text-xs text-red-500 mt-1", children: errors.body }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-semibold text-brand-charcoal mb-1.5", style: { fontFamily: 'var(--font-display)' }, children: "Add photos or video" }), _jsx(MediaUploader, { onChange: setMediaFiles, maxFiles: 5, maxMb: 10 })] }), errors?.general && (_jsx("p", { className: "text-sm text-red-500", children: errors.general })), _jsx("button", { type: "submit", disabled: isSubmitting || rating === 0, className: "w-full py-3.5 rounded-full font-bold bg-brand-gradient text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-brand-coral/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed", style: { fontFamily: 'var(--font-display)' }, children: isSubmitting ? 'Submitting...' : 'Submit Review ♥' }), _jsx("p", { className: "text-xs text-brand-charcoal/40 text-center", children: "Reviews are moderated and may take 24 hours to appear." })] })] }));
}
