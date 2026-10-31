const PUZZLE_URL = 'https://www.nytimes.com/svc/wordle/v2'
const WORDS_URL  = 'https://gist.githubusercontent.com/dracos/dd0668f281e685bad51479e5acaadb93/raw/6bfa15d263d6d5b63840a8e5b64e04b382fdb079/valid-wordle-words.txt'
const ROW_COUNT  = 6
const WORD_SIZE  = 5
const CHUNK_SIZE = 150

const COLORS        = ['X', 'G', 'Y']
const COLOR_NAMES   = { X: 'grey', G: 'green', Y: 'yellow' }
const COLOR_TO_CODE = { X: 'n', G: 'y', Y: 'c' }
const CODE_TO_COLOR = { n: 'X', y: 'G', c: 'Y' }

const byId = id => document.getElementById(id)

const elements = {
  title:        byId('title'),
  loading:      byId('loading'),
  app:          byId('app'),
  grid:         byId('main-grid'),
  disallow:     byId('disallow-solution'),
  disallowText: byId('disallow-label'),
  resetBtn:     byId('reset-btn'),
  openDictBtn:  byId('open-modal-link'),
  modal:        byId('word-modal'),
  dictInfo:     byId('dict-info'),
  search:       byId('word-search'),
  count:        byId('dict-count'),
  results:      byId('word-results')
}

const wordPattern = new Map()
const htmlCache   = new Map()
const rows        = []

let wordList      = []
let patternGroups = new Map()
let solution      = ''
let activeRow     = null
let searchItems   = []
let renderIndex   = 0

function createEl(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function evaluateGuess(guess, solution) {
  const result     = Array(WORD_SIZE).fill('X')
  const solChars   = [...solution]
  const guessChars = [...guess]

  for (let idx = 0; idx < WORD_SIZE; idx++) {
    if (guessChars[idx] === solChars[idx]) {
      result[idx]     = 'G'
      solChars[idx]   = null
      guessChars[idx] = null
    }
  }

  for (let idx = 0; idx < WORD_SIZE; idx++) {
    if (guessChars[idx] === null) continue

    const found = solChars.indexOf(guessChars[idx])
    if (found !== -1) {
      result[idx]   = 'Y'
      solChars[found] = null
    }
  }

  return result.join('')
}

function candidatesFor(pattern, disallowSolution) {
  const candidates = patternGroups.get(pattern) ?? []
  return disallowSolution ? candidates.filter(word => word !== solution) : candidates
}

function getRowPattern(row) {
  return row.leftCells.map(cell => cell.dataset.color).join('')
}

function setLeftColor(row, col, color) {
  const cell = row.leftCells[col]
  cell.dataset.color = color
  cell.ariaLabel     = `Row ${row.index + 1}, tile ${col + 1}: ${COLOR_NAMES[color]}. Press to change.`
}

function createRow(index) {
  const leftGroup  = createEl('div', { className: 'cell-group' })
  const rightGroup = createEl('div', { className: 'cell-group', ariaLive: 'polite' })
  const groups     = createEl('div', { className: 'groups' }, leftGroup, rightGroup)
  const row        = { index, leftCells: [], rightCells: [], groups, nextBtn: null, alt: 0 }

  for (let col = 0; col < WORD_SIZE; col++) {
    const leftCell  = createEl('button', { type: 'button', className: 'cell left-cell' })
    const rightCell = createEl('div', { className: 'cell' })

    rightCell.dataset.color = 'E'
    row.leftCells.push(leftCell)
    row.rightCells.push(rightCell)
    setLeftColor(row, col, 'X')

    leftCell.addEventListener('click', event => {
      const current = COLORS.indexOf(leftCell.dataset.color)
      const next    = (current + (event.shiftKey ? 2 : 1)) % COLORS.length

      setLeftColor(row, col, COLORS[next])
      row.alt = 0
      updateRow(index)
    })

    leftGroup.append(leftCell)
    rightGroup.append(rightCell)
  }

  return row
}

function buildGrid() {
  for (let index = 0; index < ROW_COUNT; index++) {
    const row = createRow(index)

    rows.push(row)
    elements.grid.append(row.groups)
    updateRow(index)
  }
}

function updateRow(rowIdx) {
  const row     = rows[rowIdx]
  const target  = getRowPattern(row)
  const matches = candidatesFor(target, elements.disallow.checked)
  const word    = matches.length ? matches[row.alt % matches.length] : null

  row.nextBtn?.remove()
  row.nextBtn = null

  row.rightCells.forEach((cell, col) => {
    cell.textContent   = word ? word[col]   : '?'
    cell.dataset.color = word ? target[col] : 'R'
  })

  if (matches.length === 1) return

  const code = [...target].map(color => COLOR_TO_CODE[color]).join('')
  const btn  = createEl('button', {
    type:      'button',
    className: matches.length ? 'next' : 'next impossible',
    title:     'New -- find other words',
    ariaLabel: `New: find other words for row ${rowIdx + 1}`
  }, ...Array.from('New', letter => createEl('span', { textContent: letter })))

  btn.addEventListener('click', () => openDictionary(`>${code}`, rowIdx))
  row.groups.append(btn)
  row.nextBtn = btn
}

function updateAllRows() {
  for (let index = 0; index < ROW_COUNT; index++) updateRow(index)
}

function resetAll() {
  for (const row of rows) {
    row.alt = 0
    for (let col = 0; col < WORD_SIZE; col++) setLeftColor(row, col, 'X')
  }
  updateAllRows()
}

function applyWordToRow(word, rowIdx) {
  const row     = rows[rowIdx]
  const pattern = wordPattern.get(word)

  for (const [col, color] of [...pattern].entries()) setLeftColor(row, col, color)

  const candidates = candidatesFor(pattern, elements.disallow.checked)
  row.alt = Math.max(0, candidates.indexOf(word))
  updateRow(rowIdx)
}

function wordHTML(word) {
  if (!htmlCache.has(word)) {
    const letters = [...wordPattern.get(word)]
      .map((color, col) => `<span data-color="${color}">${word[col]}</span>`)
      .join('')

    htmlCache.set(word, `<div class="dict-word" data-word="${word}">${letters}</div>`)
  }
  return htmlCache.get(word)
}

function loadMoreResults() {
  if (renderIndex >= searchItems.length) return

  const html = searchItems
    .slice(renderIndex, renderIndex + CHUNK_SIZE)
    .map(item => typeof item === 'string'
      ? wordHTML(item)
      : `<div class="dict-heading">${item.label} (${item.count.toLocaleString()})</div>`)
    .join('')

  elements.results.insertAdjacentHTML('beforeend', html)
  renderIndex += CHUNK_SIZE
}

function matchWords(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z*]/g, '')
  if (!cleaned) return { cleaned, matches: wordList }

  const regex = new RegExp(cleaned.replaceAll('*', '.'))
  return { cleaned, matches: wordList.filter(word => regex.test(word)) }
}

function countMisses(word, target) {
  return [...wordPattern.get(word)]
    .filter((color, col) => target[col] !== '*' && color !== target[col])
    .length
}

function searchByColor(query) {
  const gtIdx                   = query.indexOf('>')
  const beforeGt                = query.slice(0, gtIdx)
  const [, token, afterToken]   = query.slice(gtIdx + 1).match(/^(\S*)\s*(.*)$/)
  const code                    = token.toLowerCase().replace(/[^nyc*]/g, '')
  const { cleaned, matches }    = matchWords(beforeGt + afterToken)

  if (!matches.length) {
    elements.count.textContent = '0 matches'
    searchItems = []
    return
  }

  const target = [...code.padEnd(WORD_SIZE, '*').slice(0, WORD_SIZE)]
    .map(char => CODE_TO_COLOR[char] ?? char)

  const buckets   = Object.groupBy(matches, word => countMisses(word, target))
  const exact     = buckets[0]?.length ?? 0
  const exactText = `${exact.toLocaleString()} exact match${exact === 1 ? '' : 'es'}`

  elements.count.textContent = cleaned
    ? `${exactText} · ${matches.length.toLocaleString()} matching "${cleaned}" sorted by color similarity`
    : `${exactText} · ${wordList.length.toLocaleString()} words sorted by similarity`

  searchItems = Object.entries(buckets).flatMap(([dist, group]) => {
    const label = dist === '0' ? 'Exact matches' : `${dist} tile${dist === '1' ? '' : 's'} different`
    return [{ header: true, label, count: group.length }, ...group]
  })
}

function searchPlain(query) {
  const { matches } = matchWords(query)

  elements.count.textContent = `${matches.length.toLocaleString()} match${matches.length === 1 ? '' : 'es'}`
  searchItems = matches
}

function renderSearch(rawQuery) {
  const query = rawQuery.trim()

  if (query.includes('>')) searchByColor(query)
  else searchPlain(query)

  renderIndex = 0
  elements.results.innerHTML = ''
  elements.results.scrollTop = 0

  if (searchItems.length) loadMoreResults()
  else elements.results.innerHTML = '<div class="empty">No words match your search.</div>'
}

function openDictionary(query = '', rowIdx = null) {
  activeRow = rowIdx

  if (!elements.modal.open) elements.modal.showModal()
  elements.search.value = query
  renderSearch(query)
  elements.search.focus()
}

function setupModal() {
  let frame = 0

  elements.openDictBtn.addEventListener('click', () => openDictionary())
  elements.modal.addEventListener('click', event => {
    if (event.target === elements.modal) elements.modal.close()
  })

  elements.results.addEventListener('click', event => {
    const wordEl = event.target.closest('.dict-word')
    if (!wordEl) return

    const targetIdx = activeRow ?? rows.findIndex(row =>
      row.alt === 0 && row.leftCells.every(cell => cell.dataset.color === 'X'))

    if (targetIdx === -1) return

    applyWordToRow(wordEl.dataset.word, targetIdx)
    elements.modal.close()
  })

  elements.results.addEventListener('scroll', () => {
    const { scrollTop, clientHeight, scrollHeight } = elements.results
    if (scrollTop + clientHeight >= scrollHeight - 250) loadMoreResults()
  })

  const scheduleSearch = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => renderSearch(elements.search.value))
  }

  for (const type of ['input', 'keyup', 'search']) {
    elements.search.addEventListener(type, scheduleSearch)
  }
}

function showLoadError() {
  elements.loading.textContent = "Failed to load today's Wordle. Check your connection. "
  elements.loading.append(createEl('button', {
    type:        'button',
    className:   'text-btn',
    textContent: 'Retry',
    onclick:     () => location.reload()
  }))
}

async function loadSolution() {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit'
  }).formatToParts(new Date())
  const date     = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]))
  const response = await fetch(`${PUZZLE_URL}/${date.year}-${date.month}-${date.day}.json`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const puzzle = await response.json()
  const word   = typeof puzzle.solution === 'string' ? puzzle.solution.toLowerCase() : ''
  if (!/^[a-z]{5}$/.test(word)) throw new Error('Invalid Wordle solution')

  solution = word
}

async function loadWords() {
  const response = await fetch(WORDS_URL)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const text = await response.text()
  const list = text
    .split('\n')
    .map(word => word.trim().toLowerCase())
    .filter(word => /^[a-z]{5}$/.test(word))

  wordList = [...new Set(list)]
  if (!wordList.length) throw new Error('Word list is empty')

  for (const word of wordList) wordPattern.set(word, evaluateGuess(word, solution))
  patternGroups = Map.groupBy(wordList, word => wordPattern.get(word))
}

async function init() {
  try {
    await loadSolution()

    const upper = solution.toUpperCase()
    const ex1   = solution.slice(0, 3)
    const ex2   = `${solution.slice(0, 2)}*${solution.slice(3, 5)}`
    const ex3   = `**${solution.slice(2, 5)}`
    const ex4   = `**${solution[2]}**`

    elements.title.textContent        = `Today's Word: ${upper}`
    elements.disallowText.textContent = `Disallow the actual solution (${upper})`
    elements.dictInfo.innerHTML       = `
      Use <b>*</b> as a wildcard (e.g. <b>${ex1}</b>, <b>${ex2}</b>, <b>${ex3}</b>, <b>${ex4}</b>).
      Search colors with <b>&gt;</b> (e.g. <b>&gt;yy</b>, <b>&gt;y*c</b>) or combine them: <b>&gt;nnnnc duc</b>.
      Click a word to insert it.`

    await loadWords()
  } catch (error) {
    console.error(error)
    showLoadError()
    return
  }

  elements.loading.hidden = true
  elements.app.hidden     = false

  buildGrid()
  setupModal()

  elements.disallow.addEventListener('change', () => {
    for (const row of rows) row.alt = 0
    updateAllRows()
  })
  elements.resetBtn.addEventListener('click', resetAll)
}

init()