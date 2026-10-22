import type { Position } from '../types'

/** Companies with a position whose value moved, that appeared, or that is gone, between two reads. */
export function changedCompanies(before: Position[], after: Position[]): string[] {
  const was = new Map(before.map(([key, , value]) => [key, String(value)]))
  const now = new Set(after.map(([key]) => key))
  const companies = new Set<string>()
  for (const [key, company, value] of after) if (was.get(key) !== String(value)) companies.add(company)
  for (const [key, company] of before) if (!now.has(key)) companies.add(company)
  return [...companies]
}

/** A company's value summed over its positions (one per fund and asset group); 0 once exited. */
export function companyValue(positions: Position[], company: string): number {
  return positions.filter(([, name]) => name === company).reduce((sum, [, , value]) => sum + Number(value), 0)
}
