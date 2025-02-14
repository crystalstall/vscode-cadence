/* Installer for Flow CLI */
import { window } from 'vscode'
import { execVscodeTerminal, tryExecPowerShell, tryExecUnixDefault } from '../../utils/shell/exec'
import { promptUserInfoMessage, promptUserErrorMessage } from '../../ui/prompts'
import { Installer, InstallerConstructor, InstallerContext } from '../installer'
import * as semver from 'semver'
import fetch from 'node-fetch'
import { HomebrewInstaller } from './homebrew-installer'
import { KNOWN_FLOW_COMMANDS } from '../../flow-cli/cli-versions-provider'

// Relevant subset of Homebrew formulae JSON
interface HomebrewVersionInfo {
  versions: {
    stable: string
  }
}

// Command to check flow-cli
const COMPATIBLE_FLOW_CLI_VERSIONS = '>=2.0.0'

// Shell install commands
const BREW_INSTALL_FLOW_CLI = 'brew update && brew install flow-cli'
const POWERSHELL_INSTALL_CMD = (githubToken?: string): string =>
  `iex "& { $(irm 'https://raw.githubusercontent.com/onflow/flow-cli/master/install.ps1') } ${
    githubToken != null ? `-GitHubToken ${githubToken} ` : ''
  }"`
const BASH_INSTALL_FLOW_CLI = (githubToken?: string): string =>
  `${
    githubToken != null ? `GITHUB_TOKEN=${githubToken} ` : ''
  }sh -ci "$(curl -fsSL https://raw.githubusercontent.com/onflow/flow-cli/master/install.sh)"`
const VERSION_INFO_URL = 'https://formulae.brew.sh/api/formula/flow-cli.json'

export class InstallFlowCLI extends Installer {
  #githubToken: string | undefined
  #context: InstallerContext

  constructor (context: InstallerContext) {
    // Homebrew is a dependency for macos and linux
    const dependencies: InstallerConstructor[] = []
    if (process.platform === 'darwin') {
      dependencies.push(HomebrewInstaller)
    }

    super('Flow CLI', dependencies)
    this.#githubToken = process.env.GITHUB_TOKEN
    this.#context = context
  }

  async install (): Promise<void> {
    const isActive = this.#context.languageServerApi.isActive ?? false
    if (isActive) await this.#context.languageServerApi.deactivate()
    const OS_TYPE = process.platform

    try {
      switch (OS_TYPE) {
        case 'darwin':
          await this.#install_macos()
          break
        case 'win32':
          await this.#install_windows()
          break
        default:
          await this.#install_bash_cmd()
          break
      }
    } catch {
      void window.showErrorMessage('Failed to install Flow CLI')
    }
    if (isActive) await this.#context.languageServerApi.activate()
  }

  async #install_macos (): Promise<void> {
    // Install Flow CLI using homebrew
    await execVscodeTerminal('Install Flow CLI', BREW_INSTALL_FLOW_CLI)
  }

  async #install_windows (): Promise<void> {
    // Retry if bad GH token
    if (this.#githubToken != null && await tryExecPowerShell(POWERSHELL_INSTALL_CMD(this.#githubToken))) { return }
    await execVscodeTerminal('Install Flow CLI', POWERSHELL_INSTALL_CMD(this.#githubToken))
  }

  async #install_bash_cmd (): Promise<void> {
    // Retry if bad GH token
    if (this.#githubToken != null && await tryExecUnixDefault(BASH_INSTALL_FLOW_CLI(this.#githubToken))) { return }
    await execVscodeTerminal('Install Flow CLI', BASH_INSTALL_FLOW_CLI())
  }

  async maybeNotifyNewerVersion (currentVersion: semver.SemVer): Promise<void> {
    try {
      const response = await fetch(VERSION_INFO_URL)
      const { versions: { stable: latestStr } }: HomebrewVersionInfo = await response.json()
      const latest: semver.SemVer | null = semver.parse(latestStr)

      // Check if latest version > current version
      if (latest != null && latestStr != null && semver.compare(latest, currentVersion) === 1) {
        promptUserInfoMessage(
          'There is a new Flow CLI version available: ' + latest.format(),
          [{
            label: 'Install latest Flow CLI',
            callback: async () => {
              await this.runInstall()
              await this.#context.refreshDependencies()
            }
          }]
        )
      }
    } catch (e) {}
  }

  async checkVersion (version: semver.SemVer): Promise<boolean> {
    // Get user's version information
    this.#context.cliProvider.refresh()
    if (version == null) return false

    if (!semver.satisfies(version, COMPATIBLE_FLOW_CLI_VERSIONS, {
      includePrerelease: true
    })) {
      promptUserErrorMessage(
        'Incompatible Flow CLI version: ' + version.format(),
        [{
          label: 'Install latest Flow CLI',
          callback: async () => {
            await this.runInstall()
            await this.#context.refreshDependencies()
          }
        }]
      )
      return false
    }

    // Maybe notify user of newer version, non-blocking
    void this.maybeNotifyNewerVersion(version)

    return true
  }

  async verifyInstall (): Promise<boolean> {
    // Check if flow version is valid to verify install
    this.#context.cliProvider.refresh()
    const installedVersions = await this.#context.cliProvider.getBinaryVersions().catch((e) => {
      void window.showErrorMessage(`Failed to check CLI version: ${String(e.message)}`)
      return []
    })
    const version = installedVersions.find(y => y.command === KNOWN_FLOW_COMMANDS.DEFAULT)?.version
    if (version == null) return false

    // Check flow-cli version number
    return await this.checkVersion(version)
  }
}
