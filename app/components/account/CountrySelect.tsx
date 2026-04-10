import type { Country } from '~/lib/shopify.server'
import { inputClass } from './FieldGroup'

interface CountrySelectProps {
  id?: string
  name?: string
  value: string
  onChange: (isoCode: string) => void
  countries: Country[]
  'aria-describedby'?: string
}

/**
 * Renders a <select> of countries sourced from the Storefront localization query.
 * The `value` prop should be a country ISO code (e.g. "US").
 * On change it calls `onChange` with the new ISO code so the parent can drive
 * the province cascade.
 */
export function CountrySelect({
  id = 'country',
  name = 'country',
  value,
  onChange,
  countries,
  'aria-describedby': describedBy,
}: CountrySelectProps) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
      autoComplete="country"
      aria-describedby={describedBy}
    >
      <option value="">Select a country…</option>
      {countries.map((c) => (
        <option key={c.isoCode} value={c.isoCode}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
