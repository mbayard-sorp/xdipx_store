import { PROVINCE_MAP } from './provinces'
import { inputClass } from './FieldGroup'

interface ProvinceSelectProps {
  id?: string
  name?: string
  /** ISO country code (e.g. "US", "CA"). Drives whether we render a <select> or <input>. */
  countryCode: string
  /** Current province value — full name preferred (matches what Shopify stores). */
  value: string
  onChange: (value: string) => void
  'aria-describedby'?: string
}

/**
 * Renders a province/state <select> for countries in PROVINCE_MAP,
 * or a free-text <input> for unsupported countries so all users can still save.
 *
 * Shopify accepts the full province name (e.g. "California"), not the code.
 * So the option values here are the full names, not the codes.
 */
export function ProvinceSelect({
  id = 'province',
  name = 'province',
  countryCode,
  value,
  onChange,
  'aria-describedby': describedBy,
}: ProvinceSelectProps) {
  const provinces = PROVINCE_MAP[countryCode]

  if (!provinces) {
    // Country not in static map → free-text input
    return (
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        autoComplete="address-level1"
        aria-describedby={describedBy}
        placeholder="State / province / region"
      />
    )
  }

  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
      autoComplete="address-level1"
      aria-describedby={describedBy}
    >
      <option value="">Select a state / province…</option>
      {provinces.map((p) => (
        <option key={p.code} value={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  )
}
