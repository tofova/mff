// --- PostHog: event names ---
// One place for every custom event name, so dashboards never break because of
// a typo in a component. Names are snake_case nouns + past-tense verbs.

export const AnalyticsEvents = {
  // Product grid (home page)
  productImpression: 'product_impression', // card was >= 50% visible for >= 0.5 s
  productAttention: 'product_attention', // card left the screen: how long it was visible
  productBuyClicked: 'product_buy_clicked',
  categorySelected: 'category_selected',
  productSearched: 'product_searched',

  // Registration / login
  registerModalOpened: 'register_modal_opened',
  registrationCompleted: 'registration_completed',
  registrationFailed: 'registration_failed',
  registrationBanned: 'registration_banned',
  bannedNoticeShown: 'banned_notice_shown',
  loginSucceeded: 'login_succeeded',
  loginFailed: 'login_failed',
  accountCreated: 'account_created',
  accountCreateFailed: 'account_create_failed',
  logout: 'logout',

  // Checkout (purchase modal)
  checkoutStepViewed: 'checkout_step_viewed',
  checkoutNotEligible: 'checkout_not_eligible',
  checkoutUpiStarted: 'checkout_upi_started',
  checkoutUpiFailed: 'checkout_upi_failed',
  checkoutRedeemSubmitted: 'checkout_redeem_submitted',
  checkoutRedeemFailed: 'checkout_redeem_failed',
  checkoutQrExpired: 'checkout_qr_expired',
  checkoutClosed: 'checkout_closed', // the buyer closed the popup; once per popup, never for timer or eligibility closes
  checkoutSuccessSeen: 'checkout_success_seen',
  purchaseCompleted: 'purchase_completed', // same moment as the Meta Pixel "Purchase"

  // Coins, ads, slider, chatbot, notifications
  coinsUnregisteredClick: 'coins_unregistered_click',
  coinsHistoryOpened: 'coins_history_opened',
  sliderSlideViewed: 'slider_slide_viewed',
  faqChatOpened: 'faq_chat_opened',
  faqQuestionSubmitted: 'faq_question_submitted',
  eventModalShown: 'event_modal_shown',
  eventModalClosed: 'event_modal_closed',
  popupNotificationShown: 'popup_notification_shown',
  popupNotificationClosed: 'popup_notification_closed',
  adWatchStarted: 'ad_watch_started',
  adNoneAvailable: 'ad_none_available',
  adRewardGranted: 'ad_reward_granted',
  adCtaClicked: 'ad_cta_clicked',
  adSkipped: 'ad_skipped',

  // Support, refunds, app, access
  supportTicketCreated: 'support_ticket_created',
  supportMessageSent: 'support_message_sent',
  supportCallbackRequested: 'support_callback_requested',
  refundRequestSubmitted: 'refund_request_submitted',
  refundRequestFailed: 'refund_request_failed',
  appDownloadStarted: 'app_download_started',
  inAppBrowserRedirect: 'in_app_browser_redirect',
  blockedPageShown: 'blocked_page_shown',
  blockedReviewRequested: 'blocked_review_requested',
  pushPermissionResult: 'push_permission_result',
  pwaInstalled: 'pwa_installed',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];
