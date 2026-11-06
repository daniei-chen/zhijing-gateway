import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

describe('the installed spreadsheet export implementation', () => {
  it('round-trips paginated rows, Unicode, zero values and fixed-precision amounts', () => {
    const rows = [['中文账户', 0, '0.000001', '2026-11-05T00:00:00Z'], ['另一个账户', 12345, '10.120000', '2026-11-05T01:00:00Z']]
    const worksheet = XLSX.utils.aoa_to_sheet([['账户', 'Tokens', 'Cost', 'Time']])
    for (const row of rows) XLSX.utils.sheet_add_aoa(worksheet, [row], { origin: -1 })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Usage')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const restored = XLSX.read(bytes, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(restored.Sheets.Usage, { header: 1 })).toEqual([
      ['账户', 'Tokens', 'Cost', 'Time'], ...rows,
    ])
  })

  it('keeps untrusted formula-like account names as string cells in the exported workbook', () => {
    const names = ['=1+1', '+SUM(1,2)', '-1+1', '@SUM(1,2)', '\t=1+1']
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(names.map(name => [name])), 'Usage')
    const restored = XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }), { type: 'array' })
    names.forEach((value, index) => {
      const cell = restored.Sheets.Usage[`A${index + 1}`]
      expect(cell.t).toBe('s')
      expect(cell.v).toBe(value)
      expect(cell.f).toBeUndefined()
    })
  })
})
