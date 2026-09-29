import accountsTemplate from "./templates/accounts.html";
import baseTemplate from "./templates/base.html";
import bookmarkTemplate from "./templates/bookmark.html";
import circleResultTemplate from "./templates/circle_result.html";
import circleTemplate from "./templates/circle.html";
import famplanResultTemplate from "./templates/famplan_result.html";
import famplanTemplate from "./templates/famplan.html";
import dashboardTemplate from "./templates/dashboard.html";
import decoySettingsTemplate from "./templates/decoy_settings.html";
import donasiTemplate from "./templates/donasi.html";
import notificationDetailTemplate from "./templates/notification_detail.html";
import notificationsTemplate from "./templates/notifications.html";
import themeSettingsTemplate from "./templates/theme_settings.html";
import transactionsTemplate from "./templates/transactions.html";
import monitoringTemplate from "./templates/monitoring.html";
import monitoringTelegramTemplate from "./templates/monitoring_telegram.html";
import errorBodyTemplate from "./templates/error_body.html";
import familyDetailTemplate from "./templates/family_detail.html";
import familyLoopTemplate from "./templates/family_loop.html";
import familyLoopStreamTemplate from "./templates/family_loop_stream.html";
import hotTemplate from "./templates/hot.html";
import loginTemplate from "./templates/login.html";
import myPackagesTemplate from "./templates/my_packages.html";
import packageDetailTemplate from "./templates/package_detail.html";
import packagesInputCodeTemplate from "./templates/packages_input_code.html";
import purchaseJobStatusTemplate from "./templates/purchase_job_status.html";
import purchaseResultTemplate from "./templates/purchase_result.html";
import registerPukTemplate from "./templates/register_puk.html";
import registerTemplate from "./templates/register.html";
import validateMsisdnTemplate from "./templates/validate_msisdn.html";
import storeFamiliesTemplate from "./templates/store_families.html";
import storePackagesTemplate from "./templates/store_packages.html";
import storeCategoryTemplate from "./templates/store_category.html";
import storeRedemablesTemplate from "./templates/store_redemables.html";
import storeSegmentsTemplate from "./templates/store_segments.html";
import webuiAccountTemplate from "./templates/webui_account.html";
import webuiLoginTemplate from "./templates/webui_login.html";

export const TEMPLATES: Record<string, string> = {
  base: baseTemplate,
  webui_login: webuiLoginTemplate,
  webui_account: webuiAccountTemplate,
  error_body: errorBodyTemplate,
  login: loginTemplate,
  dashboard: dashboardTemplate,
  accounts: accountsTemplate,
  packages_input_code: packagesInputCodeTemplate,
  package_detail: packageDetailTemplate,
  family_detail: familyDetailTemplate,
  family_loop: familyLoopTemplate,
  family_loop_stream: familyLoopStreamTemplate,
  my_packages: myPackagesTemplate,
  hot: hotTemplate,
  bookmark: bookmarkTemplate,
  store_segments: storeSegmentsTemplate,
  store_families: storeFamiliesTemplate,
  store_packages: storePackagesTemplate,
  store_redemables: storeRedemablesTemplate,
  store_category: storeCategoryTemplate,
  purchase_result: purchaseResultTemplate,
  purchase_job_status: purchaseJobStatusTemplate,
  famplan: famplanTemplate,
  famplan_result: famplanResultTemplate,
  circle: circleTemplate,
  circle_result: circleResultTemplate,
  validate_msisdn: validateMsisdnTemplate,
  register: registerTemplate,
  register_puk: registerPukTemplate,
  decoy_settings: decoySettingsTemplate,
  theme_settings: themeSettingsTemplate,
  donasi: donasiTemplate,
  notifications: notificationsTemplate,
  notification_detail: notificationDetailTemplate,
  transactions: transactionsTemplate,
  monitoring: monitoringTemplate,
  monitoring_telegram: monitoringTelegramTemplate,
};