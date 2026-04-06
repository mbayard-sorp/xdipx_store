import 'dotenv/config'
import { getSiteSettings } from '../app/lib/sanity.server.ts'

const s = await getSiteSettings()
console.log(JSON.stringify(s, null, 2))
