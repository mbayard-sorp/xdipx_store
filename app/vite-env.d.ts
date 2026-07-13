/// <reference types="vite/client" />

// Vendored OG-card fonts imported as data URIs (Vite `?inline` asset suffix).
declare module '*.ttf?inline' {
  const dataUri: string
  export default dataUri
}
