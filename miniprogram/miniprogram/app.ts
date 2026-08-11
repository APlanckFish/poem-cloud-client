import { STORAGE_KEYS } from './config/api'
import { restoreSession } from './services/auth'
import { ensureInstallation } from './services/installation'
import {
  isTimelineSinglePageScene,
  shareCodeFromEnterOptions,
  trackPublicationShareOpen,
} from './services/share-open'
import {
  reportGlobalRuntimeError,
  reportRealtimeInfo,
} from './utils/realtime-log'

const CLIENT_DATA_RESET_VERSION = '2026-07-23-clean-slate-3'

function resetTestDataOnce(): void {
  if (
    wx.getStorageSync(STORAGE_KEYS.clientDataResetVersion)
    === CLIENT_DATA_RESET_VERSION
  ) {
    return
  }
  const keysToClear = [
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.tokenExpiresAt,
    STORAGE_KEYS.currentUser,
    STORAGE_KEYS.localWechatProfiles,
    STORAGE_KEYS.installationKey,
    STORAGE_KEYS.installationId,
    STORAGE_KEYS.installationToken,
    STORAGE_KEYS.pendingCreation,
    STORAGE_KEYS.activeCreationRun,
    STORAGE_KEYS.editingCreation,
    STORAGE_KEYS.localCreationDrafts,
    STORAGE_KEYS.creationNeedsReset,
    STORAGE_KEYS.communityNeedsRefresh,
    STORAGE_KEYS.creationResumeAfterPreferences,
  ]
  keysToClear.forEach((key) => wx.removeStorageSync(key))
  wx.setStorageSync(STORAGE_KEYS.clientDataResetVersion, CLIENT_DATA_RESET_VERSION)
}

App<IAppOption>({
  globalData: {
    currentUser: null,
    sessionReady: false,
  },

  onLaunch(options) {
    reportRealtimeInfo('client.app.launched', { operation: 'app_launch' })
    if (isTimelineSinglePageScene(options.scene)) {
      this.globalData.sessionReady = true
      return
    }
    resetTestDataOnce()
    void ensureInstallation().catch(() => undefined)
    void restoreSession()
      .then((session) => {
        this.globalData.currentUser = session?.user || null
      })
      .finally(() => {
        this.globalData.sessionReady = true
      })
  },

  onShow(options) {
    if (isTimelineSinglePageScene(options.scene)) return
    const shareCode = shareCodeFromEnterOptions(options)
    if (shareCode) {
      void trackPublicationShareOpen(shareCode, 'app_enter_shared_publication').catch(
        () => undefined,
      )
    }
  },

  onError(error) {
    reportGlobalRuntimeError(error, 'app_error')
  },

  onUnhandledRejection(result) {
    reportGlobalRuntimeError(result.reason, 'unhandled_rejection')
  },
})
