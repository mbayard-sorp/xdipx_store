/**
 * Custom Sanity Studio input component for AI-powered image generation.
 * Wraps the default image field and adds an inline generation panel below it.
 * Calls /api/generate-image-studio on the main xdipx app.
 *
 * Required env vars (set in studio/.env):
 *   SANITY_STUDIO_API_SECRET  — must match STUDIO_API_SECRET in root .env
 *   SANITY_STUDIO_APP_URL     — URL of the main app (default: http://localhost:3000)
 */
import { useState } from 'react'
import { set, useClient, useFormValue } from 'sanity'
import {
  Box,
  Stack,
  Button,
  Text,
  TextInput,
  Spinner,
  Card,
  Flex,
  Badge,
  Select,
  Label,
} from '@sanity/ui'

const APP_URL    = process.env.SANITY_STUDIO_APP_URL    ?? 'http://localhost:3000'
const API_SECRET = process.env.SANITY_STUDIO_API_SECRET ?? ''

export function ImageGeneratorInput(props) {
  const client = useClient({ apiVersion: '2024-01-01' })

  // Read the sibling imagePrompt field from the same form path (works for both
  // document-level and nested block usage)
  const parentPath   = props.path.slice(0, -1)
  const savedPrompt  = useFormValue([...parentPath, 'imagePrompt']) ?? ''

  const [panelOpen,    setPanelOpen]    = useState(false)
  const [prompt,       setPrompt]       = useState('')
  const [aspectRatio,  setAspectRatio]  = useState('1:1')
  const [status,       setStatus]       = useState('idle')  // idle | loading | results | error | success
  const [images,       setImages]       = useState([])
  const [selectedIdx,  setSelectedIdx]  = useState(null)
  const [errorMsg,     setErrorMsg]     = useState(null)
  const [hoverIdx,     setHoverIdx]     = useState(null)
  const [uploading,    setUploading]    = useState(false)

  function openPanel() {
    setPrompt(savedPrompt || '')
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    setImages([])
    setSelectedIdx(null)
    setErrorMsg(null)
    setStatus('idle')
  }

  async function generate() {
    if (!prompt.trim()) return
    setStatus('loading')
    setErrorMsg(null)
    setImages([])
    setSelectedIdx(null)

    try {
      const res = await fetch(`${APP_URL}/api/generate-image-studio`, {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'x-studio-secret': API_SECRET,
        },
        body:   JSON.stringify({ prompt: prompt.trim(), count: 4, aspectRatio }),
        signal: AbortSignal.timeout(55_000),
      })

      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error ?? `Error ${res.status}`)
        setStatus('error')
        return
      }

      setImages(data.images ?? [])
      setStatus('results')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(`${msg} — calling ${APP_URL}/api/generate-image-studio (secret ${API_SECRET ? 'set' : 'MISSING'})`)
      setStatus('error')
    }
  }

  async function useSelected() {
    if (selectedIdx === null || !images[selectedIdx]) return
    setUploading(true)

    try {
      const { base64, mimeType } = images[selectedIdx]
      const byteChars = atob(base64)
      const byteArray = new Uint8Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i)
      }
      const blob  = new Blob([byteArray], { type: mimeType || 'image/jpeg' })
      const asset = await client.assets.upload('image', blob, {
        filename:    `ai-generated-${Date.now()}.jpg`,
        contentType: mimeType || 'image/jpeg',
      })

      props.onChange(
        set({
          _type:  'image',
          asset:  { _type: 'reference', _ref: asset._id },
        }),
      )

      setStatus('success')
      setTimeout(() => closePanel(), 2000)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Stack space={3}>
      {/* Default image field — all standard behaviour preserved */}
      {props.renderDefault(props)}

      {/* Toggle button */}
      {!panelOpen && (
        <Box>
          <Button
            mode="ghost"
            tone="default"
            text="✦ Generate with AI"
            onClick={openPanel}
            style={{ fontSize: 13 }}
          />
        </Box>
      )}

      {/* Generation panel */}
      {panelOpen && (
        <Card padding={4} radius={2} shadow={1} tone="default">
          <Stack space={4}>
            {/* Prompt input row */}
            <Stack space={2}>
              <Text size={1} weight="semibold">Image prompt</Text>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe the image — style, lighting, mood, colours…"
                disabled={status === 'loading' || uploading}
                rows={4}
                style={{
                  width:        '100%',
                  padding:      '8px 12px',
                  borderRadius: '3px',
                  border:       '1px solid var(--card-border-color)',
                  background:   'var(--card-bg-color)',
                  color:        'var(--card-fg-color)',
                  fontSize:     '14px',
                  lineHeight:   '1.5',
                  resize:       'vertical',
                  fontFamily:   'inherit',
                  boxSizing:    'border-box',
                }}
              />
              <Text size={1} muted>10–20 seconds · powered by Google Imagen</Text>
            </Stack>

            {/* Aspect ratio */}
            <Stack space={2}>
              <Label size={1}>Aspect ratio</Label>
              <Select
                value={aspectRatio}
                onChange={e => setAspectRatio(e.currentTarget.value)}
                disabled={status === 'loading' || uploading}
              >
                <option value="1:1">1:1 — Square</option>
                <option value="4:3">4:3 — Landscape</option>
                <option value="3:4">3:4 — Portrait</option>
                <option value="16:9">16:9 — Widescreen</option>
                <option value="9:16">9:16 — Story / Vertical</option>
              </Select>
            </Stack>

            {/* Generate button */}
            {(status === 'idle' || status === 'results') && (
              <Flex gap={2} wrap="wrap">
                <Button
                  tone="primary"
                  text={status === 'results' ? 'Regenerate' : 'Generate 4 images'}
                  onClick={generate}
                  disabled={!prompt.trim()}
                />
                <Button
                  mode="ghost"
                  text="Cancel"
                  onClick={closePanel}
                />
              </Flex>
            )}

            {/* Loading */}
            {status === 'loading' && (
              <Flex align="center" gap={3}>
                <Spinner muted />
                <Text size={1} muted>Generating images…</Text>
              </Flex>
            )}

            {/* Error */}
            {status === 'error' && (
              <Stack space={3}>
                <Card tone="critical" padding={3} radius={2}>
                  <Text size={1}>{errorMsg}</Text>
                </Card>
                <Flex gap={2}>
                  <Button mode="ghost" text="Try again" onClick={generate} />
                  <Button mode="ghost" text="Dismiss"   onClick={closePanel} />
                </Flex>
              </Stack>
            )}

            {/* Results grid */}
            {status === 'results' && images.length > 0 && (
              <Stack space={3}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {images.map((img, idx) => (
                    <img
                      key={idx}
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={`Generated option ${idx + 1}`}
                      onClick={() => setSelectedIdx(idx)}
                      onMouseEnter={() => setHoverIdx(idx)}
                      onMouseLeave={() => setHoverIdx(null)}
                      style={{
                        width:        '100%',
                        aspectRatio:  '1',
                        objectFit:    'cover',
                        cursor:       'pointer',
                        borderRadius: '4px',
                        opacity:      hoverIdx === idx ? 0.85 : 1,
                        border:       selectedIdx === idx
                          ? '2px solid #E8593C'
                          : '2px solid transparent',
                        transition:   'opacity 0.15s, border-color 0.15s',
                      }}
                    />
                  ))}
                </div>

                <Flex gap={2} wrap="wrap">
                  <Button
                    tone="primary"
                    text={uploading ? undefined : 'Use this image'}
                    icon={uploading ? () => <Spinner /> : undefined}
                    disabled={selectedIdx === null || uploading}
                    onClick={useSelected}
                  />
                  <Button
                    mode="ghost"
                    text="Regenerate"
                    disabled={uploading}
                    onClick={generate}
                  />
                  <Button
                    mode="ghost"
                    text="Cancel"
                    disabled={uploading}
                    onClick={closePanel}
                  />
                </Flex>
              </Stack>
            )}

            {/* Success */}
            {status === 'success' && (
              <Box>
                <Badge tone="positive" mode="outline">Image set!</Badge>
              </Box>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  )
}
