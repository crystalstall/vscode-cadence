/* The extension */
import { EmulatorState, EmulatorController } from './emulator/emulator-controller'
import { CommandController } from './commands/command-controller'
import { refreshCodeLenses } from './utils/codelens'
import { Account } from './emulator/account'
import { UIController } from './ui/ui-controller'
import { ExtensionContext } from 'vscode'
import { DEBUG_LOG } from './utils/debug'
import { DependencyInstaller } from './dependency-installer/dependency-installer'
import { Settings } from './settings/settings'

// The container for all data relevant to the extension.
export class Extension {
  // The extension singleton
  static #instance: Extension
  static initialized = false

  static initialize (ctx: ExtensionContext): Extension {
    Extension.#instance = new Extension(ctx)
    Extension.initialized = true
    return Extension.#instance
  }

  ctx: ExtensionContext
  #dependencyInstaller: DependencyInstaller
  #uiCtrl: UIController
  #commands: CommandController
  emulatorCtrl: EmulatorController

  private constructor (ctx: ExtensionContext) {
    this.ctx = ctx

    // Initialize UI
    this.#uiCtrl = new UIController()

    // Check for any missing dependencies
    this.#dependencyInstaller = new DependencyInstaller()

    // Initialize Emulator
    const settings = Settings.getWorkspaceSettings()
    this.emulatorCtrl = new EmulatorController(settings)

    // Initialize ExtensionCommands
    this.#commands = new CommandController()
  }

  // Called on exit
  async deactivate (): Promise<void> {
    try {
      this.emulatorCtrl.deactivate()
    } catch (err) {
      if (err instanceof Error) {
        DEBUG_LOG('Extension deactivate error: ' + err.message)
      }
      DEBUG_LOG('Extension deactivate error: unknown')
    }
  }

  getEmulatorState (): EmulatorState {
    return this.emulatorCtrl.getState()
  }

  getActiveAccount (): Account | null {
    return this.emulatorCtrl.getActiveAccount()
  }

  async emulatorStateChanged (): Promise<void> {
    // Sync emulator with LS
    await this.emulatorCtrl.syncEmulatorState()

    // Update UI
    this.#uiCtrl.emulatorStateChanged()
    refreshCodeLenses()
  }

  checkDependencies (): void {
    this.#dependencyInstaller.checkDependencies()
  }

  installMissingDependencies (): void {
    this.#dependencyInstaller.installMissing()
  }
}
