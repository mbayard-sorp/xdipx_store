/**
 * /admin/video-studio lands on the board (ticket #5716). The board is the
 * dispatcher: never empty once a backlog exists, spans concept to posted, and
 * carries the counts that pull the owner to Scripts or Render. Scripts would
 * be empty six days out of seven and would train the owner not to open the
 * studio; Render answers "what is the machine doing", not "where are we".
 */
import { redirect } from 'react-router'

export function loader() {
  throw redirect('/admin/video-studio/board')
}
