/**
 * /admin/socials index: the calendar is the landing screen (Social Studio v2
 * Phase 4, #4939; ADR-013 decision 12). The queue stays one tap away on the
 * workspace bar.
 */
import { redirect } from 'react-router'

export function loader() {
  return redirect('/admin/socials/calendar')
}

export default function SocialsIndex() {
  return null
}
