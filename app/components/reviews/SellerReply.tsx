interface SellerReplyProps {
  replyBody: string
  replyAt: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  const weeks = Math.floor(days  / 7)
  const months= Math.floor(days  / 30)
  if (mins  < 2)  return 'just now'
  if (mins  < 60) return `${mins} minutes ago`
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  if (days  < 7)  return `${days} day${days !== 1 ? 's' : ''} ago`
  if (weeks < 5)  return `${weeks} week${weeks !== 1 ? 's' : ''} ago`
  return `${months} month${months !== 1 ? 's' : ''} ago`
}

export function SellerReply({ replyBody, replyAt }: SellerReplyProps) {
  return (
    <div className="ml-4 mt-3 bg-cream-2 rounded-xl px-4 py-3 border-l-4 border-sage">
      <p
        className="text-xs font-semibold text-sage mb-1"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Response from xdipx ♥
      </p>
      <p className="text-sm text-ink/80 leading-relaxed">{replyBody}</p>
      <p className="text-xs text-ink/40 mt-1">{relativeTime(replyAt)}</p>
    </div>
  )
}
