import { describe, it, expect } from 'vitest'
import { parseBulkImportCSV } from './bulk-import.server'

// 36-column header matching BulkImportRow exactly (cols 0–35):
// 0:SKU 1:Master SKU 2:Variant Option Name 3:Variant Option Value
// 4:Variant Option Name 2 5:Variant Option Value 2
// 6:Product Title 7:Brand 8:Product Description 9:Sub-Category
// 10:MSRP 11:Wholesale 12:MAP 13:Total qty available
// 14-23:Image 1–10  24:UPC/barcode 25:Nalpac qty 26:Entrenue qty
// 27:Fluid Oz 28:Material 29:Color 30:Main Category 31:Size
// 32:Nav Category 33:Nav Path 34:Collections 35:MPN
const HEADER =
  'SKU,Master SKU,Variant Option Name,Variant Option Value,' +
  'Variant Option Name 2,Variant Option Value 2,' +
  'Product Title,Brand,Product Description,Sub-Category,' +
  'MSRP,Wholesale,MAP,Total qty available,' +
  'Image 1,Image 2,Image 3,Image 4,Image 5,Image 6,Image 7,Image 8,Image 9,Image 10,' +
  'UPC/barcode,Nalpac qty available,Entrenue qty available,' +
  'Fluid Oz,Material,Color,Main Category,Size,' +
  'Nav Category,Nav Path,Collections,MPN'

// Build a 36-value data row. Provide only the fields you care about;
// the rest are filled with empty strings so the column count is exact.
function row(fields: Partial<Record<string, string>>): string {
  const cols = HEADER.split(',')
  return cols.map(c => fields[c] ?? '').join(',')
}

function csv(...dataRows: string[]): string {
  return [HEADER, ...dataRows].join('\n')
}

describe('parseBulkImportCSV', () => {
  it('parses a single-axis variant group', () => {
    const input = csv(
      row({ SKU: 'SONA-S', 'Variant Option Name': 'Size', 'Variant Option Value': 'Small', 'Product Title': 'Lelo Sona', Brand: 'Lelo', 'Product Description': 'Description', 'Sub-Category': 'Air Pulse and Suction', MSRP: '129.00', Wholesale: '45.00', MAP: '119.00', 'Total qty available': '42', 'Image 1': 'https://img.example/1.jpg' }),
      row({ SKU: 'SONA-M', 'Master SKU': 'SONA-S', 'Variant Option Name': 'Size', 'Variant Option Value': 'Medium', MSRP: '139.00', Wholesale: '48.00', MAP: '129.00', 'Total qty available': '35', 'Image 1': 'https://img.example/2.jpg' }),
      row({ SKU: 'SONA-L', 'Master SKU': 'SONA-S', 'Variant Option Name': 'Size', 'Variant Option Value': 'Large', MSRP: '149.00', Wholesale: '52.00', MAP: '139.00', 'Total qty available': '28', 'Image 1': 'https://img.example/3.jpg' }),
    )
    const { groups, parseErrors } = parseBulkImportCSV(input)
    expect(parseErrors).toHaveLength(0)
    expect(groups).toHaveLength(1)
    const g = groups[0]!
    expect(g.isSingleVariant).toBe(false)
    expect(g.variants).toHaveLength(3)
    for (const v of g.variants) {
      expect(v.optionValues).toHaveLength(1)
    }
    expect(g.variants[0]!.optionValues[0]).toBe('Small')
    expect(g.variants[1]!.optionValues[0]).toBe('Medium')
    expect(g.variants[2]!.optionValues[0]).toBe('Large')
  })

  it('parses a two-axis group (size × color) producing correct optionValues pairs', () => {
    const base = { 'Product Title': 'Bloom Curve', Brand: 'Acme', 'Product Description': 'Desc', 'Sub-Category': 'Air Pulse and Suction' }
    const input = csv(
      row({ SKU: 'BLOOM-S-RD', 'Variant Option Name': 'Size', 'Variant Option Value': 'Small', 'Variant Option Name 2': 'Color', 'Variant Option Value 2': 'Red', ...base, MSRP: '99.00', Wholesale: '35.00', MAP: '0', 'Total qty available': '20', 'Image 1': 'https://img/1.jpg' }),
      row({ SKU: 'BLOOM-S-BK', 'Master SKU': 'BLOOM-S-RD', 'Variant Option Name': 'Size', 'Variant Option Value': 'Small', 'Variant Option Name 2': 'Color', 'Variant Option Value 2': 'Black', MSRP: '99.00', Wholesale: '35.00', MAP: '0', 'Total qty available': '15', 'Image 1': 'https://img/2.jpg' }),
      row({ SKU: 'BLOOM-M-RD', 'Master SKU': 'BLOOM-S-RD', 'Variant Option Name': 'Size', 'Variant Option Value': 'Medium', 'Variant Option Name 2': 'Color', 'Variant Option Value 2': 'Red', MSRP: '109.00', Wholesale: '38.00', MAP: '0', 'Total qty available': '18', 'Image 1': 'https://img/3.jpg' }),
      row({ SKU: 'BLOOM-M-BK', 'Master SKU': 'BLOOM-S-RD', 'Variant Option Name': 'Size', 'Variant Option Value': 'Medium', 'Variant Option Name 2': 'Color', 'Variant Option Value 2': 'Black', MSRP: '109.00', Wholesale: '38.00', MAP: '0', 'Total qty available': '12', 'Image 1': 'https://img/4.jpg' }),
    )
    const { groups, parseErrors } = parseBulkImportCSV(input)
    expect(parseErrors).toHaveLength(0)
    expect(groups).toHaveLength(1)
    const g = groups[0]!
    expect(g.variants).toHaveLength(4)
    for (const v of g.variants) {
      expect(v.optionValues).toHaveLength(2)
    }
    expect(g.variants[0]!.optionValues).toEqual(['Small', 'Red'])
    expect(g.variants[1]!.optionValues).toEqual(['Small', 'Black'])
    expect(g.variants[2]!.optionValues).toEqual(['Medium', 'Red'])
    expect(g.variants[3]!.optionValues).toEqual(['Medium', 'Black'])
  })

  it('rejects a group with mismatched Variant Option Name 2 across rows', () => {
    const base = { 'Product Title': 'Widget', Brand: 'Brand', 'Product Description': 'Desc', 'Sub-Category': 'Air Pulse and Suction', MSRP: '99.00', Wholesale: '35.00', MAP: '0', 'Total qty available': '10' }
    const input = csv(
      row({ SKU: 'PROD-A', 'Variant Option Name': 'Size', 'Variant Option Value': 'Small', 'Variant Option Name 2': 'Color', 'Variant Option Value 2': 'Red', ...base }),
      row({ SKU: 'PROD-B', 'Master SKU': 'PROD-A', 'Variant Option Name': 'Size', 'Variant Option Value': 'Medium', 'Variant Option Name 2': 'Shade', 'Variant Option Value 2': 'Blue', ...base }),
    )
    const { groups, parseErrors } = parseBulkImportCSV(input)
    expect(groups).toHaveLength(0)
    expect(parseErrors).toHaveLength(1)
    expect(parseErrors[0]!.sku).toBe('PROD-A')
    expect(parseErrors[0]!.message).toMatch(/Inconsistent Variant Option Name 2/)
  })

  it('rejects a group where some rows have Value 2 and others do not', () => {
    const base = { 'Product Title': 'Widget', Brand: 'Brand', 'Product Description': 'Desc', 'Sub-Category': 'Air Pulse and Suction', MSRP: '99.00', Wholesale: '35.00', MAP: '0', 'Total qty available': '10' }
    const input = csv(
      row({ SKU: 'PROD-C', 'Variant Option Name': 'Size', 'Variant Option Value': 'Small', 'Variant Option Name 2': 'Color', 'Variant Option Value 2': 'Red', ...base }),
      // Child is missing Value 2 even though Name 2 matches
      row({ SKU: 'PROD-D', 'Master SKU': 'PROD-C', 'Variant Option Name': 'Size', 'Variant Option Value': 'Medium', 'Variant Option Name 2': 'Color', 'Variant Option Value 2': '', ...base }),
    )
    const { groups, parseErrors } = parseBulkImportCSV(input)
    expect(groups).toHaveLength(0)
    expect(parseErrors.length).toBeGreaterThan(0)
    expect(parseErrors[0]!.sku).toBe('PROD-C')
    expect(parseErrors[0]!.message).toMatch(/PROD-D/)
  })

  it('parses a standalone product (no variants, both value columns blank)', () => {
    const input = csv(
      row({ SKU: 'DOXY-01', 'Product Title': 'Doxy Wand', Brand: 'Doxy', 'Product Description': 'Great massager', 'Sub-Category': 'Air Pulse and Suction', MSRP: '149.99', Wholesale: '52.00', MAP: '0', 'Total qty available': '87', 'Image 1': 'https://img/doxy.jpg' }),
    )
    const { groups, parseErrors } = parseBulkImportCSV(input)
    expect(parseErrors).toHaveLength(0)
    expect(groups).toHaveLength(1)
    const g = groups[0]!
    expect(g.isSingleVariant).toBe(true)
    expect(g.variants).toHaveLength(0)
  })

  it('trims leading/trailing whitespace from option values', () => {
    const base = { 'Product Title': 'Trim Test', Brand: 'Brand', 'Product Description': 'Desc', 'Sub-Category': 'Air Pulse and Suction', MSRP: '99.00', Wholesale: '35.00', MAP: '0', 'Total qty available': '10' }
    const input = csv(
      row({ SKU: 'TRIM-S', 'Variant Option Name': 'Size', 'Variant Option Value': ' Small ', ...base }),
      row({ SKU: 'TRIM-M', 'Master SKU': 'TRIM-S', 'Variant Option Name': 'Size', 'Variant Option Value': ' Medium ', ...base }),
    )
    const { groups, parseErrors } = parseBulkImportCSV(input)
    expect(parseErrors).toHaveLength(0)
    const g = groups[0]!
    // csv-parse trim:true strips leading/trailing spaces from cell values
    expect(g.variants[0]!.optionValues[0]).toBe('Small')
    expect(g.variants[1]!.optionValues[0]).toBe('Medium')
  })
})
