import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef, useCallback } from 'react';
export function MediaUploader({ onChange, maxFiles = 5, maxMb = 10 }) {
    const [files, setFiles] = useState([]);
    const [previews, setPreviews] = useState([]);
    const [error, setError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef(null);
    const addFiles = useCallback((incoming) => {
        if (!incoming)
            return;
        setError(null);
        const newFiles = Array.from(incoming).filter(f => {
            if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
                setError('Only images and videos are allowed.');
                return false;
            }
            if (f.size > maxMb * 1024 * 1024) {
                setError(`Files must be under ${maxMb}MB.`);
                return false;
            }
            return true;
        });
        const combined = [...files, ...newFiles].slice(0, maxFiles);
        setFiles(combined);
        onChange(combined);
        // Generate previews for images
        const newPreviews = [...previews];
        newFiles.forEach(f => {
            if (f.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = e => {
                    newPreviews.push(e.target?.result);
                    setPreviews([...newPreviews]);
                };
                reader.readAsDataURL(f);
            }
            else {
                newPreviews.push('');
                setPreviews([...newPreviews]);
            }
        });
    }, [files, previews, maxFiles, maxMb, onChange]);
    const removeFile = (i) => {
        const updated = files.filter((_, idx) => idx !== i);
        const updatedPreviews = previews.filter((_, idx) => idx !== i);
        setFiles(updated);
        setPreviews(updatedPreviews);
        onChange(updated);
    };
    return (_jsxs("div", { children: [_jsxs("div", { onDragOver: e => { e.preventDefault(); setIsDragging(true); }, onDragLeave: () => setIsDragging(false), onDrop: e => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }, onClick: () => inputRef.current?.click(), className: [
                    'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                    isDragging
                        ? 'border-brand-purple bg-brand-mist'
                        : 'border-brand-mist hover:border-brand-purple/50',
                ].join(' '), role: "button", tabIndex: 0, "aria-label": `Upload up to ${maxFiles} photos or videos`, onKeyDown: e => e.key === 'Enter' && inputRef.current?.click(), children: [_jsx("span", { className: "text-2xl block mb-1", "aria-hidden": "true", children: "\uD83D\uDCF7" }), _jsxs("p", { className: "text-sm text-brand-charcoal/60", children: ["Drag photos/videos or ", _jsx("span", { className: "text-brand-purple font-medium", children: "tap to select" })] }), _jsxs("p", { className: "text-xs text-brand-charcoal/40 mt-1", children: [files.length, "/", maxFiles, " \u2022 Max ", maxMb, "MB each"] })] }), _jsx("input", { ref: inputRef, type: "file", className: "sr-only", multiple: true, accept: "image/*,video/*", onChange: e => addFiles(e.target.files), "aria-label": "Upload files" }), error && (_jsx("p", { className: "text-xs text-red-500 mt-1", children: error })), previews.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-2 mt-3", children: previews.map((preview, i) => (_jsxs("div", { className: "relative w-16 h-16 rounded-lg overflow-hidden bg-brand-mist", children: [preview ? (_jsx("img", { src: preview, alt: `Upload ${i + 1}`, className: "w-full h-full object-cover" })) : (_jsx("div", { className: "w-full h-full flex items-center justify-center text-xl", children: "\uD83C\uDFA5" })), _jsx("button", { type: "button", onClick: e => { e.stopPropagation(); removeFile(i); }, className: "absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white text-[10px] rounded-full flex items-center justify-center hover:bg-black/80", "aria-label": `Remove file ${i + 1}`, children: "\u00D7" })] }, i))) }))] }));
}
