import { forwardRef, useEffect, useMemo, useState } from 'react'
import DatePicker, { registerLocale } from 'react-datepicker'
import { hr } from 'date-fns/locale'
import 'react-datepicker/dist/react-datepicker.css'
import { useAuth } from './auth.jsx'
import Login from './Login.jsx'
import {
  useCoffeeData,
  participantsFor,
  payerAmong,
  isRecorded,
  attendanceStats,
  attendanceSeries,
} from './useCoffeeData.js'
import {
  cetNow,
  isCoffeeTime,
  isWorkday,
  prettyDate,
  fmtDateTime,
  COFFEE_START_MIN,
} from './time.js'

const ACTIVITY_ICONS = {
  payment: '💸',
  undo: '↩️',
  join: '✅',
  leave: '🚫',
  'user-create': '➕',
  'user-update': '✏️',
  'user-delete': '🗑️',
  'score-edit': '🔢',
  reset: '♻️',
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="app loading-screen">Učitavanje…</div>
  if (!user) return <Login />
  return <Main />
}

function Main() {
  const { user, logout } = useAuth()
  const data = useCoffeeData()
  const now = useClock()
  const cet = cetNow(now)
  const today = cet.dateKey
  const isAdmin = user.role === 'admin'

  return (
    <div className="app">
      <header className="hero">
        <div className="userbar">
          <span className="userbar__who">
            {user.displayName}
            <span className={`role role--${user.role}`}>
              {user.role === 'admin' ? 'administrator' : 'korisnik'}
            </span>
          </span>
          <button className="link-btn" onClick={logout}>
            Odjava
          </button>
        </div>
        <h1>☕ Koteks Pauza</h1>
        <p className="tagline">Tko je na redu da plati kavu?</p>
        <CoffeeStatus cet={cet} />
      </header>

      {data.error && (
        <div className="banner banner--error">
          <span>{data.error}</span>
          <button className="link-btn" onClick={data.clearError}>
            ✕
          </button>
        </div>
      )}

      <TodayCard data={data} dateKey={today} />
      <Scoreboard users={data.state.users} />
      <HistoryCard data={data} />
      <ActivityCard data={data} />
      {isAdmin && <AttendanceCard data={data} />}
      {isAdmin && <MembersCard data={data} currentUserId={user.id} />}

      <footer className="footer">
        {isAdmin ? (
          <button
            className="link-btn"
            onClick={() => window.confirm('Obrisati sve bodove i povijest?') && data.reset()}
          >
            Obriši sve podatke
          </button>
        ) : (
          <span className="muted">Upravljanje računima dostupno je administratoru.</span>
        )}
        <span className="muted">Podaci se dijele s cijelom ekipom.</span>
      </footer>
    </div>
  )
}

// Re-render every 20s so the coffee-window status stays fresh.
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000)
    return () => clearInterval(t)
  }, [])
  return now
}

function CoffeeStatus({ cet }) {
  const active = isCoffeeTime(cet) && isWorkday(cet)
  const upcoming = isWorkday(cet) && cet.minutes < COFFEE_START_MIN
  let label
  if (!isWorkday(cet)) label = 'Danas nema kave — vikend je 😎'
  else if (active) label = 'Kava je upravo u tijeku!'
  else if (upcoming) label = 'Kava uskoro počinje.'
  else label = 'Današnja pauza za kavu je gotova.'

  return (
    <div className={`status ${active ? 'status--live' : ''}`}>
      <span className="status__dot" />
      <span>{label}</span>
    </div>
  )
}

function TodayCard({ data, dateKey }) {
  const { state } = data
  const [choosing, setChoosing] = useState(false)
  const participants = participantsFor(state, dateKey)
  const payer = payerAmong(participants, state.history)
  const recorded = isRecorded(state, dateKey)
  const recordedEntry = state.history.find((h) => h.date === dateKey)
  const recordedPayer = recordedEntry
    ? state.users.find((u) => u.id === recordedEntry.payerId)
    : null

  const optOut = new Set(state.optOuts[dateKey] || [])

  return (
    <section className="card">
      <div className="card__head">
        <h2>Danas</h2>
        <span className="muted">{prettyDate(dateKey)}</span>
      </div>

      {recorded ? (
        <div className="verdict verdict--done">
          <div>
            <span className="verdict__label">Platio</span>
            <span className="verdict__name">{recordedPayer?.displayName ?? 'netko'}</span>
          </div>
          <button className="btn btn--ghost" onClick={() => data.undoPayment(dateKey)}>
            Poništi
          </button>
        </div>
      ) : payer ? (
        <>
          <div className="verdict">
            <div>
              <span className="verdict__label">Na redu je,</span>
              <span className="verdict__name">{payer.displayName}</span>
            </div>
            <button className="btn" onClick={() => data.recordPayment(dateKey, payer.id)}>
              {payer.displayName} je platio →
            </button>
          </div>

          {choosing ? (
            <div className="payer-picker">
              <div className="payer-picker__head">
                <span>Tko je platio?</span>
                <button className="link-btn" onClick={() => setChoosing(false)}>
                  Odustani
                </button>
              </div>
              <ul className="chip-list">
                {participants.map((u) => (
                  <li key={u.id}>
                    <button
                      className="chip chip--in"
                      onClick={() => {
                        data.recordPayment(dateKey, u.id)
                        setChoosing(false)
                      }}
                    >
                      {u.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <button className="btn btn--ghost btn--block" onClick={() => setChoosing(true)}>
              Netko drugi je platio
            </button>
          )}
        </>
      ) : (
        <p className="muted">Danas nitko ne dolazi. Označite nekoga ispod.</p>
      )}

      <div className="participants">
        <div className="participants__head">
          <span>Tko danas dolazi?</span>
          <span className="muted">{participants.length} dolazi</span>
        </div>
        <ul className="chip-list">
          {state.users.map((u) => {
            const inToday = !optOut.has(u.id)
            const isPayer = !recorded && payer && payer.id === u.id
            return (
              <li key={u.id}>
                <button
                  className={`chip ${inToday ? 'chip--in' : 'chip--out'} ${
                    isPayer ? 'chip--payer' : ''
                  }`}
                  disabled={recorded}
                  onClick={() => data.setParticipation(dateKey, u.id, !inToday)}
                  title={inToday ? 'Kliknite da označite da ne dolazi' : 'Kliknite da označite da dolazi'}
                >
                  <span className="chip__name">{u.displayName}</span>
                  <span className="chip__mark">{inToday ? '✓' : '—'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function Scoreboard({ users }) {
  const ranked = useMemo(
    () => [...users].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName)),
    [users],
  )
  if (users.length === 0) return null

  // Scores can be negative, so size the bars relative to the current min..max
  // range rather than from zero.
  const scores = users.map((u) => u.score)
  const min = Math.min(...scores)
  const range = Math.max(...scores) - min

  return (
    <section className="card">
      <div className="card__head">
        <h2>Ljestvica</h2>
        <span className="muted">više = bliže plaćanju</span>
      </div>
      <ul className="board">
        {ranked.map((u, i) => (
          <li key={u.id} className="board__row">
            <span className="board__rank">{i + 1}</span>
            <span className="board__name">{u.displayName}</span>
            <span className="board__bar">
              <span
                className="board__fill"
                style={{ width: `${range > 0 ? ((u.score - min) / range) * 100 : 0}%` }}
              />
            </span>
            <span className="board__score">{u.score}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AttendanceCard({ data }) {
  const { state } = data
  const stats = useMemo(() => attendanceStats(state), [state])
  const totalDays = state.history.length
  const [selectedId, setSelectedId] = useState(null)
  // From/to range (JS Dates) applied to the open user's trend chart. Kept at the
  // card level so it persists when switching between people (easy comparison).
  const [range, setRange] = useState({ from: null, to: null })
  const fromKey = range.from ? dateKeyOf(range.from) : null
  const toKey = range.to ? dateKeyOf(range.to) : null

  return (
    <section className="card">
      <div className="card__head">
        <h2>Dolasci</h2>
        <span className="muted">{totalDays} dana s kavom</span>
      </div>

      {totalDays === 0 ? (
        <p className="muted">Još nema zabilježenih dana s kavom.</p>
      ) : (
        <ul className="board">
          {stats.map((s) => {
            const open = selectedId === s.id
            return (
              <li key={s.id} className="attendance__item">
                <button
                  type="button"
                  className={`board__row board__row--attendance attendance__row ${
                    open ? 'attendance__row--open' : ''
                  }`}
                  onClick={() => setSelectedId(open ? null : s.id)}
                  aria-expanded={open}
                  title="Klik za prikaz kretanja kroz vrijeme"
                >
                  <span className="board__name">{s.displayName}</span>
                  <span className="board__bar">
                    <span className="board__fill" style={{ width: `${s.rate * 100}%` }} />
                  </span>
                  <span className="attendance__count">
                    {s.attended}/{totalDays}
                  </span>
                  <span className="attendance__paid">💸 {s.paid}</span>
                </button>
                {open && (
                  <AttendanceChart
                    series={attendanceSeries(state, s.id, { from: fromKey, to: toKey })}
                    name={s.displayName}
                    range={range}
                    onRangeChange={setRange}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Short "d.m." label from a YYYY-MM-DD date key (for the chart's x-axis ends).
const shortDay = (key) => {
  const [, m, d] = key.split('-')
  return `${Number(d)}.${Number(m)}.`
}

// Local calendar day of a JS Date as a YYYY-MM-DD key (matches coffee-day keys).
const dateKeyOf = (d) => d.toLocaleDateString('en-CA')

// Hand-rolled SVG line chart (no chart lib) showing a user's running attendance
// rate across coffee days, with a dot per day (present/absent) and a ring on
// days they paid. Scales to the card width via viewBox.
function AttendanceChart({ series, name, range, onRangeChange }) {
  const W = 600
  const H = 180
  const PL = 34 // room for the % axis labels
  const PR = 12
  const PT = 12
  const PB = 26 // room for the date labels
  const plotW = W - PL - PR
  const plotH = H - PT - PB
  const n = series.length
  const baseY = PT + plotH

  const xAt = (i) => (n === 1 ? PL + plotW / 2 : PL + (i / (n - 1)) * plotW)
  const yAt = (rate) => PT + (1 - rate) * plotH

  const linePath = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(p.rate)}`).join(' ')
  const areaPath =
    `M${xAt(0)},${baseY} ` +
    series.map((p, i) => `L${xAt(i)},${yAt(p.rate)}`).join(' ') +
    ` L${xAt(n - 1)},${baseY} Z`

  const ranged = !!(range.from || range.to)
  const lastRate = n ? series[n - 1].rate : 0

  return (
    <div className="attendance-chart">
      <div className="attendance-chart__head">
        <span className="attendance-chart__title">{name} — dolasci kroz vrijeme</span>
        {n > 0 && (
          <span className="muted">
            {ranged ? 'u razdoblju' : 'trenutno'} {Math.round(lastRate * 100)}%
          </span>
        )}
      </div>

      <div className="attendance-chart__controls">
        <DatePicker
          selected={range.from}
          onChange={(d) => onRangeChange((r) => ({ ...r, from: d }))}
          selectsStart
          startDate={range.from}
          endDate={range.to}
          maxDate={range.to || undefined}
          locale="hr"
          dateFormat="d. M. yyyy."
          placeholderText="Od"
          isClearable
          calendarStartDay={1}
          customInput={<ActivityDateInput />}
        />
        <span className="attendance-chart__controls-sep">–</span>
        <DatePicker
          selected={range.to}
          onChange={(d) => onRangeChange((r) => ({ ...r, to: d }))}
          selectsEnd
          startDate={range.from}
          endDate={range.to}
          minDate={range.from || undefined}
          locale="hr"
          dateFormat="d. M. yyyy."
          placeholderText="Do"
          isClearable
          calendarStartDay={1}
          customInput={<ActivityDateInput />}
        />
      </div>

      {n === 0 ? (
        <p className="muted attendance-chart__empty">Nema dolazaka u odabranom razdoblju.</p>
      ) : (
        <>
      <svg
        className="attendance-chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Kretanje stope dolazaka za ${name}`}
      >
        {[1, 0.5, 0].map((g) => (
          <g key={g}>
            <line
              className="attendance-chart__grid"
              x1={PL}
              x2={W - PR}
              y1={yAt(g)}
              y2={yAt(g)}
            />
            <text className="attendance-chart__label" x={PL - 6} y={yAt(g) + 4} textAnchor="end">
              {g * 100}%
            </text>
          </g>
        ))}

        <path className="attendance-chart__area" d={areaPath} />
        <path className="attendance-chart__line" d={linePath} />

        {series.map((p, i) => (
          <circle
            key={p.date}
            className={`attendance-chart__dot attendance-chart__dot--${p.present ? 'in' : 'out'} ${
              p.paid ? 'attendance-chart__dot--paid' : ''
            }`}
            cx={xAt(i)}
            cy={yAt(p.rate)}
            r={p.paid ? 5 : 3.5}
          >
            <title>
              {prettyDate(p.date)} — {p.present ? 'došao' : 'izostao'}
              {p.paid ? ' (platio)' : ''} · {Math.round(p.rate * 100)}%
            </title>
          </circle>
        ))}

        <text className="attendance-chart__label" x={xAt(0)} y={H - 8} textAnchor="start">
          {shortDay(series[0].date)}
        </text>
        {n > 1 && (
          <text
            className="attendance-chart__label"
            x={xAt(n - 1)}
            y={H - 8}
            textAnchor="end"
          >
            {shortDay(series[n - 1].date)}
          </text>
        )}
      </svg>

      <div className="attendance-chart__legend">
        <span className="attendance-chart__key attendance-chart__key--in">došao</span>
        <span className="attendance-chart__key attendance-chart__key--out">izostao</span>
        <span className="attendance-chart__key attendance-chart__key--paid">platio</span>
      </div>
        </>
      )}
    </div>
  )
}

function MembersCard({ data, currentUserId }) {
  const { state } = data
  const [form, setForm] = useState({ displayName: '', username: '', password: '', role: 'regular' })
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editingScoreId, setEditingScoreId] = useState(null)
  const [scoreVal, setScoreVal] = useState('')

  const add = async (e) => {
    e.preventDefault()
    const ok = await data.createUser(form)
    if (ok) setForm({ displayName: '', username: '', password: '', role: 'regular' })
  }

  const startEdit = (u) => {
    setEditingId(u.id)
    setEditName(u.displayName)
  }

  const commitEdit = async (e) => {
    e.preventDefault()
    const ok = await data.updateUser(editingId, { displayName: editName })
    if (ok) setEditingId(null)
  }

  const startEditScore = (u) => {
    setEditingScoreId(u.id)
    setScoreVal(String(u.score))
  }

  const commitScore = async (e) => {
    e.preventDefault()
    const n = parseInt(scoreVal, 10)
    if (Number.isNaN(n)) {
      setEditingScoreId(null)
      return
    }
    const ok = await data.updateUser(editingScoreId, { score: n })
    if (ok) setEditingScoreId(null)
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Ljudi</h2>
        <span className="muted">ukupno {state.users.length}</span>
      </div>

      <form className="add-form" onSubmit={add}>
        <input
          className="input"
          placeholder="Ime za prikaz"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
        <input
          className="input"
          placeholder="korisničko ime"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <input
          className="input"
          type="password"
          placeholder="lozinka"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <select
          className="input"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="regular">korisnik</option>
          <option value="admin">administrator</option>
        </select>
        <button className="btn" type="submit">
          Dodaj
        </button>
      </form>

      <ul className="people">
        {state.users.map((u) => (
          <li key={u.id} className="people__row">
            {editingId === u.id ? (
              <form className="add-row" onSubmit={commitEdit}>
                <input
                  className="input"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitEdit}
                />
                <button className="btn btn--ghost" type="submit">
                  Spremi
                </button>
              </form>
            ) : (
              <>
                <span className="people__name">
                  {u.displayName} <span className="muted">@{u.username}</span>
                </span>
                <button
                  className={`role-toggle role--${u.role}`}
                  onClick={() =>
                    data.updateUser(u.id, { role: u.role === 'admin' ? 'regular' : 'admin' })
                  }
                  title="Klik za promjenu uloge"
                >
                  {u.role === 'admin' ? 'administrator' : 'korisnik'}
                </button>
                {editingScoreId === u.id ? (
                  <form className="add-row score-edit" onSubmit={commitScore}>
                    <input
                      className="input input--sm"
                      type="number"
                      autoFocus
                      value={scoreVal}
                      onChange={(e) => setScoreVal(e.target.value)}
                      onBlur={commitScore}
                    />
                    <button className="btn btn--ghost" type="submit">
                      Spremi
                    </button>
                  </form>
                ) : (
                  <button
                    className="link-btn people__score"
                    onClick={() => startEditScore(u)}
                    title="Klik za uređivanje bodova"
                  >
                    bodovi {u.score}
                  </button>
                )}
                <button className="link-btn" onClick={() => startEdit(u)}>
                  Preimenuj
                </button>
                {u.id !== currentUserId && (
                  <button
                    className="link-btn link-btn--danger"
                    onClick={() =>
                      window.confirm(`Obrisati korisnika ${u.displayName}?`) && data.deleteUser(u.id)
                    }
                  >
                    Ukloni
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function HistoryCard({ data }) {
  const { history, users } = data.state
  const nameOf = (id) => users.find((u) => u.id === id)?.displayName ?? '—'
  if (history.length === 0) return null

  return (
    <section className="card">
      <div className="card__head">
        <h2>Povijest</h2>
        <span className="muted">{history.length} dana s kavom</span>
      </div>
      <ul className="history">
        {history.map((h) => (
          <li key={h.date} className="history__row">
            <span className="history__date">{prettyDate(h.date)}</span>
            <span className="history__pay">
              💸 <strong>{nameOf(h.payerId)}</strong> platio za {h.participantIds.length}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

registerLocale('hr', hr)

// Custom input so the field matches our styling and never receives a null value
// (react-datepicker's default input warns on a null `value`).
const ActivityDateInput = forwardRef(function ActivityDateInput(
  { value, onClick, onChange, placeholder },
  ref,
) {
  return (
    <input
      ref={ref}
      type="text"
      className="input input--sm"
      value={value ?? ''}
      onClick={onClick}
      onChange={onChange}
      placeholder={placeholder}
    />
  )
})

const ACTIVITY_PAGE = 8

function ActivityCard({ data }) {
  const events = data.state.events || []
  // Default to today's activity; clearing the picker shows everything.
  const [date, setDate] = useState(() => new Date())
  const [visible, setVisible] = useState(ACTIVITY_PAGE)

  // Compare an event's local calendar day to the selected Date.
  const dayKey = (d) => d.toLocaleDateString('en-CA')
  const filtered = events.filter((e) => !date || dayKey(new Date(e.ts)) === dayKey(date))
  const shown = filtered.slice(0, visible)

  // Reset paging whenever the date changes.
  const onDate = (value) => {
    setDate(value)
    setVisible(ACTIVITY_PAGE)
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Aktivnost</h2>
        <div className="activity__controls">
          <DatePicker
            selected={date}
            onChange={onDate}
            locale="hr"
            dateFormat="d. M. yyyy."
            placeholderText="Datum"
            isClearable
            calendarStartDay={1}
            customInput={<ActivityDateInput />}
          />
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="muted">
          {events.length === 0
            ? 'Još nema zabilježene aktivnosti.'
            : 'Nema aktivnosti za odabrani datum.'}
        </p>
      )}

      <ul className="activity">
        {shown.map((e) => (
          <li key={e.id} className="activity__row">
            <span className="activity__icon">{ACTIVITY_ICONS[e.type] || '•'}</span>
            <div className="activity__body">
              <span className="activity__msg">{e.message}</span>
              <span className="activity__meta">
                {e.actor ? `${e.actor} · ` : ''}
                {fmtDateTime(e.ts)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {filtered.length > visible && (
        <button
          className="btn btn--ghost btn--block"
          onClick={() => setVisible((v) => v + ACTIVITY_PAGE)}
        >
          Učitaj više
        </button>
      )}
    </section>
  )
}
