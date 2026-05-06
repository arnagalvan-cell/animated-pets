const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petAPI', {
  getConfig:    () => ipcRenderer.invoke('get-config'),
  getState:     () => ipcRenderer.invoke('get-state'),
  addClick:     () => ipcRenderer.send('add-click'),
  spendClicks:  (n) => ipcRenderer.invoke('spend-clicks', n),
  unlockSkin:   (id) => ipcRenderer.send('unlock-skin', id),
  setSkin:      (id) => ipcRenderer.send('set-skin', id),
  openShop:     () => ipcRenderer.send('open-shop'),
  saveScale:    (s) => ipcRenderer.send('save-scale', s),

  onClicksUpdated:      (cb) => ipcRenderer.on('clicks-updated',       (_, v) => cb(v)),
  onSetOpacity:         (cb) => ipcRenderer.on('set-opacity',           (_, v) => cb(v)),
  onSetScale:           (cb) => ipcRenderer.on('set-scale',             (_, v) => cb(v)),
  onSetSkin:            (cb) => ipcRenderer.on('set-skin',              (_, v) => cb(v)),
  onStateUpdated:       (cb) => ipcRenderer.on('state-updated',         (_, v) => cb(v)),
  onApplySeasonalSkin:  (cb) => ipcRenderer.on('apply-seasonal-skin',   (_, v) => cb(v)),
  onRemoveSeasonalSkin: (cb) => ipcRenderer.on('remove-seasonal-skin',  ()    => cb()),
  onReloadClickSound:   (cb) => ipcRenderer.on('reload-click-sound',    (_, v) => cb(v)),
})
