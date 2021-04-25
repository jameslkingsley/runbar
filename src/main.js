require('fix-path')()

const { app, BrowserWindow, Menu, Tray, nativeImage, dialog } = require('electron')
const settings = require('electron-app-settings')
const { spawn } = require('child_process')
const { readdirSync, readFileSync, existsSync } = require('fs')
const path = require('path')

if (!app.isPackaged) {
    require('electron-reload')(__dirname, {
        electron: path.join(__dirname, '../node_modules', '.bin', 'electron')
    })
}

if (settings.get('openAtLogin') === null) {
    settings.set('openAtLogin', true)
}

const openOnStartup = () => {
    if (!app.isPackaged) return

    app.setLoginItemSettings({
        openAtLogin: settings.get('openAtLogin'),
        openAsHidden: true,
    })
}

app.dock.hide()
openOnStartup()

let container = {
    processes: []
}

const determineNodeScripts = (packageJsonPath) => {
    try {
        const data = JSON.parse(
            readFileSync(packageJsonPath, 'utf8')
        )

        return Object.keys(data.scripts || {})
    } catch (_) {
        return []
    }
}

const projects = () => {
    const root = settings.get('projectsRoot')

    if (root === null) return []

    return readdirSync(root, { withFileTypes: true })
        .filter(dir => existsSync(path.join(root, dir.name, 'package.json')))
        .filter(dir => !existsSync(path.join(root, dir.name, '.runbarignore')))
        .map(dir => ({
            name: dir.name,
            path: path.join(root, dir.name),
            scripts: determineNodeScripts(path.join(root, dir.name, 'package.json'))
        }))
        .filter(project => project.scripts.length > 0)
}

const attachProcessHandlers = process => {
    // process.stdout.on('data', (data) => {})
    // process.stderr.on('data', (data) => {})
    // process.on('close', (code) => {})
    return process
}

const mapProjectToMenuItem = project => ({
    label: project.name,
    submenu: project.scripts.map(command => ({
        label: command,
        click: (item, window, event) => {
            container.processes.push({
                name: `${project.name}:${command}`,
                process: attachProcessHandlers(
                    spawn('npm', ['run', command], {
                        cwd: project.path
                    })
                )
            })

            rebuildContextMenu()
        }
    })),
})

const runningProcesses = () => {
    const items = container.processes.map(({ name, process }, index) => ({
        label: name,
        type: 'checkbox',
        checked: true,
        click: (item, window, event) => {
            process.kill()
            container.processes.splice(index, 1)
            rebuildContextMenu()
        }
    }))

    return items.length > 0
        ? [...items, { type: 'separator' }] : []
}

const killAllProcesses = () => {
    container.processes.forEach(
        ({ process }) => process.kill()
    )

    container.processes = []
    rebuildContextMenu()
}

const determineTrayTitle = () => {
    if (container.processes.length === 0) return 'Run'

    if (container.processes.length > 1) return `Running (${container.processes.length})`

    return container.processes[0].name
}

const rebuildContextMenu = () => {
    container.tray.setContextMenu(
        Menu.buildFromTemplate([
            ...runningProcesses(),
            ...projects().map(project => mapProjectToMenuItem(project)),
            { type: 'separator' },
            {
                label: 'Choose Folder',
                click: (item, window, event) => {
                    const filePaths = dialog.showOpenDialogSync({
                        defaultPath: '~/Documents',
                        properties: ['openDirectory']
                    })

                    if (!filePaths) {
                        return
                    }

                    settings.set('projectsRoot', filePaths[0])
                    rebuildContextMenu()
                }
            },
            {
                type: 'checkbox',
                label: 'Open on startup',
                checked: settings.get('openAtLogin'),
                click: (item) => {
                    let enabled = settings.get('openAtLogin')

                    enabled = !enabled
                    item.checked = enabled

                    settings.set('openAtLogin', enabled)
                    openOnStartup()
                }
            },
            {
                label: 'Stop All',
                click: () => killAllProcesses()
            },
            { role: 'quit', label: 'Quit' },
        ])
    )

    container.tray.setTitle(determineTrayTitle())
}

app.whenReady().then(() => {
    container.tray = new Tray(nativeImage.createEmpty())

    rebuildContextMenu()

    container.tray.setIgnoreDoubleClickEvents(true)
})

app.on('before-quit', event => {
    killAllProcesses()
    container = null
})

app.on('window-all-closed', () => {
    app.quit()
})
