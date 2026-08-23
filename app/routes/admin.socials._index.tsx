/**
 * /admin/socials index: the queue is the landing screen until Phase 4 ships
 * the calendar, which then becomes the default (ADR-013 decision 12).
 */
import { redirect } from 'react-router'

export function loader() {
  return redirect('/admin/socials/queue')
}

export default function SocialsIndex() {
  return null
}
