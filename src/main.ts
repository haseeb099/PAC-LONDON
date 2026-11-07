import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import { SynthAudio } from './audio/synthAudio'
import {
  getBoroughFeature,
  getFeatureBounds,
  loadLondonBoroughs,
  LOCKED_BOROUGH_NAME,
} from './data/londonBoroughs'
import { fetchRoadData, loadAddressPresets, searchPlaces } from './data/overpass'
import { GameEngine } from './game/gameEngine'
import { generatePlayableMap } from './generator/generatePlayableMap'
import { loadLocale, localeOptions, modeLabel, saveLocale, statusLabel, translate, type Locale } from './i18n'
import { MapController } from './map/mapController'
import { CanvasRenderer } from './render/canvasRenderer'
import type { AddressPreset, Direction, PlayableMap, Viewport } from './types'

function expandViewportForMaze(viewport: Viewport): Viewport {
  const latSpan = Math.max(viewport.bounds.north - viewport.bounds.south, 0.001)
  const lngSpan = Math.max(viewport.bounds.east - viewport.bounds.west, 0.001)
  const halfLat = Math.max(latSpan * MAZE_AREA_SCALE, MIN_MAZE_LAT_SPAN) / 2
  const halfLng = Math.max(lngSpan * MAZE_AREA_SCALE, MIN_MAZE_LNG_SPAN) / 2
  return {
    center: viewport.center,
    zoom: viewport.zoom,
    bounds: {
      north: viewport.center.lat + halfLat,
      south: viewport.center.lat - halfLat,
      east: viewport.center.lng + halfLng,
      west: viewport.center.lng - halfLng,
    },
  }
}

const RECOMMENDED_ZOOM_MIN = 16.5
const RECOMMENDED_ZOOM_MAX = 18
const RECOMMENDED_ZOOM_RANGE = '16.5-18'
/** Grow the playable street area so the maze has many connected roads to escape on. */
const MAZE_AREA_SCALE = 2.6
const MIN_MAZE_LAT_SPAN = 0.0075
const MIN_MAZE_LNG_SPAN = 0.011

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }
  return element
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root was not found')
}

app.innerHTML = `
  <div class="shell">
    <aside class="panel">
      <div class="corner-control">
        <select id="locale-select"></select>
      </div>
      <div class="panel-header">
        <p class="eyebrow" id="eyebrow"></p>
        <h1 id="title"></h1>
        <p class="intro" id="intro"></p>
      </div>

      <div class="button-row action-row">
        <button id="generate-button" type="button" class="primary"></button>
        <button id="play-button" type="button"></button>
        <button id="pause-button" type="button"></button>
        <button id="restart-button" type="button"></button>
      </div>

      <div class="controls">
        <label id="preset-control" class="speed-control hidden">
          <span id="preset-label"></span>
          <div class="search-row">
            <select id="preset-select"></select>
          </div>
        </label>
        <label class="search">
          <span id="search-label"></span>
          <div class="search-row">
            <input id="search-input" type="text" />
            <button id="search-button" type="button"></button>
          </div>
        </label>
        <div id="search-results" class="search-results"></div>
        <label class="inline-control">
          <span id="speed-label"></span>
          <input id="speed-input" type="range" min="0.5" max="2.0" step="0.1" value="0.8" />
          <strong id="speed-value">0.8x</strong>
        </label>
        <label class="inline-control">
          <span id="pellet-label"></span>
          <input id="pellet-input" type="range" min="1.0" max="5.0" step="0.5" value="2.0" />
          <strong id="pellet-value">2.0x</strong>
        </label>
      </div>

      <div class="stats">
        <div><span id="score-label"></span><strong id="score-value">0</strong></div>
        <div><span id="lives-label"></span><div id="lives-value" class="life-icons"></div></div>
        <div><span id="vacant-label"></span><strong id="vacant-value">—</strong></div>
        <div><span id="status-label"></span><strong id="status-value">Idle</strong></div>
      </div>

      <div class="tips">
        <p id="tip-controls"></p>
        <p id="tip-houses"></p>
        <p id="tip-generate"></p>
      </div>
      <div class="debug-line">
        <span id="mode-label"></span>
        <strong id="mode-value">idle</strong>
      </div>
    </aside>

    <main class="stage">
      <div id="map"></div>
      <div class="overlay">
        <canvas id="game-canvas"></canvas>
        <div id="loading-indicator" class="loading-indicator hidden" aria-live="polite">
          <div class="loading-card">
            <p class="loading-eyebrow" id="loading-eyebrow"></p>
            <h2 id="loading-title"></h2>
            <p class="loading-tagline" id="loading-tagline"></p>
            <div class="loading-spinner" aria-hidden="true"></div>
            <p id="loading-text" class="loading-status"></p>
            <div class="loading-progress" aria-hidden="true">
              <div id="loading-progress-bar" class="loading-progress-bar"></div>
            </div>
            <ul class="loading-steps" id="loading-steps">
              <li id="loading-step-map" data-step="map"></li>
              <li id="loading-step-roads" data-step="roads"></li>
              <li id="loading-step-houses" data-step="houses"></li>
              <li id="loading-step-ready" data-step="ready"></li>
            </ul>
            <div class="loading-info">
              <p id="loading-how-title" class="loading-info-title"></p>
              <ol id="loading-how-list" class="loading-how-list"></ol>
              <p id="loading-stack" class="loading-stack"></p>
            </div>
          </div>
        </div>
        <div id="borough-banner" class="borough-banner" aria-live="polite">
          <p id="borough-banner-title" class="borough-banner-title"></p>
          <p id="borough-banner-body" class="borough-banner-body"></p>
          <button id="borough-confirm-button" type="button" class="primary borough-confirm hidden"></button>
        </div>
        <div id="message" class="message"></div>
      </div>
    </main>
  </div>
`

const eyebrow = requireElement<HTMLElement>('#eyebrow')
const title = requireElement<HTMLElement>('#title')
const intro = requireElement<HTMLElement>('#intro')
const localeSelect = requireElement<HTMLSelectElement>('#locale-select')
const presetControl = requireElement<HTMLElement>('#preset-control')
const presetLabel = requireElement<HTMLElement>('#preset-label')
const presetSelect = requireElement<HTMLSelectElement>('#preset-select')
const searchInput = requireElement<HTMLInputElement>('#search-input')
const searchLabel = requireElement<HTMLElement>('#search-label')
const searchButton = requireElement<HTMLButtonElement>('#search-button')
const searchResults = requireElement<HTMLDivElement>('#search-results')
const generateButton = requireElement<HTMLButtonElement>('#generate-button')
const playButton = requireElement<HTMLButtonElement>('#play-button')
const pauseButton = requireElement<HTMLButtonElement>('#pause-button')
const restartButton = requireElement<HTMLButtonElement>('#restart-button')
const speedInput = requireElement<HTMLInputElement>('#speed-input')
const speedLabel = requireElement<HTMLElement>('#speed-label')
const speedValue = requireElement<HTMLElement>('#speed-value')
const pelletInput = requireElement<HTMLInputElement>('#pellet-input')
const pelletLabel = requireElement<HTMLElement>('#pellet-label')
const pelletValue = requireElement<HTMLElement>('#pellet-value')
const modeLabelNode = requireElement<HTMLElement>('#mode-label')
const scoreValue = requireElement<HTMLElement>('#score-value')
const scoreLabelNode = requireElement<HTMLElement>('#score-label')
const livesValue = requireElement<HTMLElement>('#lives-value')
const livesLabelNode = requireElement<HTMLElement>('#lives-label')
const vacantValue = requireElement<HTMLElement>('#vacant-value')
const vacantLabelNode = requireElement<HTMLElement>('#vacant-label')
const statusValue = requireElement<HTMLElement>('#status-value')
const statusLabelNode = requireElement<HTMLElement>('#status-label')
const modeValue = requireElement<HTMLElement>('#mode-value')
const tipControls = requireElement<HTMLElement>('#tip-controls')
const tipHouses = requireElement<HTMLElement>('#tip-houses')
const tipGenerate = requireElement<HTMLElement>('#tip-generate')
const loadingIndicator = requireElement<HTMLDivElement>('#loading-indicator')
const loadingEyebrow = requireElement<HTMLElement>('#loading-eyebrow')
const loadingTitle = requireElement<HTMLElement>('#loading-title')
const loadingTagline = requireElement<HTMLElement>('#loading-tagline')
const loadingText = requireElement<HTMLElement>('#loading-text')
const loadingProgressBar = requireElement<HTMLDivElement>('#loading-progress-bar')
const loadingStepMap = requireElement<HTMLElement>('#loading-step-map')
const loadingStepRoads = requireElement<HTMLElement>('#loading-step-roads')
const loadingStepHouses = requireElement<HTMLElement>('#loading-step-houses')
const loadingStepReady = requireElement<HTMLElement>('#loading-step-ready')
const loadingHowTitle = requireElement<HTMLElement>('#loading-how-title')
const loadingHowList = requireElement<HTMLOListElement>('#loading-how-list')
const loadingStack = requireElement<HTMLElement>('#loading-stack')
const boroughBanner = requireElement<HTMLDivElement>('#borough-banner')
const boroughBannerTitle = requireElement<HTMLElement>('#borough-banner-title')
const boroughBannerBody = requireElement<HTMLElement>('#borough-banner-body')
const boroughConfirmButton = requireElement<HTMLButtonElement>('#borough-confirm-button')
const message = requireElement<HTMLDivElement>('#message')

type LoadingStep = 'map' | 'roads' | 'houses' | 'ready'

const LOADING_STEP_ORDER: LoadingStep[] = ['map', 'roads', 'houses', 'ready']
const LOADING_STEP_NODES: Record<LoadingStep, HTMLElement> = {
  map: loadingStepMap,
  roads: loadingStepRoads,
  houses: loadingStepHouses,
  ready: loadingStepReady,
}
const mapRoot = requireElement<HTMLDivElement>('#map')
const canvas = requireElement<HTMLCanvasElement>('#game-canvas')

const mapController = new MapController(mapRoot)
const renderer = new CanvasRenderer(canvas)
const audio = new SynthAudio()

let playableMap: PlayableMap | null = null
let engine: GameEngine | null = null
let animationFrame = 0
let currentLocale: Locale = loadLocale()
let currentMessage: { key: string; params?: Record<string, string | number> } = { key: 'message.initial' }
let addressPresets: AddressPreset[] = []
let movedMessageTimer: number | null = null
let isGenerating = false
let selectedBorough: string | null = null
let boroughIntroActive = true
let pendingBoroughCollection: Awaited<ReturnType<typeof loadLondonBoroughs>> | null = null

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) {
    node.textContent = text
  }
}

function setHtml(node: HTMLElement, html: string): void {
  if (node.innerHTML !== html) {
    node.innerHTML = html
  }
}

function t(key: string, params?: Record<string, string | number>): string {
  return translate(currentLocale, key, params)
}

function setMessageKey(key: string, params?: Record<string, string | number>): void {
  currentMessage = { key, params }
  setText(message, t(key, params))
}

function renderLoadingCopy(): void {
  setText(loadingEyebrow, t('loading.eyebrow'))
  setText(loadingTitle, t('loading.title'))
  setText(loadingTagline, t('loading.tagline'))
  setText(loadingHowTitle, t('loading.howTitle'))
  setText(loadingStack, t('loading.stack'))
  setText(loadingStepMap, t('loading.step.map'))
  setText(loadingStepRoads, t('loading.step.roads'))
  setText(loadingStepHouses, t('loading.step.houses'))
  setText(loadingStepReady, t('loading.step.ready'))
  loadingHowList.innerHTML = [
    t('loading.how.1'),
    t('loading.how.2'),
    t('loading.how.3'),
    t('loading.how.4'),
  ].map((item) => `<li>${item}</li>`).join('')
}

function setLoadingStep(step: LoadingStep, statusKey: string): void {
  const index = LOADING_STEP_ORDER.indexOf(step)
  loadingProgressBar.style.width = `${((index + 1) / LOADING_STEP_ORDER.length) * 100}%`
  setText(loadingText, t(statusKey))
  for (const [key, node] of Object.entries(LOADING_STEP_NODES) as Array<[LoadingStep, HTMLElement]>) {
    const stepIndex = LOADING_STEP_ORDER.indexOf(key)
    node.classList.toggle('is-active', key === step)
    node.classList.toggle('is-done', stepIndex < index)
  }
}

function setGenerating(active: boolean): void {
  isGenerating = active
  loadingIndicator.classList.toggle('hidden', !active)
  playButton.disabled = active
  if (active) {
    renderLoadingCopy()
    setLoadingStep('map', 'loading.status.map')
  } else {
    loadingProgressBar.style.width = '0%'
  }
  updateGenerateButtonHint()
}

function renderBoroughBanner(): void {
  if (loadingIndicator.classList.contains('hidden') === false && isGenerating) {
    boroughBanner.classList.add('hidden')
    return
  }

  boroughBanner.classList.remove('hidden')
  if (selectedBorough === LOCKED_BOROUGH_NAME) {
    setText(boroughBannerTitle, t('borough.selectedTitle', { name: LOCKED_BOROUGH_NAME }))
    setText(boroughBannerBody, t('borough.selectedBody', { name: LOCKED_BOROUGH_NAME }))
    boroughConfirmButton.classList.add('hidden')
    return
  }

  setText(boroughBannerTitle, t('borough.pickTitle'))
  setText(boroughBannerBody, t('borough.pickBody', { name: LOCKED_BOROUGH_NAME }))
  setText(boroughConfirmButton, t('borough.confirm', { name: LOCKED_BOROUGH_NAME }))
  boroughConfirmButton.classList.remove('hidden')
}

function setLocationControlsEnabled(enabled: boolean): void {
  searchInput.disabled = !enabled
  searchButton.disabled = !enabled
  presetSelect.disabled = !enabled
}

function selectTowerHamlets(): void {
  if (!pendingBoroughCollection) {
    return
  }

  const feature = getBoroughFeature(pendingBoroughCollection, LOCKED_BOROUGH_NAME)
  if (!feature) {
    setMessageKey('message.boroughMissing', { name: LOCKED_BOROUGH_NAME })
    return
  }

  selectedBorough = LOCKED_BOROUGH_NAME
  boroughIntroActive = false
  mapController.fitBounds(getFeatureBounds(feature), { maxZoom: 13.6, duration: 1100, padding: 48 })
  setLocationControlsEnabled(false)
  renderBoroughBanner()
  setMessageKey('message.boroughSelected', { name: LOCKED_BOROUGH_NAME })
  updateGenerateButtonHint()
}

function handleBoroughClick(name: string): void {
  if (selectedBorough) {
    return
  }

  if (name !== LOCKED_BOROUGH_NAME) {
    setMessageKey('message.boroughLocked', { name, locked: LOCKED_BOROUGH_NAME })
    return
  }

  selectTowerHamlets()
}

async function startBoroughIntro(): Promise<void> {
  setLocationControlsEnabled(false)
  generateButton.disabled = true
  renderBoroughBanner()
  setMessageKey('message.boroughIntro')

  try {
    pendingBoroughCollection = await loadLondonBoroughs()
    await mapController.showBoroughIntro(pendingBoroughCollection, handleBoroughClick)
    setMessageKey('message.boroughReady', { name: LOCKED_BOROUGH_NAME })
  } catch (error) {
    console.error('Borough intro failed', error)
    setMessageKey('message.boroughLoadFailed')
    selectedBorough = LOCKED_BOROUGH_NAME
    boroughIntroActive = false
    setLocationControlsEnabled(false)
    boroughBanner.classList.add('hidden')
    updateGenerateButtonHint()
  }
}

function setMovedMessage(label: string, zoom: number): void {
  setMessageKey('message.moved', {
    label,
    zoom: zoom.toFixed(1),
    range: RECOMMENDED_ZOOM_RANGE,
  })
}

function setViewportGuidanceMessage(): void {
  const zoom = mapController.getViewport().zoom
  const params = {
    zoom: zoom.toFixed(1),
    range: RECOMMENDED_ZOOM_RANGE,
  }

  if (zoom < RECOMMENDED_ZOOM_MIN) {
    setMessageKey('message.viewportWide', params)
    return
  }

  if (zoom > RECOMMENDED_ZOOM_MAX) {
    setMessageKey('message.viewportTight', params)
    return
  }

  setMessageKey('message.viewportGood', params)
}

function refreshViewportMessage(): void {
  if (currentMessage.key === 'message.moved' && typeof currentMessage.params?.label === 'string') {
    setMovedMessage(currentMessage.params.label, mapController.getViewport().zoom)
    return
  }

  if (currentMessage.key === 'message.initial' || currentMessage.key.startsWith('message.viewport')) {
    setViewportGuidanceMessage()
  }
}

function scheduleMovedMessage(label: string): void {
  if (movedMessageTimer !== null) {
    window.clearTimeout(movedMessageTimer)
  }
  movedMessageTimer = window.setTimeout(() => {
    setMovedMessage(label, mapController.getViewport().zoom)
    movedMessageTimer = null
  }, 650)
}

function updateGenerateButtonHint(): void {
  if (isGenerating) {
    generateButton.disabled = true
    setText(generateButton, `⏳ ${t('buttons.generate')}`)
    generateButton.title = t('message.loading')
    return
  }

  if (!selectedBorough) {
    generateButton.disabled = true
    setText(generateButton, t('buttons.generate'))
    generateButton.title = t('borough.pickBody', { name: LOCKED_BOROUGH_NAME })
    return
  }

  generateButton.disabled = false
  const zoom = mapController.getViewport().zoom
  const zoomText = zoom.toFixed(1)

  if (zoom < RECOMMENDED_ZOOM_MIN) {
    setText(generateButton, `⚠️ ${t('buttons.generate')}`)
    generateButton.title = t('buttons.generateWideHint', { zoom: zoomText })
    return
  }

  if (zoom > RECOMMENDED_ZOOM_MAX) {
    setText(generateButton, `🔎 ${t('buttons.generate')}`)
    generateButton.title = t('buttons.generateTightHint', { zoom: zoomText })
    return
  }

  setText(generateButton, t('buttons.generate'))
  generateButton.title = t('buttons.generateGoodHint', { zoom: zoomText })
}

function renderLocale(): void {
  document.documentElement.lang = currentLocale
  localeSelect.innerHTML = ''
  for (const option of localeOptions) {
    const element = document.createElement('option')
    element.value = option.value
    element.textContent = option.label
    localeSelect.append(element)
  }
  localeSelect.value = currentLocale

  setText(eyebrow, t('app.eyebrow'))
  setText(title, t('app.title'))
  setText(intro, t('app.intro'))
  localeSelect.title = t('controls.language')
  setText(presetLabel, t('controls.presets'))
  setText(searchLabel, t('controls.search'))
  searchInput.placeholder = t('search.placeholder')
  setText(searchButton, t('buttons.search'))
  setText(playButton, t('buttons.play'))
  setText(pauseButton, t('buttons.pause'))
  setText(restartButton, t('buttons.restart'))
  setText(speedLabel, t('controls.speed'))
  setText(pelletLabel, t('controls.pellets'))
  setText(modeLabelNode, t('stats.mode'))
  setText(scoreLabelNode, t('stats.score'))
  setText(livesLabelNode, t('stats.lives'))
  setText(vacantLabelNode, t('stats.vacant'))
  setText(statusLabelNode, t('stats.status'))
  setText(tipControls, t('tips.controls'))
  setText(tipHouses, t('tips.houses'))
  setHtml(tipGenerate, t('tips.generate'))
  if (!loadingIndicator.classList.contains('hidden')) {
    renderLoadingCopy()
  }
  renderBoroughBanner()
  updateGenerateButtonHint()
  if (selectedBorough && (currentMessage.key === 'message.initial' || currentMessage.key.startsWith('message.viewport') || currentMessage.key === 'message.moved')) {
    refreshViewportMessage()
  } else {
    setText(message, t(currentMessage.key, currentMessage.params))
  }
  renderPresetOptions()
  syncHud()
}

function renderPresetOptions(): void {
  if (addressPresets.length === 0) {
    presetControl.classList.add('hidden')
    return
  }

  presetControl.classList.remove('hidden')
  presetSelect.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = t('presets.placeholder')
  presetSelect.append(placeholder)

  addressPresets.forEach((preset, index) => {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = preset.label
    presetSelect.append(option)
  })
  presetSelect.value = ''
}

function applySpeed(): void {
  const value = Number(speedInput.value)
  speedValue.textContent = `${value.toFixed(1)}x`
  engine?.setSpeedMultiplier(value)
}

function applyPelletDensity(): void {
  const value = Number(pelletInput.value)
  pelletValue.textContent = `${value.toFixed(1)}x`
}

function renderLives(count: number): void {
  const icons = Array.from({ length: Math.max(0, count) }, (_, index) =>
    `<span class="life-icon" aria-hidden="true" style="animation-delay:${index * 0.06}s"></span>`)
  setHtml(livesValue, icons.join(''))
}

function syncHud(): void {
  if (!engine) {
    setText(scoreValue, '0')
    renderLives(3)
    const vacantPreview = playableMap
      ? String(playableMap.houses.filter((house) => house.isVacant && !house.claimed).length)
      : '—'
    setText(vacantValue, vacantPreview)
    setText(statusValue, playableMap ? statusLabel(currentLocale, 'preview') : statusLabel(currentLocale, 'idle'))
    setText(modeValue, modeLabel(currentLocale, playableMap?.sourceMode ?? 'idle'))
    return
  }

  setText(scoreValue, String(engine.state.score))
  renderLives(engine.state.lives)
  setText(vacantValue, String(engine.state.remainingVacantHouses))
  setText(statusValue, statusLabel(currentLocale, engine.state.status))
  setText(modeValue, modeLabel(currentLocale, engine.map.sourceMode))

  if (engine.state.status === 'win') {
    setMessageKey('message.win')
  } else if (engine.state.status === 'gameover') {
    setMessageKey('message.gameover')
  } else if (engine.state.status === 'dying') {
    setMessageKey('message.dying')
  } else if (engine.state.status === 'paused') {
    setMessageKey('message.paused')
  } else if (engine.state.status === 'preview') {
    setMessageKey('message.preview')
  } else if (engine.state.currentHouseAction) {
    setMessageKey(
      engine.state.currentHouseAction.type === 'check' ? 'message.checking' : 'message.claiming',
      { progress: Math.round(engine.state.currentHouseAction.progress * 100) },
    )
  } else {
    setMessageKey('message.playing')
  }
}

function stopLoop(): void {
  cancelAnimationFrame(animationFrame)
}

function drawCurrentFrame(): void {
  if (!engine && playableMap) {
    renderer.renderPreview(playableMap, (point) => mapController.project(point))
    return
  }
  if (engine) {
    renderer.renderGame(engine, (point) => mapController.project(point))
  }
}

function processEngineEvents(): void {
  if (!engine) {
    return
  }
  for (const event of engine.drainEvents()) {
    audio.playEvent(event)
    if (event.type === 'gameover' || event.type === 'win' || event.type === 'lose-life') {
      audio.setAmbience(false)
    }
  }
}

function loop(timestamp: number): void {
  if (!engine) {
    return
  }
  engine.tick(timestamp)
  processEngineEvents()
  drawCurrentFrame()
  syncHud()
  animationFrame = requestAnimationFrame(loop)
}

function startLoop(): void {
  stopLoop()
  animationFrame = requestAnimationFrame(loop)
}

async function handleSearch(): Promise<void> {
  const query = searchInput.value.trim()
  if (!query) {
    setMessageKey('message.noQuery')
    return
  }

  setMessageKey('message.searching')
  searchResults.innerHTML = ''
  try {
    const results = await searchPlaces(query)
    if (results.length === 0) {
      setMessageKey('message.noResults')
      return
    }

    for (const result of results) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'result'
      button.textContent = result.label
      button.addEventListener('click', () => {
        mapController.flyTo(result.lng, result.lat)
        scheduleMovedMessage(result.label)
      })
      searchResults.append(button)
    }
  } catch {
    setMessageKey('message.searchFailed')
  }
}

async function handlePresetSelect(): Promise<void> {
  const selected = presetSelect.value
  if (!selected) {
    return
  }
  const preset = addressPresets[Number(selected)]
  if (!preset) {
    return
  }

  setMessageKey('message.loadingPreset', { label: preset.label })
  if (typeof preset.lat === 'number' && typeof preset.lng === 'number') {
    mapController.flyTo(preset.lng, preset.lat)
    scheduleMovedMessage(preset.label)
    presetSelect.value = ''
    return
  }

  if (!preset.query) {
    presetSelect.value = ''
    return
  }

  try {
    const results = await searchPlaces(preset.query)
    const target = results[0]
    if (!target) {
      setMessageKey('message.noResults')
      return
    }
    mapController.flyTo(target.lng, target.lat)
    scheduleMovedMessage(preset.label)
  } catch {
    setMessageKey('message.searchFailed')
  } finally {
    presetSelect.value = ''
  }
}

async function generateMaze(): Promise<void> {
  if (!selectedBorough) {
    setMessageKey('message.boroughNeeded', { name: LOCKED_BOROUGH_NAME })
    return
  }

  setMessageKey('message.loading')
  setGenerating(true)
  stopLoop()
  audio.setAmbience(false)
  mapController.clearBoroughLayers()
  boroughBanner.classList.add('hidden')
  try {
    setLoadingStep('map', 'loading.status.map')
    const viewport = expandViewportForMaze(mapController.getViewport())
    await new Promise<void>((resolve) => window.setTimeout(resolve, 180))

    setLoadingStep('roads', 'loading.status.roads')
    const roadData = await fetchRoadData(viewport.bounds)

    setLoadingStep('houses', 'loading.status.houses')
    playableMap = generatePlayableMap(viewport, roadData, {
      pelletDensity: Number(pelletInput.value),
    })
    mapController.resize()
    mapController.fitToPoints(playableMap.nodes)
    engine = new GameEngine(playableMap)
    applySpeed()
    drawCurrentFrame()
    syncHud()

    setLoadingStep('ready', 'loading.status.ready')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 650))

    window.setTimeout(() => {
      mapController.resize()
      if (playableMap) {
        mapController.fitToPoints(playableMap.nodes)
      }
      drawCurrentFrame()
    }, 360)
    const fittedZoom = mapController.getZoom()
    if (fittedZoom < RECOMMENDED_ZOOM_MIN) {
      setMessageKey('message.generatedWide', {
        mode: modeLabel(currentLocale, playableMap.sourceMode).toLowerCase(),
        zoom: fittedZoom.toFixed(1),
      })
    } else {
      setMessageKey('message.generated', { mode: modeLabel(currentLocale, playableMap.sourceMode).toLowerCase() })
    }
  } catch {
    setMessageKey('message.generateFailed')
  } finally {
    setGenerating(false)
  }
}

async function play(): Promise<void> {
  if (!engine) {
    setMessageKey('message.generateFirst')
    return
  }

  renderLoadingCopy()
  loadingIndicator.classList.remove('hidden')
  setLoadingStep('ready', 'loading.status.start')
  loadingProgressBar.style.width = '100%'
  playButton.disabled = true
  await new Promise<void>((resolve) => window.setTimeout(resolve, 900))

  await audio.unlock()
  engine.start()
  audio.setAmbience(true)
  startLoop()
  processEngineEvents()
  syncHud()
  loadingIndicator.classList.add('hidden')
  playButton.disabled = false
}

function pause(): void {
  if (!engine) {
    return
  }
  engine.pause()
  audio.setAmbience(engine.state.status === 'playing')
  syncHud()
}

function restart(): void {
  if (!engine) {
    return
  }
  engine.restart()
  audio.setAmbience(false)
  drawCurrentFrame()
  syncHud()
}

async function handleDirection(direction: Direction): Promise<void> {
  if (!engine) {
    return
  }
  await audio.unlock()
  engine.setDirection(direction)
  if (engine.state.status === 'playing') {
    audio.setAmbience(true)
  }
  startLoop()
  processEngineEvents()
  syncHud()
}

searchButton.addEventListener('click', () => {
  void handleSearch()
})

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    void handleSearch()
  }
})

generateButton.addEventListener('click', () => {
  void generateMaze()
})
playButton.addEventListener('click', () => {
  void play()
})
pauseButton.addEventListener('click', pause)
restartButton.addEventListener('click', restart)
speedInput.addEventListener('input', applySpeed)
pelletInput.addEventListener('input', applyPelletDensity)
presetSelect.addEventListener('change', () => {
  void handlePresetSelect()
})
boroughConfirmButton.addEventListener('click', () => {
  selectTowerHamlets()
})
localeSelect.addEventListener('change', () => {
  currentLocale = localeSelect.value === 'zh-TW' ? 'zh-TW' : 'en'
  saveLocale(currentLocale)
  renderLocale()
  renderBoroughBanner()
})

window.addEventListener('keydown', (event) => {
  if (document.querySelector("input:focus") !== null) return

  const mapKey: Record<string, Direction> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    W: 'up',
    s: 'down',
    S: 'down',
    a: 'left',
    A: 'left',
    d: 'right',
    D: 'right',
  }

  const direction = mapKey[event.key]
  if (!direction) {
    return
  }

  event.preventDefault()
  void handleDirection(direction)
})

function syncMapLayout(): void {
  mapController.resize()
  drawCurrentFrame()
}

window.addEventListener('resize', syncMapLayout)

await mapController.ready()
addressPresets = await loadAddressPresets()
applySpeed()
applyPelletDensity()
renderLocale()
mapController.onViewChange(() => {
  updateGenerateButtonHint()
  if (!engine && selectedBorough && !boroughIntroActive) {
    refreshViewportMessage()
  }
  drawCurrentFrame()
})
syncHud()
requestAnimationFrame(() => {
  syncMapLayout()
})
await startBoroughIntro()
