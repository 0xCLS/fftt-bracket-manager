/**
 * FFTT3: dispatch the existing read-only aggregate publisher after a form submission.
 * Install from Extensions > Apps Script in the original FFTT3 Registration spreadsheet.
 * This script does not send, store, or log any registration responses.
 */
const FFTT_SHEET_NAME = 'Form Responses 1';
const FFTT_SOURCE_PROPERTY = 'FFTT_SOURCE_SPREADSHEET_ID';
const FFTT_TOKEN_PROPERTY = 'FFTT_GITHUB_ACTIONS_TOKEN';
const FFTT_GITHUB_DISPATCH_URL =
  'https://api.github.com/repos/0xCLS/fftt-bracket-manager/actions/workflows/public-registration-count.yml/dispatches';
const FFTT_EVENT_END_DATE = '2026-11-23';

function ffttInstallTriggers() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this project from the FFTT3 Registration spreadsheet.');
  const sheet = spreadsheet.getSheetByName(FFTT_SHEET_NAME);
  if (!sheet) throw new Error('Expected registration worksheet was not found.');
  const headings = sheet.getRange('A1:B1').getDisplayValues()[0];
  if (headings[0] !== 'Timestamp' || headings[1] !== 'Full Name') {
    throw new Error('Unexpected registration worksheet headings.');
  }
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(FFTT_TOKEN_PROPERTY)) {
    throw new Error('Add the FFTT_GITHUB_ACTIONS_TOKEN script property before installing triggers.');
  }
  const previousSource = properties.getProperty(FFTT_SOURCE_PROPERTY);
  if (previousSource && previousSource !== spreadsheet.getId()) {
    throw new Error('This script is already configured for another spreadsheet.');
  }
  const existing = ScriptApp.getProjectTriggers();
  const formTriggers = existing.filter(trigger => trigger.getHandlerFunction() === 'ffttOnFormSubmit');
  if (formTriggers.some(trigger => trigger.getTriggerSourceId() !== spreadsheet.getId())) {
    throw new Error('Form trigger is linked to another spreadsheet; inspect triggers manually.');
  }
  properties.setProperty(FFTT_SOURCE_PROPERTY, spreadsheet.getId());
  if (!formTriggers.length) {
    ScriptApp.newTrigger('ffttOnFormSubmit').forSpreadsheet(spreadsheet).onFormSubmit().create();
  }
  if (!existing.some(trigger => trigger.getHandlerFunction() === 'ffttReconcile')) {
    ScriptApp.newTrigger('ffttReconcile').timeBased().everyHours(1).create();
  }
  console.log('FFTT form and hourly reconciliation triggers are configured.');
}

function ffttOnFormSubmit(event) {
  if (!event || !event.source || !event.range) {
    throw new Error('An installed spreadsheet form-submission event is required.');
  }
  const expectedId = PropertiesService.getScriptProperties().getProperty(FFTT_SOURCE_PROPERTY);
  if (!expectedId || event.source.getId() !== expectedId) {
    throw new Error('Form submission came from an unexpected spreadsheet.');
  }
  if (event.range.getSheet().getName() !== FFTT_SHEET_NAME) return;
  ffttDispatchPublisher_();
}

/** Hourly Google-owned reconciliation also catches manual edits or missed form events. */
function ffttReconcile() {
  if (!PropertiesService.getScriptProperties().getProperty(FFTT_SOURCE_PROPERTY)) {
    throw new Error('Install the form trigger before running reconciliation.');
  }
  ffttDispatchPublisher_();
}

/** Safe smoke test: dispatches a publisher refresh without creating a test registration. */
function ffttVerifyDispatch() {
  ffttDispatchPublisher_();
  console.log('FFTT publisher dispatch request completed. Verify the GitHub Actions run separately.');
}

function ffttDispatchPublisher_() {
  const today = Utilities.formatDate(new Date(), 'America/Detroit', 'yyyy-MM-dd');
  if (today > FFTT_EVENT_END_DATE) return;
  const token = PropertiesService.getScriptProperties().getProperty(FFTT_TOKEN_PROPERTY);
  if (!token || typeof token !== 'string') {
    throw new Error('GitHub dispatch credential is missing.');
  }
  const response = UrlFetchApp.fetch(FFTT_GITHUB_DISPATCH_URL, {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    contentType: 'application/json',
    payload: JSON.stringify({ref: 'main'}),
    muteHttpExceptions: true,
    followRedirects: false
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    // Do not log the response body, token, Google Sheet ID, or player information.
    throw new Error('GitHub Actions dispatch failed (HTTP ' + status + ').');
  }
  console.log('FFTT aggregate refresh requested.');
}

/** Run after the event to remove ONLY this integration's triggers; revoke the PAT separately. */
function ffttRemoveTriggers() {
  const handlers = ['ffttOnFormSubmit', 'ffttReconcile'];
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (handlers.includes(trigger.getHandlerFunction())) ScriptApp.deleteTrigger(trigger);
  });
  console.log('FFTT integration triggers removed; revoke the GitHub token separately.');
}
