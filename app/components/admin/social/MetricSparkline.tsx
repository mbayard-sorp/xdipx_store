/**
 * A dependency-free SVG sparkline for the analytics instrument band. Declares
 * its width and height so the band never shifts while it paints, and carries
 * an aria-label naming the first and last values so the trend is readable
 * without the picture.
 */
export interface SparkPoint { at: string; value: number }

export function MetricSparkline({
  points,
  width = 160,
  height = 40,
  label,
  className = '',
}: {
  points: SparkPoint[]
  width?: number
  height?: number
  label: string
  className?: string
}) {
  const pad = 3
  const n = points.length
  const first = points[0]
  const last = points[n - 1]
  const aria = n
    ? `${label}: ${first!.value.toLocaleString()} at start, ${last!.value.toLocaleString()} at end, ${n} reading${n === 1 ? '' : 's'}`
    : `${label}: no readings yet`

  let path = ''
  let dot: { x: number; y: number } | null = null
  if (n >= 1) {
    const values = points.map(p => p.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const stepX = n > 1 ? (width - pad * 2) / (n - 1) : 0
    const coords = values.map((v, i) => ({
      x: pad + (n > 1 ? i * stepX : (width - pad * 2) / 2),
      y: pad + (height - pad * 2) * (1 - (v - min) / span),
    }))
    path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
    dot = coords[n - 1] ?? null
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={aria}
      className={`block shrink-0 ${className}`}
    >
      {n === 0 ? (
        <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />
      ) : (
        <>
          <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          {dot && <circle cx={dot.x} cy={dot.y} r={2.5} fill="currentColor" />}
        </>
      )}
    </svg>
  )
}
