import { useState } from 'react'
import { Form } from 'react-router'
import type { CustomerAddress, Country } from '~/lib/shopify.server'
import { FieldGroup, fieldDescribedBy, inputClass } from './FieldGroup'
import { CountrySelect } from './CountrySelect'
import { ProvinceSelect } from './ProvinceSelect'

interface AddressFormProps {
  mode: 'new' | 'edit'
  /** Prefill values when editing */
  initial?: CustomerAddress | undefined
  /** Action errors returned from the route action */
  actionData?: { error?: string } | null | undefined
  countries: Country[]
}

/**
 * Shared address form used by both the "new" and "edit" routes.
 * Posts via <Form method="post"> to the parent route's action.
 * The sticky bottom save bar pattern is mobile-friendly.
 */
export function AddressForm({
  mode,
  initial,
  actionData,
  countries,
}: AddressFormProps) {
  const isEditing = mode === 'edit'

  // Country/province cascade — drive both selects as controlled state.
  const [countryCode, setCountryCode] = useState<string>(
    initial?.countryCodeV2 ?? 'US',
  )
  const [province, setProvince] = useState<string>(
    initial?.province ?? '',
  )

  // When country changes, reset province so stale values don't persist.
  function handleCountryChange(code: string) {
    setCountryCode(code)
    setProvince('')
  }

  const error = actionData && 'error' in actionData ? actionData.error : undefined

  return (
    <Form method="post" className="space-y-5 pb-28 md:pb-8">
      {/* Server error */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Row: First name / Last name */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldGroup id="firstName" label="First name">
          <input
            id="firstName"
            name="firstName"
            type="text"
            defaultValue={initial?.firstName ?? ''}
            autoComplete="given-name"
            className={inputClass}
            aria-describedby={fieldDescribedBy('firstName', undefined, undefined)}
          />
        </FieldGroup>

        <FieldGroup id="lastName" label="Last name">
          <input
            id="lastName"
            name="lastName"
            type="text"
            defaultValue={initial?.lastName ?? ''}
            autoComplete="family-name"
            className={inputClass}
            aria-describedby={fieldDescribedBy('lastName', undefined, undefined)}
          />
        </FieldGroup>
      </div>

      {/* Company (optional) */}
      <FieldGroup id="company" label="Company" helper="Optional">
        <input
          id="company"
          name="company"
          type="text"
          defaultValue={initial?.company ?? ''}
          autoComplete="organization"
          className={inputClass}
          aria-describedby={fieldDescribedBy('company', 'Optional', undefined)}
        />
      </FieldGroup>

      {/* Address line 1 */}
      <FieldGroup id="address1" label="Address">
        <input
          id="address1"
          name="address1"
          type="text"
          defaultValue={initial?.address1 ?? ''}
          autoComplete="address-line1"
          className={inputClass}
        />
      </FieldGroup>

      {/* Address line 2 */}
      <FieldGroup id="address2" label="Apartment, suite, etc." helper="Optional">
        <input
          id="address2"
          name="address2"
          type="text"
          defaultValue={initial?.address2 ?? ''}
          autoComplete="address-line2"
          className={inputClass}
          aria-describedby={fieldDescribedBy('address2', 'Optional', undefined)}
        />
      </FieldGroup>

      {/* City */}
      <FieldGroup id="city" label="City">
        <input
          id="city"
          name="city"
          type="text"
          defaultValue={initial?.city ?? ''}
          autoComplete="address-level2"
          className={inputClass}
        />
      </FieldGroup>

      {/* Country */}
      <FieldGroup id="country" label="Country">
        {/* We store the ISO code in component state and send the full name as
            a hidden field. Shopify's Storefront API CustomerAddress uses full
            country name, but we identify the country by isoCode for the cascade. */}
        <CountrySelect
          id="country-select"
          name="countryCode"
          value={countryCode}
          onChange={handleCountryChange}
          countries={countries}
        />
        {/* Hidden field: send the human-readable country name that Shopify expects */}
        <input type="hidden" name="country" value={
          countries.find(c => c.isoCode === countryCode)?.name ?? countryCode
        } />
      </FieldGroup>

      {/* Province / State */}
      <FieldGroup id="province" label="State / Province">
        <ProvinceSelect
          id="province"
          name="province"
          countryCode={countryCode}
          value={province}
          onChange={setProvince}
        />
      </FieldGroup>

      {/* ZIP / Postal code */}
      <FieldGroup id="zip" label="ZIP / Postal code">
        <input
          id="zip"
          name="zip"
          type="text"
          defaultValue={initial?.zip ?? ''}
          autoComplete="postal-code"
          className={inputClass}
        />
      </FieldGroup>

      {/* Phone */}
      <FieldGroup id="phone" label="Phone" helper="Optional">
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={initial?.phone ?? ''}
          autoComplete="tel"
          className={inputClass}
          aria-describedby={fieldDescribedBy('phone', 'Optional', undefined)}
        />
      </FieldGroup>

      {/* Set as default checkbox */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          name="setDefault"
          value="on"
          defaultChecked={false}
          className="h-4 w-4 rounded border-brand-mist text-brand-purple focus:ring-brand-purple/50 accent-brand-purple"
        />
        <span className="text-sm font-semibold text-brand-charcoal">
          Set as default address
        </span>
      </label>

      {/* ── Sticky save bar (mobile) / inline save button (desktop) ─────────
          On mobile the bar sticks to the bottom of the viewport.
          On md+ it's a normal inline button row.                          */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-brand-mist px-4 py-3 md:static md:border-0 md:bg-transparent md:p-0">
        <div className="flex gap-3 max-w-lg mx-auto md:max-w-none md:mx-0 md:justify-start">
          <button
            type="submit"
            className="flex-1 md:flex-none md:px-8 bg-brand-gradient text-white font-bold py-3 rounded-full hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isEditing ? 'Save changes' : 'Add address'} ♥
          </button>
          <a
            href="/account/addresses"
            className="flex-1 md:flex-none md:px-8 flex items-center justify-center text-sm font-semibold text-brand-charcoal/60 hover:text-brand-charcoal bg-brand-mist rounded-full py-3 transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Cancel
          </a>
        </div>
      </div>
    </Form>
  )
}
