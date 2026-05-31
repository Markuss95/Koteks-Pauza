// All coffee-time logic is anchored to Central European Time.
// We use the "Europe/Berlin" IANA zone so daylight saving (CET/CEST) is
// handled automatically instead of hard-coding a UTC offset.
const CET_ZONE = 'Europe/Berlin'

// Coffee happens every workday from 10:55 to 11:35 CET.
export const COFFEE_START_MIN = 10 * 60 + 55 // 655
export const COFFEE_END_MIN = 11 * 60 + 35 // 695

// Returns the current wall-clock info in CET regardless of the user's own
// timezone: { dateKey: 'YYYY-MM-DD', minutes, weekday, hh, mm }.
export function cetNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CET_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date)

  const get = (type) => parts.find((p) => p.type === type)?.value
  const year = get('year')
  const month = get('month')
  const day = get('day')
  let hh = parseInt(get('hour'), 10)
  if (hh === 24) hh = 0 // some engines emit 24 for midnight
  const mm = parseInt(get('minute'), 10)

  return {
    dateKey: `${year}-${month}-${day}`,
    minutes: hh * 60 + mm,
    weekday: get('weekday'),
    hh,
    mm,
  }
}

// Is the given CET state inside the coffee window?
export function isCoffeeTime({ minutes }) {
  return minutes >= COFFEE_START_MIN && minutes < COFFEE_END_MIN
}

// Mon–Fri only.
export function isWorkday({ weekday }) {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)
}

// 'Sat'/'Sun' from Intl -> readable, plus pretty date.
export function prettyDate(dateKey) {
  // dateKey is YYYY-MM-DD; parse as local-noon to avoid TZ rollover.
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12)
  return dt.toLocaleDateString('hr-HR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('hr-HR', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
