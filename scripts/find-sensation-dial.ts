const domain = process.env['SHOPIFY_STORE_DOMAIN']
const token  = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']
const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token! },
  body: JSON.stringify({ query: `{ products(first: 100) { edges { node { handle title metafield(namespace:"xdipx", key:"sensation_dial"){ value } } } } }` }),
})
const json: any = await res.json()
if (!res.ok || json.errors) { console.error(json); process.exit(1) }
const withDial = json.data.products.edges.filter((e: any) => e.node.metafield?.value)
console.log('products with sensation_dial:', withDial.length, '/', json.data.products.edges.length)
for (const e of withDial) console.log('  -', e.node.handle, '→', (e.node.metafield.value as string).slice(0, 120))
