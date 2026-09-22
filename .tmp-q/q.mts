import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL!)
console.log(JSON.stringify(await sql(process.argv[2]), null, 1))
