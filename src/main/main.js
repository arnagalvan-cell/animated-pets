const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, net, dialog } = require('electron')
const path = require('path')
const Store = require('electron-store')
const fs = require('fs')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.exit(0) }

const store = new Store()
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../pet-config.json'), 'utf8'))

let petWindow = null
let shopWindow = null
let tray = null
let SKINS_DIR = null

// ============================================
// SEASONAL SKINS SYSTEM
// When you have GitHub ready, replace this URL
// with your actual GitHub Pages URL
// ============================================
const SKINS_SERVER_URL = 'https://arnagalvan-cell.github.io/animated-pets/skins.json'
const SOUND_CONFIG_URL = 'https://arnagalvan-cell.github.io/animated-pets/sound-config.json'
const SOUND_BASE_URL   = 'https://arnagalvan-cell.github.io/animated-pets/'
const VERSION_URL     = 'https://arnagalvan-cell.github.io/animated-pets/app-version.json'
const RAW_BASE_URL    = 'https://raw.githubusercontent.com/arnagalvan-cell/animated-pets/main'
const LOCAL_VERSION_FILE = path.join(__dirname, 'version.json')

function getLocalVersion() {
  try {
    if (fs.existsSync(LOCAL_VERSION_FILE)) {
      return JSON.parse(fs.readFileSync(LOCAL_VERSION_FILE, 'utf8')).version || '0.0.0'
    }
  } catch(e) {}
  return '0.0.0'
}

function saveLocalVersion(version) {
  fs.writeFileSync(LOCAL_VERSION_FILE, JSON.stringify({ version }, null, 2))
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    let data = ''
    req.on('response', res => {
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.end()
  })
}

function httpGetBinary(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    const chunks = []
    req.on('response', res => {
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.end()
  })
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i]||0) > (pb[i]||0)) return 1
    if ((pa[i]||0) < (pb[i]||0)) return -1
  }
  return 0
}

async function checkForUpdates() {
  try {
    // 1. Get remote version info
    const remoteJson = await httpGet(VERSION_URL)

    // Validate response is actual JSON, not a 404 page
    if (!remoteJson || remoteJson.trim().startsWith('<') || remoteJson.includes('404')) {
      console.log('Auto-update: version file not available yet')
      return
    }

    const remote = JSON.parse(remoteJson)
    const localVersion = getLocalVersion()

    // Only update if remote version is strictly greater
    if (compareVersions(remote.version, localVersion) <= 0) return

    console.log(`Update available: ${localVersion} → ${remote.version}`)

    // 2. Download each file silently — validate before overwriting
    const appDir = path.join(__dirname, '../../')
    let allOk = true
    const downloads = []

    for (const filePath of remote.files) {
      try {
        const fileUrl = `${RAW_BASE_URL}/${filePath}`
        const data = await httpGetBinary(fileUrl)

        // Validate — reject if response looks like an error page
        const preview = data.slice(0, 100).toString('utf8')
        if (preview.includes('404') || preview.includes('Not Found') || preview.trim().startsWith('<')) {
          console.log(`Skipping ${filePath} — invalid response`)
          allOk = false
          continue
        }

        downloads.push({ destPath: path.join(appDir, filePath), data })
        console.log(`Downloaded: ${filePath}`)
      } catch(e) {
        console.log(`Failed to download ${filePath}:`, e.message)
        allOk = false
      }
    }

    // 3. Only write files if all downloads succeeded
    if (downloads.length === 0) return

    for (const { destPath, data } of downloads) {
      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(destPath, data)
    }

    // 4. Save new version and relaunch
    saveLocalVersion(remote.version)
    app.relaunch()
    app.exit(0)

  } catch(e) {
    console.log('Auto-update check failed silently:', e.message)
  }
}

function getState() {
  return {
    x:             store.get('x', null),
    y:             store.get('y', null),
    corner:        store.get('corner', 'bottom-right'),
    scale:         store.get('scale', 1.0),
    opacity:       store.get('opacity', 1.0),
    clicks:        store.get('clicks', 0),
    skin:          store.get('skin', 'default'),
    unlockedSkins: store.get('unlockedSkins', ['default']),
    visible:       store.get('visible', true),
  }
}

async function checkLicenseKey() {
  const licenseKey = config.pet.licenseKey
  if (!licenseKey) return true // No key configured, allow

  const activatedKey = store.get('activated_key', '')
  if (activatedKey === licenseKey) return true // Already activated

  // Ask for license key
  const result = await dialog.showInputBox ? 
    dialog.showInputBox(null, { title: 'License Key', message: 'Enter your 6-character license key:', type: 'question' }) :
    null

  // Use custom dialog via BrowserWindow
  return new Promise((resolve) => {
    const keyWin = new BrowserWindow({
      width: 400, height: 220,
      frame: true,
      resizable: false,
      alwaysOnTop: true,
      title: 'License Key',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    keyWin.loadURL('data:text/html,' + encodeURIComponent(`
      <html><head><style>
        body { font-family: system-ui; padding: 20px; background: #f0f4f8; margin:0; }
        h3 { color: #0067c0; margin-bottom:8px; }
        p { font-size:13px; color:#444; margin-bottom:16px; }
        input { width:100%; padding:10px; font-size:18px; letter-spacing:6px; text-align:center; border:1px solid #b8ccdf; border-radius:8px; box-sizing:border-box; text-transform:uppercase; }
        button { width:100%; margin-top:12px; padding:10px; background:#0067c0; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:700; cursor:pointer; }
        #err { color:red; font-size:12px; margin-top:6px; min-height:16px; text-align:center; }
      </style></head><body>
        <h3>🔑 License Key</h3>
        <p>Enter your 6-character license key to activate your pet.</p>
        <input id="k" maxlength="6" placeholder="XXXXXX" autofocus>
        <div id="err"></div>
        <button onclick="check()">Activate</button>
        <script>
          const { ipcRenderer } = require('electron')
          document.getElementById('k').addEventListener('keydown', e => { if(e.key==='Enter') check() })
          function check() {
            const v = document.getElementById('k').value.trim().toUpperCase()
            ipcRenderer.send('check-key', v)
          }
          ipcRenderer.on('key-invalid', () => {
            document.getElementById('err').textContent = 'Invalid key. Please try again.'
            document.getElementById('k').value = ''
            document.getElementById('k').focus()
          })
        </script>
      </body></html>
    `))
    keyWin.on('close', () => resolve(false))

    const { ipcMain: ipc } = require('electron')
    const handler = (_, key) => {
      if (key === licenseKey) {
        store.set('activated_key', key)
        ipc.removeListener('check-key', handler)
        keyWin.close()
        resolve(true)
      } else {
        keyWin.webContents.send('key-invalid')
      }
    }
    ipc.on('check-key', handler)
  })
}

function createPetWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const state = getState()

  // Window size based on displayHeight — make it generous so all sprites fit
  const petH = Math.round(config.pet.displayHeight * state.scale)
  // Use the widest animation ratio to ensure nothing gets clipped
  const allAnims = Object.values(config.pet.animations)
  const maxRatio = Math.max(...allAnims.map(a => a.frameWidth / a.frameHeight))
  const petW = Math.round(petH * maxRatio)

  const startX = state.x !== null ? state.x : sw - petW - 10
  const startY = state.y !== null ? state.y : sh - petH - 10

  petWindow = new BrowserWindow({
    x: startX,
    y: startY,
    width: petW + 4,
    height: petH + 4,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
    }
  })

  petWindow.setIgnoreMouseEvents(false)
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  petWindow.setAlwaysOnTop(true, 'screen-saver')
  petWindow.loadFile(path.join(__dirname, '../renderer/pet.html'))

  petWindow.once('ready-to-show', () => {
    if (store.get('visible', true)) petWindow.show()
  })

  petWindow.on('moved', () => {
    const [x, y] = petWindow.getPosition()
    store.set('x', x)
    store.set('y', y)
    // Reafirmar always on top al cambiar de monitor
    petWindow.setAlwaysOnTop(true, 'screen-saver')
  })

  petWindow.on('close', () => {
    app.exit(0)
  })
}

function createShopWindow() {
  if (shopWindow && !shopWindow.isDestroyed()) { shopWindow.focus(); return }
  shopWindow = new BrowserWindow({
    width: 480, height: 620,
    title: `Animated Pets Studio`,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  })
  shopWindow.loadFile(path.join(__dirname, '../renderer/shop.html'))
  shopWindow.on('closed', () => { shopWindow = null })
}

function createTray() {
  let icon
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icons/icon.png'))
    if (icon.isEmpty()) throw new Error('empty')
    icon = icon.resize({ width: 16, height: 16 })
  } catch { icon = nativeImage.createEmpty() }
  tray = new Tray(icon)
  tray.setToolTip(config.pet.name)
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  const state = getState()
  const menu = Menu.buildFromTemplate([
    { label: `🐾 ${config.pet.name}`, enabled: false },
    { label: `Clicks: ${state.clicks}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Position',
      submenu: ['bottom-right','bottom-left','top-right','top-left'].map(c => ({
        label: {'bottom-right':'Bottom Right','bottom-left':'Bottom Left','top-right':'Top Right','top-left':'Top Left'}[c],
        type: 'radio', checked: state.corner === c,
        click: () => { store.set('corner', c); store.set('x', null); store.set('y', null); repositionPet(c); updateTrayMenu() }
      }))
    },
    {
      label: 'Size',
      submenu: [0.5, 0.75, 1.0, 1.25, 1.5].map(s => ({
        label: `${Math.round(s * 100)}%`, type: 'radio',
        checked: Math.abs(state.scale - s) < 0.01,
        click: () => { store.set('scale', s); resizePet(s); updateTrayMenu() }
      }))
    },
    {
      label: 'Opacity',
      submenu: [0.3, 0.5, 0.75, 1.0].map(o => ({
        label: `${Math.round(o * 100)}%`, type: 'radio',
        checked: Math.abs(state.opacity - o) < 0.01,
        click: () => { store.set('opacity', o); petWindow?.webContents.send('set-opacity', o); updateTrayMenu() }
      }))
    },
    { type: 'separator' },
    {
      label: state.visible ? 'Hide Pet' : 'Show Pet',
      click: () => {
        const v = !store.get('visible', true)
        store.set('visible', v)
        if (v) { petWindow?.show() } else { petWindow?.hide() }
        updateTrayMenu()
      }
    },
    { label: '🛍️ Skins Shop', click: () => createShopWindow() },
    { label: '🎨 Check for Skins', click: () => {
        // Reset all declined flags so user gets prompted again
        const keys = store.store
        Object.keys(keys).forEach(k => { if (k.startsWith('skin_declined_')) store.delete(k) })
        checkSeasonalSkins()
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) }
  ])
  tray.setContextMenu(menu)
}

function repositionPet(corner) {
  if (!petWindow) return
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const [pw, ph] = petWindow.getSize()
  const pos = { 'bottom-right':{x:sw-pw,y:sh-ph}, 'bottom-left':{x:0,y:sh-ph}, 'top-right':{x:sw-pw,y:0}, 'top-left':{x:0,y:0} }
  petWindow.setPosition(pos[corner].x, pos[corner].y)
}

function resizePet(scale) {
  if (!petWindow) return
  const petH = Math.round(config.pet.displayHeight * scale)
  const allAnims = Object.values(config.pet.animations)
  const maxRatio = Math.max(...allAnims.map(a => a.frameWidth / a.frameHeight))
  const petW = Math.round(petH * maxRatio)
  petWindow.setSize(petW + 4, petH + 4)
  petWindow.webContents.send('set-scale', scale)
}

ipcMain.handle('get-config', () => ({ ...config, appPath: path.join(__dirname, '../../').replace(/\\/g, '/') }))
ipcMain.handle('get-state',  () => getState())
ipcMain.on('add-click', () => {
  const clicks = store.get('clicks', 0) + 1
  store.set('clicks', clicks)
  petWindow?.webContents.send('clicks-updated', clicks)
  updateTrayMenu()
})
ipcMain.on('unlock-skin', (_, id) => {
  const u = store.get('unlockedSkins', ['default'])
  if (!u.includes(id)) { u.push(id); store.set('unlockedSkins', u) }
  shopWindow?.webContents.send('state-updated', getState())
})
ipcMain.on('set-skin', (_, id) => {
  store.set('skin', id)
  petWindow?.webContents.send('set-skin', id)
  shopWindow?.webContents.send('state-updated', getState())
})
ipcMain.handle('spend-clicks', (_, amount) => {
  const clicks = store.get('clicks', 0)
  if (clicks < amount) return false
  store.set('clicks', clicks - amount)
  petWindow?.webContents.send('clicks-updated', clicks - amount)
  updateTrayMenu()
  return true
})
ipcMain.on('open-shop', () => createShopWindow())
ipcMain.on('save-scale', (_, s) => { store.set('scale', s); updateTrayMenu() })

async function checkClickSound() {
  try {
    const configJson = await httpGet(SOUND_CONFIG_URL)
    if (!configJson || configJson.trim().startsWith('<') || configJson.includes('404')) return

    const soundConfig = JSON.parse(configJson)
    if (!soundConfig.file) return

    const soundFile = soundConfig.file
    const ext = path.extname(soundFile)
    const localSoundPath = path.join(SKINS_DIR, 'click_sound' + ext)
    const localConfigPath = path.join(SKINS_DIR, 'sound-config.json')

    // Descargar siempre y comparar por hash para detectar cambios de contenido
    const soundData = await httpGetBinary(SOUND_BASE_URL + soundFile)
    const preview = soundData.slice(0, 10).toString('utf8')
    if (preview.includes('404') || preview.trim().startsWith('<')) return

    // Calcular hash del nuevo sonido
    const crypto = require('crypto')
    const newHash = crypto.createHash('md5').update(soundData).digest('hex')

    // Comparar con hash local
    const localConfig = fs.existsSync(localConfigPath)
      ? JSON.parse(fs.readFileSync(localConfigPath, 'utf8'))
      : {}

    if (localConfig.hash === newHash && fs.existsSync(localSoundPath)) return // Sin cambios

    // Guardar nuevo sonido
    fs.writeFileSync(localSoundPath, soundData)
    fs.writeFileSync(localConfigPath, JSON.stringify({ file: soundFile, hash: newHash }))

    // Notificar al renderer
    petWindow?.webContents.send('reload-click-sound', {
      soundPath: localSoundPath.replace(/\\/g, '/')
    })
    console.log('Click sound updated:', soundFile)
  } catch(e) {
    console.log('Sound check failed silently:', e.message)
  }
}

async function checkSeasonalSkins() {
  try {
    if (SKINS_SERVER_URL.includes('YOUR_USERNAME')) return

    const response = await new Promise((resolve, reject) => {
      const req = net.request(SKINS_SERVER_URL)
      let data = ''
      req.on('response', (res) => {
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve(data))
      })
      req.on('error', reject)
      req.end()
    })

    const skinsData = JSON.parse(response)
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`
    const todayMMDD = `${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`

    // ============================================
    // CUMPLEAÑOS — máxima prioridad
    // ============================================
    const birthdayMMDD = config.pet.birthdayMMDD || null
    const isBirthday = birthdayMMDD && todayMMDD === birthdayMMDD
    const birthdaySkin = skinsData.skins.find(s => s.id === 'birthday' && s.active)
    const birthdayApplied = store.get('birthday_applied_date', '') === today
    const wasBirthdayActive = store.get('birthday_was_active', false)

    if (isBirthday && birthdaySkin && !birthdayApplied) {
      // Mostrar popup de cumpleaños antes de aplicar el skin
      await dialog.showMessageBox(petWindow, {
        type: 'info',
        title: '🎂 Happy Birthday!',
        message: '🎉 Happy Birthday! 🎂\n\nWe have a special surprise for you!',
        buttons: ['OK'],
        defaultId: 0,
        icon: path.join(__dirname, '../../assets/icons/icon.png')
      })
      // Guardar el skin de festividad actual para restaurarlo mañana
      const currentSkin = store.get('active_seasonal_skin')
      if (currentSkin && currentSkin !== 'birthday') {
        store.set('skin_before_birthday', currentSkin)
      }
      await downloadSeasonalSkin(birthdaySkin, true) // silent=true
      store.set('birthday_applied_date', today)
      store.set('birthday_was_active', true)
      return // No procesar más skins hoy
    }

    if (!isBirthday && wasBirthdayActive) {
      // Ayer era cumpleaños, hoy ya no → quitar el skin de cumpleaños sin preguntar
      store.set('birthday_was_active', false)
      store.delete('birthday_applied_date')
      store.delete('active_seasonal_skin')
      store.delete('skin_downloaded_birthday')
      petWindow?.webContents.send('remove-seasonal-skin')

      // Restaurar el skin de festividad que estaba antes del cumpleaños
      const skinBeforeBirthday = store.get('skin_before_birthday')
      store.delete('skin_before_birthday')
      if (skinBeforeBirthday) {
        const festiveSkin = skinsData.skins.find(s => s.id === skinBeforeBirthday && s.active && today >= s.start && today <= s.end)
        if (festiveSkin) {
          await downloadSeasonalSkin(festiveSkin, true) // silent=true, re-aplicar
        }
      }
      return
    }

    // Si hoy es cumpleaños y ya se aplicó el birthday skin → no tocar nada más
    if (isBirthday && birthdayApplied) return

    // ============================================
    // SKINS NORMALES
    // ============================================

    // VERIFICACIÓN EXTRA: si el skin activo local ya no existe en el JSON o venció → quitarlo
    const activeSkinId = store.get('active_seasonal_skin')
    if (activeSkinId && activeSkinId !== 'birthday') {
      const skinStillValid = skinsData.skins.some(s =>
        s.id === activeSkinId && s.active && today >= s.start && today <= s.end
      )
      if (!skinStillValid) {
        store.delete('active_seasonal_skin')
        store.delete(`skin_downloaded_${activeSkinId}`)
        petWindow?.webContents.send('remove-seasonal-skin')
      }
    }

    for (const skin of skinsData.skins) {
      if (skin.id === 'birthday') continue // El birthday se maneja arriba
      const isActive = skin.active && today >= skin.start && today <= skin.end
      const alreadyDownloaded = store.get(`skin_downloaded_${skin.id}`, false)
      const isCurrentSkin = store.get('active_seasonal_skin') === skin.id

      // REGLA 1: Si el skin fue retirado o venció → quitarlo sin preguntar
      if (!isActive && isCurrentSkin) {
        store.delete('active_seasonal_skin')
        store.delete(`skin_downloaded_${skin.id}`)
        petWindow?.webContents.send('remove-seasonal-skin')
        continue
      }

      // REGLA 2: Si el skin está activo y no descargado → preguntar
      if (isActive && !alreadyDownloaded) {
        const result = await dialog.showMessageBox(petWindow, {
          type: 'question',
          title: 'New Skin Available!',
          message: `🎉 ${skin.name} skin is available!\n\nWould you like to download it?`,
          buttons: ['Yes, Download', 'Not Now'],
          defaultId: 0,
          cancelId: 1,
          icon: path.join(__dirname, '../../assets/icons/icon.png')
        })
        if (result.response === 0) {
          await downloadSeasonalSkin(skin, false)
        }
      }

      // REGLA 3: Si el skin está activo, descargado y es el activo → re-aplicar
      if (isActive && alreadyDownloaded && isCurrentSkin) {
        const overlayPath = path.join(SKINS_DIR, skin.id, 'overlay.png')
        const configPath  = path.join(SKINS_DIR, skin.id, 'config.json')
        if (fs.existsSync(overlayPath) && fs.existsSync(configPath)) {
          try {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'))
            petWindow?.webContents.send('apply-seasonal-skin', {
              overlayPath: overlayPath.replace(/\\/g, '/'),
              config: configData
            })
          } catch(e) {}
        }
      }
    }
  } catch (e) {
    console.log('Skin check failed silently:', e.message)
  }
}

async function downloadSeasonalSkin(skin, silent = false) {
  try {
    const skinDir = path.join(SKINS_DIR, skin.id)
    if (!fs.existsSync(skinDir)) fs.mkdirSync(skinDir, { recursive: true })

    const overlayPath = path.join(skinDir, 'overlay.png')
    await downloadFile(`${skin.url}overlay.png`, overlayPath)

    const configData = await new Promise((resolve, reject) => {
      const req = net.request(`${skin.url}config.json`)
      let data = ''
      req.on('response', res => {
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve(JSON.parse(data)))
      })
      req.on('error', reject)
      req.end()
    })

    fs.writeFileSync(path.join(skinDir, 'config.json'), JSON.stringify(configData))
    store.set(`skin_downloaded_${skin.id}`, true)
    store.set('active_seasonal_skin', skin.id)

    petWindow?.webContents.send('apply-seasonal-skin', {
      overlayPath: overlayPath.replace(/\\/g, '/'),
      config: configData
    })

    if (!silent) {
      dialog.showMessageBox(petWindow, {
        type: 'info',
        title: 'Skin Downloaded!',
        message: `✅ ${skin.name} skin applied successfully!`,
        buttons: ['Great!']
      })
    }

  } catch(e) {
    console.log('Skin download failed:', e.message)
  }
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    req.on('response', res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        fs.writeFileSync(dest, Buffer.concat(chunks))
        resolve()
      })
    })
    req.on('error', reject)
    req.end()
  })
}

app.whenReady().then(async () => {
  SKINS_DIR = path.join(app.getPath('userData'), 'seasonal_skins')
  const activated = await checkLicenseKey()
  if (!activated) { app.exit(0); return }
  createPetWindow()
  createTray()
  // Al arrancar: cargar sonido — primero buscar bundled en assets, luego caché local
  setTimeout(() => {
    // 1. Sonido incluido en el instalador (assets/click_sound.*)
    const appDir = path.join(__dirname, '..', '..')  // resources/app
    const exts = ['.mp3', '.wav', '.ogg']
    let bundledSound = null
    for (const ext of exts) {
      const p = path.join(appDir, 'assets', 'click_sound' + ext)
      if (fs.existsSync(p)) { bundledSound = p; break }
    }
    if (bundledSound) {
      petWindow?.webContents.send('reload-click-sound', {
        soundPath: bundledSound.replace(/\\/g, '/')
      })
      return
    }
    // 2. Fallback: caché local descargado de GitHub
    const localConfigPath = path.join(SKINS_DIR, 'sound-config.json')
    if (fs.existsSync(localConfigPath)) {
      try {
        const sc = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'))
        const ext = path.extname(sc.file || '.mp3')
        const localSoundPath = path.join(SKINS_DIR, 'click_sound' + ext)
        if (fs.existsSync(localSoundPath)) {
          petWindow?.webContents.send('reload-click-sound', {
            soundPath: localSoundPath.replace(/\\/g, '/')
          })
        }
      } catch(e) {}
    }
  }, 2000)

  // Al arrancar: verificar actualizaciones, sonido y skins
  setTimeout(async () => {
    await checkForUpdates()
    await checkClickSound()
    checkSeasonalSkins()
  }, 3000)
})

app.on('activate', () => { if (!petWindow) createPetWindow() })
