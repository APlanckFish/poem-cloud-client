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
