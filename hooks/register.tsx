import type { Register } from 'claude-code'

import { registerDesk } from './desk'
import { registerTimer } from './timer'

// One plugin, two halves: the work timer (registered first, so it sits
// outermost and places its chip at the right end of the row) and the desk
// (context weather, mail, calendar, tasks, notes, music, settings).
export const register: Register = (on, options) => {
  registerTimer(on, options)
  registerDesk(on, options)
}
