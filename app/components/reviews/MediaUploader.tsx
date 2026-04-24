import { useState, useRef, useCallback } from 'react'

interface MediaUploaderProps {
  onChange: (files: File[]) => void
  maxFiles?: number
  maxMb?: number
}

export function MediaUploader({ onChange, maxFiles = 5, maxMb = 10 }: MediaUploaderProps) {
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return
    setError(null)

    const newFiles = Array.from(incoming).filter(f => {
      if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
        setError('Only images and videos are allowed.')
        return false
      }
      if (f.size > maxMb * 1024 * 1024) {
        setError(`Files must be under ${maxMb}MB.`)
        return false
      }
      return true
    })

    const combined = [...files, ...newFiles].slice(0, maxFiles)
    setFiles(combined)
    onChange(combined)

    // Generate previews for images
    const newPreviews: string[] = [...previews]
    newFiles.forEach(f => {
      if (f.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = e => {
          newPreviews.push(e.target?.result as string)
          setPreviews([...newPreviews])
        }
        reader.readAsDataURL(f)
      } else {
        newPreviews.push('')
        setPreviews([...newPreviews])
      }
    })
  }, [files, previews, maxFiles, maxMb, onChange])

  const removeFile = (i: number) => {
    const updated = files.filter((_, idx) => idx !== i)
    const updatedPreviews = previews.filter((_, idx) => idx !== i)
    setFiles(updated)
    setPreviews(updatedPreviews)
    onChange(updated)
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={[
          'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragging
            ? 'border-sage bg-cream-2'
            : 'border-cream-2 hover:border-sage/50',
        ].join(' ')}
        role="button"
        tabIndex={0}
        aria-label={`Upload up to ${maxFiles} photos or videos`}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      >
        <span className="text-2xl block mb-1" aria-hidden="true">📷</span>
        <p className="text-sm text-ink/60">
          Drag photos/videos or <span className="text-sage font-medium">tap to select</span>
        </p>
        <p className="text-xs text-ink/40 mt-1">
          {files.length}/{maxFiles} • Max {maxMb}MB each
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        multiple
        accept="image/*,video/*"
        onChange={e => addFiles(e.target.files)}
        aria-label="Upload files"
      />

      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}

      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {previews.map((preview, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden bg-cream-2">
              {preview ? (
                <img src={preview} alt={`Upload ${i + 1}`} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl">🎥</div>
              )}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); removeFile(i) }}
                className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white text-[10px] rounded-full flex items-center justify-center hover:bg-black/80"
                aria-label={`Remove file ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
