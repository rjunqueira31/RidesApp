const page = document.body.dataset.page;
const protectedPages = new Set([
  'dashboard', 'create-ride', 'search-rides', 'my-rides', 'find-users',
  'profile', 'debug'
]);

const state = {
  currentUser: null,
  profiles: [],
  rides: [],
  filters: {
    driver: '',
    start: '',
    end: '',
    openOnly: false,
  },
};

const OFFICE_LOCATION_LABELS = {
  LISBON: 'Lisbon',
  PORTO: 'Porto',
  BRAGA: 'Braga',
};

const PENDING_TOAST_KEY = 'ridesapp.pendingToast';
const PROFILE_RETURN_PATH_KEY = 'ridesapp.profileReturnPath';
const CREATE_RIDE_RETURN_PATH_KEY = 'ridesapp.createRideReturnPath';
const PASSWORD_REQUIREMENTS_MESSAGE =
    'Password must be at least 8 characters long.';

function userIsManager() {
  return state.currentUser?.role === 'MANAGER_USER';
}

function escapeHtml(value) {
  return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll('\'', '&#039;');
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

function setFeedback(message, isError = false) {
  const feedback = document.querySelector('#page-feedback');
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.style.color = isError ? '#b42318' : '#09005d';
}

function setPendingToast(message, tone = 'success') {
  sessionStorage.setItem(PENDING_TOAST_KEY, JSON.stringify({message, tone}));
}

function consumePendingToast() {
  const rawToast = sessionStorage.getItem(PENDING_TOAST_KEY);
  if (!rawToast) {
    return null;
  }

  sessionStorage.removeItem(PENDING_TOAST_KEY);

  try {
    return JSON.parse(rawToast);
  } catch {
    return null;
  }
}

function getCurrentPagePath() {
  const path = window.location.pathname.split('/').pop();
  return path || 'index.html';
}

function setReturnPath(storageKey, path) {
  if (!path) {
    return;
  }

  sessionStorage.setItem(storageKey, path);
}

function consumeReturnPath(storageKey, fallbackPath) {
  const returnPath = sessionStorage.getItem(storageKey);
  if (returnPath) {
    sessionStorage.removeItem(storageKey);
    return returnPath;
  }

  return fallbackPath;
}

function showPendingToastIfPresent() {
  const pendingToast = consumePendingToast();
  if (pendingToast?.message) {
    showToast(pendingToast.message, pendingToast.tone);
  }
}

function wireReturnPathLinks() {
  const currentPath = getCurrentPagePath();

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) {
      return;
    }

    const href = link.getAttribute('href');
    if (href === 'profile.html') {
      setReturnPath(PROFILE_RETURN_PATH_KEY, currentPath);
    }

    if (href === 'create-ride.html') {
      setReturnPath(CREATE_RIDE_RETURN_PATH_KEY, currentPath);
    }
  });
}

function ensureToastContainer() {
  let container = document.querySelector('#toast-container');
  if (container) {
    return container;
  }

  document.body.insertAdjacentHTML(
      'beforeend', '<div id="toast-container" class="toast-container"></div>');
  container = document.querySelector('#toast-container');
  return container;
}

function showToast(message, tone = 'success') {
  const container = ensureToastContainer();
  const toast = document.createElement('div');

  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  window.setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');

    window.setTimeout(() => {
      toast.remove();
    }, 280);
  }, 2000);
}

function debounce(callback, delay) {
  let timeoutId = null;

  const debounced = (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      callback(...args);
    }, delay);
  };

  debounced.cancel = () => {
    window.clearTimeout(timeoutId);
    timeoutId = null;
  };

  return debounced;
}

async function loadCurrentUser() {
  try {
    const payload = await api('/api/auth/me');
    state.currentUser = payload.profile;
    return payload.profile;
  } catch {
    state.currentUser = null;
    return null;
  }
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Intl
      .DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
      .format(new Date(value));
}

function formatCalendarDate(value) {
  return new Intl
      .DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      .format(new Date(value));
}

function formatClockTime(value) {
  return new Intl
      .DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
      .format(new Date(value));
}

function isSameCalendarDay(leftValue, rightValue) {
  const left = new Date(leftValue);
  const right = new Date(rightValue);

  return left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate();
}

function formatDateTimeRange(startValue, endValue) {
  if (!startValue || !endValue) {
    return startValue ? formatDateTime(startValue) : '—';
  }

  if (isSameCalendarDay(startValue, endValue)) {
    return `${formatCalendarDate(startValue)}, ${
        formatClockTime(startValue)} - ${formatClockTime(endValue)}`;
  }

  return `${formatDateTime(startValue)} - ${formatDateTime(endValue)}`;
}

function formatDateForInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
}

function formatTimeForInput(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${
      String(date.getMinutes()).padStart(2, '0')}`;
}

function combineDateAndTime(dateValue, timeValue) {
  return `${dateValue}T${timeValue}`;
}

function parseTimeValueToMinutes(timeValue) {
  const [hours, minutes] =
      String(timeValue || '').split(':').map((value) => Number(value));

  if ([hours, minutes].some((value) => Number.isNaN(value))) {
    return null;
  }

  return hours * 60 + minutes;
}

function shouldTreatEndTimeAsNextDay(startTime, endTime) {
  const startMinutes = parseTimeValueToMinutes(startTime);
  const endMinutes = parseTimeValueToMinutes(endTime);

  if (startMinutes === null || endMinutes === null ||
      endMinutes > startMinutes) {
    return false;
  }

  return startMinutes >= 22 * 60 && startMinutes - endMinutes > 20 * 60;
}

function floorToMinute(date) {
  const normalized = new Date(date);
  normalized.setSeconds(0, 0);
  return normalized;
}

function roundUpToNextMinute(date) {
  const rounded = floorToMinute(date);

  if (date.getSeconds() !== 0 || date.getMilliseconds() !== 0) {
    rounded.setMinutes(rounded.getMinutes() + 1);
  }

  return rounded;
}

function addMinutesToTime(timeValue, minutesToAdd) {
  const [hours, minutes] =
      String(timeValue || '').split(':').map((value) => Number(value));

  if ([hours, minutes].some((value) => Number.isNaN(value))) {
    return '';
  }

  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  const normalizedMinutes =
      ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const nextHours = String(Math.floor(normalizedMinutes / 60)).padStart(2, '0');
  const nextMinutes = String(normalizedMinutes % 60).padStart(2, '0');

  return `${nextHours}:${nextMinutes}`;
}

function validateRideDateTime(dateValue, startTime, endTime) {
  const start = new Date(combineDateAndTime(dateValue, startTime));
  const end = new Date(combineDateAndTime(dateValue, endTime));
  const now = floorToMinute(new Date());

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Please choose a valid departure window.');
  }

  if (shouldTreatEndTimeAsNextDay(startTime, endTime)) {
    end.setDate(end.getDate() + 1);
  }

  if (start.getTime() < now.getTime()) {
    throw new Error('Earliest departure must be in the future.');
  }

  if (end.getTime() <= start.getTime()) {
    throw new Error('Latest departure must be later than earliest departure.');
  }

  return {
    startWindowStart: start.toISOString(),
    startWindowEnd: end.toISOString(),
  };
}

function syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput) {
  const now = new Date();
  const today = formatDateForInput(now);
  const isToday = dateInput.value === today;

  if (isToday) {
    const minStartTime = formatTimeForInput(floorToMinute(now));

    if (!startTimeInput.value) {
      startTimeInput.value = minStartTime;
    }
  }

  if (!endTimeInput.value) {
    endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);
  }
}

function redirectTo(path) {
  window.location.href = path;
}

function ensureNotesModal() {
  let modal = document.querySelector('#notes-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="notes-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-close-notes-modal="true"></div>
      <div class="notes-modal-panel" role="dialog" aria-modal="true" aria-labelledby="notes-modal-title">
        <div class="notes-modal-header">
          <h2 id="notes-modal-title">Ride notes</h2>
          <button type="button" class="button-secondary notes-modal-close" data-close-notes-modal="true" aria-label="Close notes">Close</button>
        </div>
        <div id="notes-modal-content" class="notes-modal-content"></div>
      </div>
    </div>
  `);

  modal = document.querySelector('#notes-modal');
  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-notes-modal="true"]')) {
      modal.hidden = true;
    }
  });

  return modal;
}

function openNotesModal(notesText) {
  const modal = ensureNotesModal();
  const content = modal.querySelector('#notes-modal-content');
  content.textContent = notesText;
  modal.hidden = false;
}

let activeRideDetailsRefresh = null;
let pendingRidePublish = null;

function ensureRideDetailsModal() {
  let modal = document.querySelector('#ride-details-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="ride-details-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-close-ride-details-modal="true"></div>
      <div class="notes-modal-panel ride-details-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ride-details-modal-title">
        <div class="notes-modal-header">
          <h2 id="ride-details-modal-title" class="ride-details-title">Ride details</h2>
          <button type="button" class="button-secondary notes-modal-close" data-close-ride-details-modal="true" aria-label="Close ride details">Close</button>
        </div>
        <div id="ride-details-modal-content" class="ride-details-modal-content"></div>
      </div>
    </div>
  `);

  modal = document.querySelector('#ride-details-modal');
  modal.addEventListener('click', async (event) => {
    if (event.target.closest('[data-close-ride-details-modal="true"]')) {
      modal.hidden = true;
      return;
    }

    const manageRequestButton = event.target.closest('.manage-request');
    if (manageRequestButton) {
      try {
        await api(`/api/requests/${manageRequestButton.dataset.requestId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            decision: manageRequestButton.dataset.decision,
          }),
        });
        await refreshRideDetailsModal();
        if (activeRideDetailsRefresh) {
          await activeRideDetailsRefresh();
        }
        showToast(`Request ${manageRequestButton.dataset.decision}.`);
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    try {
      const removePassengerButton =
          event.target.closest('.remove-passenger-button');
      if (removePassengerButton) {
        await api(`/api/requests/${removePassengerButton.dataset.requestId}`, {
          method: 'DELETE',
        });
        await refreshRideDetailsModal();
        if (activeRideDetailsRefresh) {
          await activeRideDetailsRefresh();
        }
        showToast('Passenger removed from ride.');
        return;
      }

      const leaveRideButton = event.target.closest('.leave-ride-button');
      if (!leaveRideButton) {
        return;
      }

      await leaveRide(leaveRideButton.dataset.requestId, async () => {
        await refreshRideDetailsModal();
        if (activeRideDetailsRefresh) {
          await activeRideDetailsRefresh();
        }
      });
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  modal.addEventListener('submit', async (event) => {
    const requestForm = event.target.closest('[data-request-ride-id]');
    if (requestForm) {
      event.preventDefault();

      try {
        await requestSeatForRide(
            requestForm.dataset.requestRideId, async () => {
              await refreshRideDetailsModal();
              if (activeRideDetailsRefresh) {
                await activeRideDetailsRefresh();
              }
            });
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    const chatForm = event.target.closest('.chat-form');
    if (!chatForm) {
      return;
    }

    event.preventDefault();
    const rideId = chatForm.dataset.chatRideId;
    const formData = new FormData(chatForm);
    const text = String(formData.get('text') || '').trim();

    if (!text) {
      showToast('Write a message before sending.', 'error');
      return;
    }

    try {
      await api(`/api/rides/${rideId}/messages`, {
        method: 'POST',
        body: JSON.stringify({text}),
      });
      await refreshRideDetailsModal();
      if (activeRideDetailsRefresh) {
        await activeRideDetailsRefresh();
      }
      showToast('Message sent.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  return modal;
}

function renderRideDetailsContent(ride) {
  const isDriver = state.currentUser && ride.driverId === state.currentUser.id;
  const currentRequest = getCurrentUserRequest(ride);
  const notes = String(ride.notes || '').trim() || 'No notes for this ride.';

  return `
    <div class="ride-details-summary">
      <div class="card-grid ride-details-grid">
        <div class="ride-details-grid-window">
          <strong>Window</strong>
          <div class="meta">${
      escapeHtml(formatDateTimeRange(
          ride.startWindowStart, ride.startWindowEnd))}</div>
        </div>
        <div class="ride-details-grid-car">
          <strong>Car</strong>
          <div class="meta">${escapeHtml(ride.car || '—')}</div>
        </div>
        <div class="ride-details-grid-seats">
          <strong>Seats left</strong>
          <div class="meta">${ride.seatsLeft} / ${ride.seatsTotal}</div>
        </div>
        <div class="ride-details-grid-requests">
          <strong>Requests</strong>
          <div class="meta">${ride.requests.length}</div>
        </div>
      </div>
      <div class="pill-row">
        ${
      currentRequest ?
          `<span class="pill status-${currentRequest.status}">Your request: ${
              escapeHtml(currentRequest.status)}</span>` :
          ''}
      </div>
      ${renderRideSeatAction(ride, {
    compact: true
  })}
    </div>

    <section class="ride-details-section">
      <h3>Notes</h3>
      <div class="ride-details-notes">${escapeHtml(notes)}</div>
    </section>

    ${isDriver ? renderDriverRequests(ride) : ''}
    ${renderChat(ride)}
  `;
}

async function refreshRideDetailsModal() {
  const modal = ensureRideDetailsModal();
  const rideId = modal.dataset.rideId;

  if (!rideId) {
    return;
  }

  const content = modal.querySelector('#ride-details-modal-content');
  const payload = await api(`/api/rides/${rideId}`);
  const ride = payload.ride;
  const driverName = ride.driver?.name || ride.driverEmail;

  modal.querySelector('#ride-details-modal-title').innerHTML =
      `<span class="ride-details-title-text">${
          escapeHtml(`${ride.startPoint} → ${ride.endPoint} | Driver: ${
              driverName}`)}</span>${
          renderRideAvailabilityPill(ride, 'ride-details-title-pill')}`;
  content.innerHTML = renderRideDetailsContent(ride);
}

async function openRideDetailsModal(rideId, refresh) {
  const modal = ensureRideDetailsModal();
  const content = modal.querySelector('#ride-details-modal-content');

  activeRideDetailsRefresh = refresh;
  modal.dataset.rideId = rideId;
  modal.hidden = false;
  modal.querySelector('#ride-details-modal-title').textContent = 'Ride details';
  content.innerHTML = '<div class="empty-state">Loading ride details...</div>';

  try {
    await refreshRideDetailsModal();
  } catch (error) {
    modal.hidden = true;
    showToast(error.message, 'error');
  }
}

async function requestSeatForRide(rideId, refresh) {
  await api(`/api/rides/${rideId}/requests`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  await refresh();
  showToast('Seat request sent.');
}

async function leaveRide(requestId, refresh) {
  await api(`/api/requests/${requestId}`, {
    method: 'DELETE',
  });
  await refresh();
  showToast('You left the ride.');
}

function renderRideSummaryMarkup(ride, options = {}) {
  const {
    emptyCarLabel = 'No car specified',
    emptyNotesLabel = 'No notes added.',
    showNotes = false,
  } = options;
  const carLabel = String(ride.car || '').trim() || emptyCarLabel;
  const notes = String(ride.notes || '').trim();

  return `
    <div class="ride-created-route">${escapeHtml(ride.startPoint)} to ${
      escapeHtml(ride.endPoint)}</div>
    <div class="ride-created-meta">${
      escapeHtml(formatDateTimeRange(
          ride.startWindowStart, ride.startWindowEnd))}</div>
    <div class="ride-created-meta">${escapeHtml(carLabel)} · ${
      escapeHtml(ride.seatsTotal)} seat${
      Number(ride.seatsTotal) === 1 ? '' : 's'}</div>
    ${
      showNotes ? `<div class="ride-created-meta">Notes: ${
                      escapeHtml(notes || emptyNotesLabel)}</div>` :
                  ''}
  `;
}

function ensureRideConfirmModal() {
  let modal = document.querySelector('#ride-confirm-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="ride-confirm-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-dismiss-ride-confirm-modal="true"></div>
      <div class="notes-modal-panel ride-created-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ride-confirm-modal-title">
        <div class="notes-modal-header">
          <h2 id="ride-confirm-modal-title">Confirm your ride details</h2>
          <button type="button" class="button-secondary notes-modal-close" data-dismiss-ride-confirm-modal="true" aria-label="Close ride confirmation">Close</button>
        </div>
        <p class="ride-created-copy">Review the details below. Your ride will only be published after you confirm.</p>
        <div id="ride-confirm-summary" class="ride-created-summary"></div>
        <div class="ride-created-actions">
          <button type="button" class="button-secondary" data-dismiss-ride-confirm-modal="true">Edit ride</button>
          <button type="button" id="ride-confirm-submit">Confirm and publish</button>
        </div>
      </div>
    </div>
  `);

  modal = document.querySelector('#ride-confirm-modal');
  modal.addEventListener('click', async (event) => {
    if (event.target.closest('[data-dismiss-ride-confirm-modal="true"]')) {
      modal.hidden = true;
      return;
    }

    const confirmButton = event.target.closest('#ride-confirm-submit');
    if (!confirmButton || !pendingRidePublish) {
      return;
    }

    const {ride, form, carInput, dateInput, startTimeInput, endTimeInput} =
        pendingRidePublish;

    try {
      confirmButton.disabled = true;
      const payload = await api('/api/rides', {
        method: 'POST',
        body: JSON.stringify(ride),
      });

      form.reset();
      carInput.value = state.currentUser.defaultCar || '';
      applyUserRouteDefaults(form);
      dateInput.value = formatDateForInput(new Date());
      startTimeInput.value =
          formatTimeForInput(roundUpToNextMinute(new Date()));
      endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);
      syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);
      pendingRidePublish = null;
      modal.hidden = true;
      openRideCreatedModal(payload.ride);
    } catch (error) {
      setFeedback(error.message, true);
      confirmButton.disabled = false;
    }
  });

  return modal;
}

function openRideConfirmModal(pendingRide) {
  const modal = ensureRideConfirmModal();
  const summary = modal.querySelector('#ride-confirm-summary');
  const confirmButton = modal.querySelector('#ride-confirm-submit');

  pendingRidePublish = pendingRide;
  summary.innerHTML = renderRideSummaryMarkup(pendingRide.ride, {
    showNotes: true,
  });
  confirmButton.disabled = false;
  modal.hidden = false;
}

function ensureRideCreatedModal() {
  let modal = document.querySelector('#ride-created-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="ride-created-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-dismiss-ride-created-modal="true"></div>
      <div class="notes-modal-panel ride-created-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ride-created-modal-title">
        <div class="notes-modal-header">
          <h2 id="ride-created-modal-title">Ride published</h2>
          <button type="button" class="button-secondary notes-modal-close" data-go-to-landing-after-ride="true" aria-label="Close confirmation">Close</button>
        </div>
        <p class="ride-created-copy">Your ride is now visible to colleagues.</p>
        <div id="ride-created-summary" class="ride-created-summary"></div>
        <div class="ride-created-actions">
          <button type="button" class="button-secondary" data-dismiss-ride-created-modal="true">Create another</button>
          <button type="button" id="ride-created-view-my-rides">See my rides</button>
        </div>
      </div>
    </div>
  `);

  modal = document.querySelector('#ride-created-modal');
  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-go-to-landing-after-ride="true"]')) {
      redirectTo(
          consumeReturnPath(CREATE_RIDE_RETURN_PATH_KEY, 'dashboard.html'));
      return;
    }

    if (event.target.closest('[data-dismiss-ride-created-modal="true"]')) {
      modal.hidden = true;
      return;
    }

    if (event.target.closest('#ride-created-view-my-rides')) {
      redirectTo('my-rides.html');
    }
  });

  return modal;
}

function deleteCurrentAccount() {
  return api('/api/profile', {
    method: 'DELETE',
  });
}

function ensureDeleteAccountModal() {
  let modal = document.querySelector('#delete-account-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="delete-account-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-dismiss-delete-account-modal="true"></div>
      <div class="notes-modal-panel ride-created-modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-account-modal-title">
        <div class="notes-modal-header">
          <h2 id="delete-account-modal-title">Delete account</h2>
        </div>
        <p class="ride-created-copy">Once you delete your account, there is no going back. This will remove your profile, your published rides, and your joined rides.</p>
        <div class="ride-created-actions">
          <button type="button" class="button-secondary" data-dismiss-delete-account-modal="true">Cancel</button>
          <button type="button" id="delete-account-confirm-button" class="danger-button">Delete account</button>
        </div>
      </div>
    </div>
  `);

  modal = document.querySelector('#delete-account-modal');
  modal.addEventListener('click', async (event) => {
    if (event.target.closest('[data-dismiss-delete-account-modal="true"]')) {
      modal.hidden = true;
      return;
    }

    const confirmButton =
        event.target.closest('#delete-account-confirm-button');
    if (!confirmButton) {
      return;
    }

    try {
      confirmButton.disabled = true;
      await deleteCurrentAccount();
      state.currentUser = null;
      redirectTo('index.html');
    } catch (error) {
      setFeedback(error.message, true);
      confirmButton.disabled = false;
    }
  });

  return modal;
}

function openDeleteAccountModal() {
  const modal = ensureDeleteAccountModal();
  const confirmButton = modal.querySelector('#delete-account-confirm-button');

  confirmButton.disabled = false;
  modal.hidden = false;
}

function openRideCreatedModal(ride) {
  const modal = ensureRideCreatedModal();
  const summary = modal.querySelector('#ride-created-summary');

  summary.innerHTML = renderRideSummaryMarkup(ride);

  modal.hidden = false;
}

function formatOfficeLocation(value) {
  return OFFICE_LOCATION_LABELS[value] || '';
}

function syncSelectPlaceholderState(select) {
  if (!select) {
    return;
  }

  select.classList.toggle('select-placeholder', !select.value);
}

function applyUserRouteDefaults(form) {
  const startPointInput = form.querySelector('input[name="startPoint"]');
  const endPointInput = form.querySelector('input[name="endPoint"]');

  if (startPointInput && !startPointInput.value) {
    startPointInput.value = state.currentUser.defaultHome || '';
  }

  if (endPointInput && !endPointInput.value) {
    endPointInput.value = formatOfficeLocation(state.currentUser.defaultOffice);
  }
}

function swapInputValues(firstInput, secondInput) {
  const firstValue = firstInput.value;
  firstInput.value = secondInput.value;
  secondInput.value = firstValue;
}

function hydrateUserPill() {
  const pill = document.querySelector('#current-user-pill');
  if (!pill || !state.currentUser) {
    return;
  }

  pill.textContent = `${state.currentUser.name} · ${state.currentUser.email}`;
}

function wireLogout() {
  const logoutButton = document.querySelector('#logout-button');
  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', {
        method: 'POST',
      });
    } catch {
      // Ignore logout failures locally and clear client state anyway.
    } finally {
      state.currentUser = null;
      redirectTo('index.html');
    }
  });
}

function syncLandingPageAuthState() {
  const guestHeaderActions = document.querySelector('#landing-guest-actions');
  const authHeaderActions = document.querySelector('#landing-auth-actions');
  const isAuthenticated = Boolean(state.currentUser);

  if (guestHeaderActions) {
    guestHeaderActions.hidden = isAuthenticated;
  }

  if (authHeaderActions) {
    authHeaderActions.hidden = !isAuthenticated;
  }

  if (isAuthenticated) {
    hydrateUserPill();
    wireLogout();
  }
}

async function loadProfiles(searchQuery = '', options = {}) {
  const params = new URLSearchParams();

  if (String(searchQuery || '').trim()) {
    params.set('query', searchQuery.trim());
  }

  const payload = await api(
      `/api/profiles${params.toString() ? `?${params.toString()}` : ''}`,
      options);
  state.profiles = payload.profiles;
  return payload.profiles;
}

function renderUserSearchCard(profile) {
  return `
    <article class="user-card">
      <div class="user-card-header">
        <div>
          <h2>${escapeHtml(profile.name || 'Unnamed user')}</h2>
          <p class="meta">${escapeHtml(profile.email)}</p>
        </div>
      </div>
      <div class="user-card-grid">
        <div>
          <strong>Phone</strong>
          <div class="meta">${escapeHtml(profile.phone || '—')}</div>
        </div>
        <div>
          <strong>Default office</strong>
          <div class="meta">${
      escapeHtml(formatOfficeLocation(profile.defaultOffice) || '—')}</div>
        </div>
      </div>
    </article>
  `;
}

async function loadRides(filters = {}, options = {}) {
  const params = new URLSearchParams();

  if (filters.driver) {
    params.set('driver', filters.driver);
  }
  if (filters.start) {
    params.set('start', filters.start);
  }
  if (filters.end) {
    params.set('end', filters.end);
  }
  if (filters.openOnly) {
    params.set('openOnly', 'true');
  }

  const payload = await api(
      `/api/rides${params.toString() ? `?${params.toString()}` : ''}`, options);
  state.rides = payload.rides;
  return payload.rides;
}

function getCurrentUserRequest(ride) {
  if (!state.currentUser) {
    return null;
  }

  return ride.requests.find(
      (request) => request.passengerId === state.currentUser.id &&
          ['pending', 'accepted'].includes(request.status));
}

function renderRideSeatAction(ride, options = {}) {
  const {allowRequest = true, compact = false} = options;
  const isDriver = state.currentUser && ride.driverId === state.currentUser.id;
  const currentRequest = getCurrentUserRequest(ride);

  if (currentRequest) {
    return `
      <div class="request-form${compact ? ' request-form-compact' : ''}">
        <button type="button" class="leave-ride-button" data-request-id="${
        currentRequest.id}">Leave ride</button>
      </div>
    `;
  }

  if (!allowRequest || !state.currentUser || isDriver || ride.seatsLeft <= 0) {
    return '';
  }

  return `
    <form class="request-form${
      compact ? ' request-form-compact' :
                ''}" data-request-ride-id="${ride.id}">
      <button type="submit">Request seat</button>
    </form>
  `;
}

function renderRideAvailabilityPill(ride, extraClass = '') {
  const statusClass =
      ride.seatsLeft === 0 ? 'status-declined' : 'status-accepted';
  const label = ride.seatsLeft === 0 ? 'Full' : 'Open';

  return `<span class="pill ${statusClass}${
      extraClass ? ` ${extraClass}` : ''}">${label}</span>`;
}

function renderDriverRequests(ride) {
  if (!ride.requests.length) {
    return '<div class="empty-state">No passenger requests yet.</div>';
  }

  return `
    <section class="ride-driver-requests-section">
      <h3>Passenger requests</h3>
      <ul class="request-list ride-driver-requests-list">
        ${
      ride.requests
          .map(
              (request) => `
              <li>
                <div class="request-item">
                  <div class="request-item-row">
                    <span class="request-identity"><strong>${
                  escapeHtml(
                      request.passenger?.name ||
                      request
                          .passengerEmail)}</strong> <span class="request-divider">-</span> <span class="meta">${
                  escapeHtml(
                      request
                          .passengerEmail)}</span> <span class="request-divider">-</span> <span class="pill status-${
                  request.status}">${escapeHtml(request.status)}</span></span>
                    ${
                  request.status === 'pending' ?
                      `
                        <div class="actions">
                          <button type="button" class="manage-request" data-request-id="${
                          request.id}" data-decision="accepted">Accept</button>
                          <button type="button" class="manage-request button-secondary" data-request-id="${
                          request.id}" data-decision="declined">Decline</button>
                        </div>
                      ` :
                      request.status === 'accepted' ?
                      `
                        <div class="actions">
                          <button type="button" class="remove-passenger-button button-secondary" data-request-id="${
                          request.id}">Remove</button>
                        </div>
                      ` :
                      ''}
                  </div>
                </div>
              </li>
            `)
          .join('')}
      </ul>
    </section>
  `;
}

function renderChat(ride) {
  return `
    <section class="chat-box">
      <h3>Ride chat</h3>
      <ul class="chat-messages">
        ${
      ride.messages.length ?
          ride.messages
              .map(
                  (message) => `
                  <li class="chat-message">
                    <div class="chat-meta">
                      <strong>${
                      escapeHtml(
                          message.sender?.name || message.senderEmail)}</strong>
                      <span>${formatDateTime(message.createdAt)}</span>
                    </div>
                    <div>${escapeHtml(message.text)}</div>
                  </li>
                `)
              .join('') :
          '<li class="empty-state">No messages yet. Use chat to coordinate pickup details.</li>'}
      </ul>
      <form class="chat-form" data-chat-ride-id="${ride.id}">
        <label>
          New message
          <textarea name="text" rows="2" placeholder="Share pickup details or arrival timing."></textarea>
        </label>
        <button type="submit">Send message</button>
      </form>
    </section>
  `;
}

function renderRideCard(ride, options = {}) {
  const {allowRequest = true} = options;
  const currentRequest = getCurrentUserRequest(ride);

  return `
    <article class="ride-card" data-ride-id="${ride.id}">
      <div>
        <div class="route">${escapeHtml(ride.startPoint)} → ${
      escapeHtml(ride.endPoint)}</div>
        <div class="meta">Driver: ${
      escapeHtml(ride.driver?.name || ride.driverEmail)}</div>
      </div>

      <div class="card-grid">
        <div class="ride-window-field">
          <strong>Window</strong>
          <div class="meta ride-window-meta">${
      formatDateTimeRange(ride.startWindowStart, ride.startWindowEnd)}</div>
        </div>
      </div>

      <div class="pill-row">
        <span class="pill">${ride.requests.length} requests</span>
        ${
      currentRequest ?
          `<span class="pill status-${currentRequest.status}">Your request: ${
              escapeHtml(currentRequest.status)}</span>` :
          ''}
        ${
      ride.seatsLeft === 0 ? '<span class="pill status-declined">Full</span>' :
                             '<span class="pill status-accepted">Open</span>'}
      </div>

      <div class="actions ride-card-actions">
        <button type="button" class="button-secondary open-ride-details" data-ride-id="${
      ride.id}">See full ride details &#8663;</button>
      </div>

      ${renderRideSeatAction(ride, {allowRequest})}
    </article>
  `;
}

async function handleRideActions(container, refresh) {
  container.addEventListener('click', async (event) => {
    const rideCard = event.target.closest('[data-ride-id]');
    if (!rideCard) {
      return;
    }

    const rideDetailsButton = event.target.closest('.open-ride-details');
    if (rideDetailsButton) {
      await openRideDetailsModal(rideDetailsButton.dataset.rideId, refresh);
      return;
    }

    if (event.target.classList.contains('manage-request')) {
      try {
        await api(`/api/requests/${event.target.dataset.requestId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            decision: event.target.dataset.decision,
          }),
        });
        await refresh();
        showToast(`Request ${event.target.dataset.decision}.`);
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    const leaveRideButton = event.target.closest('.leave-ride-button');
    if (leaveRideButton) {
      try {
        await leaveRide(leaveRideButton.dataset.requestId, refresh);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }
  });

  container.addEventListener('submit', async (event) => {
    const requestForm = event.target.closest('[data-request-ride-id]');
    if (requestForm) {
      event.preventDefault();
      const rideId = requestForm.dataset.requestRideId;

      try {
        await requestSeatForRide(rideId, refresh);
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    const form = event.target.closest('[data-chat-ride-id]');
    if (!form) {
      return;
    }

    event.preventDefault();
    const rideId = form.dataset.chatRideId;
    const formData = new FormData(form);
    const text = String(formData.get('text') || '').trim();

    if (!text) {
      showToast('Write a message before sending.', 'error');
      return;
    }

    try {
      await api(`/api/rides/${rideId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text,
        }),
      });
      await refresh();
      showToast('Message sent.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

function ensureAuthenticated() {
  if (!state.currentUser) {
    redirectTo('login.html');
    return false;
  }

  hydrateUserPill();
  wireLogout();
  return true;
}

function ensureManager() {
  if (!userIsManager()) {
    redirectTo('index.html');
    return false;
  }

  return true;
}

async function setupLandingPage() {
  syncLandingPageAuthState();
}

async function setupSignupPage() {
  await loadCurrentUser();
  if (state.currentUser) {
    redirectTo('index.html');
    return;
  }

  const officeSelect = document.querySelector('select[name="defaultOffice"]');
  const passwordInput = document.querySelector('input[name="password"]');
  syncSelectPlaceholderState(officeSelect);
  officeSelect?.addEventListener('change', () => {
    syncSelectPlaceholderState(officeSelect);
  });

  passwordInput?.addEventListener('input', () => {
    if (!passwordInput.value || isStrongPassword(passwordInput.value)) {
      passwordInput.setCustomValidity('');
      return;
    }

    passwordInput.setCustomValidity(PASSWORD_REQUIREMENTS_MESSAGE);
  });

  document.querySelector('#signup-form')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const profile = Object.fromEntries(formData.entries());

        if (!isStrongPassword(profile.password)) {
          passwordInput?.setCustomValidity(PASSWORD_REQUIREMENTS_MESSAGE);
          passwordInput?.reportValidity();
          setFeedback(PASSWORD_REQUIREMENTS_MESSAGE, true);
          return;
        }

        passwordInput?.setCustomValidity('');

        try {
          const payload = await api('/api/auth/signup', {
            method: 'POST',
            body: JSON.stringify(profile),
          });

          state.currentUser = payload.profile;
          redirectTo('index.html');
        } catch (error) {
          setFeedback(error.message, true);
        }
      });
}

async function setupLoginPage() {
  await loadCurrentUser();
  if (state.currentUser) {
    redirectTo('index.html');
    return;
  }

  document.querySelector('#login-form')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const credentials = {
          email: formData.get('email'),
          password: formData.get('password'),
        };

        try {
          const payload = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials),
          });

          state.currentUser = payload.profile;
          redirectTo('index.html');
        } catch (error) {
          setFeedback(error.message, true);
        }
      });
}

async function setupDashboardPage() {
  const hubGrid = document.querySelector('.hub-grid');

  if (hubGrid && userIsManager()) {
    hubGrid.insertAdjacentHTML('beforeend', `
          <a href="debug.html" class="hub-card">
            <span class="hub-label">05</span>
            <h2>Debug data</h2>
            <p>Inspect all users, rides, requests, and ride chat data.</p>
          </a>
        `);
  }
}

async function setupFindUsersPage() {
  const form = document.querySelector('#find-users-form');
  const searchInput = form.querySelector('input[name="query"]');
  const resultsContainer = document.querySelector('#users-results');
  const resetButton = document.querySelector('#reset-user-search');
  let activeRequestController = null;
  let lastRequestedQuery = '';

  const renderProfiles = (profiles, searchQuery = '') => {
    if (!profiles.length) {
      const message = searchQuery ?
          `No users found for "${escapeHtml(searchQuery)}".` :
          'No users available right now.';
      resultsContainer.innerHTML = `<div class="empty-state">${message}</div>`;
      return;
    }

    resultsContainer.innerHTML =
        profiles.map((profile) => renderUserSearchCard(profile)).join('');
  };

  const refresh = async (searchQuery = '', signal) => {
    const profiles = await loadProfiles(searchQuery, {signal});
    renderProfiles(profiles, searchQuery);
  };

  const runSearch = async (searchQuery, {force = false} = {}) => {
    if (!force && searchQuery === lastRequestedQuery) {
      return;
    }

    if (activeRequestController) {
      activeRequestController.abort();
    }

    lastRequestedQuery = searchQuery;
    const requestController = new AbortController();
    activeRequestController = requestController;

    try {
      await refresh(searchQuery, requestController.signal);
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      if (activeRequestController === requestController) {
        lastRequestedQuery = '';
        setFeedback(error.message, true);
      }
    } finally {
      if (activeRequestController === requestController) {
        activeRequestController = null;
      }
    }
  };

  const scheduleSearch = debounce(() => {
    runSearch(searchInput.value.trim());
  }, 350);

  await runSearch('', {force: true});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    scheduleSearch.cancel();
    await runSearch(searchInput.value.trim(), {force: true});
  });

  searchInput.addEventListener('input', () => {
    scheduleSearch();
  });

  searchInput.addEventListener('change', async () => {
    scheduleSearch.cancel();
    await runSearch(searchInput.value.trim());
  });

  resetButton.addEventListener('click', async () => {
    scheduleSearch.cancel();
    searchInput.value = '';
    lastRequestedQuery = '';
    await runSearch('', {force: true});
  });
}

async function setupCreateRidePage() {
  const form = document.querySelector('#ride-form');
  const carInput = form.querySelector('input[name="car"]');
  const startPointInput = form.querySelector('input[name="startPoint"]');
  const endPointInput = form.querySelector('input[name="endPoint"]');
  const dateInput = form.querySelector('input[name="rideDate"]');
  const startTimeInput = form.querySelector('input[name="startTime"]');
  const endTimeInput = form.querySelector('input[name="endTime"]');
  const swapRouteButton = document.querySelector('#swap-route-button');
  const today = new Date();
  const nextMinute = roundUpToNextMinute(today);

  dateInput.min = formatDateForInput(today);
  dateInput.value = formatDateForInput(today);
  startTimeInput.value = formatTimeForInput(nextMinute);
  endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);

  if (!carInput.value) {
    carInput.value = state.currentUser.defaultCar || '';
  }

  applyUserRouteDefaults(form);

  syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);

  if (swapRouteButton) {
    swapRouteButton.addEventListener('click', () => {
      swapInputValues(startPointInput, endPointInput);
    });
  }

  dateInput.addEventListener('change', () => {
    syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);
  });

  startTimeInput.addEventListener('change', () => {
    syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const ride = Object.fromEntries(formData.entries());

    try {
      const {startWindowStart, startWindowEnd} =
          validateRideDateTime(ride.rideDate, ride.startTime, ride.endTime);

      ride.startWindowStart = startWindowStart;
      ride.startWindowEnd = startWindowEnd;

      openRideConfirmModal({
        ride,
        form,
        carInput,
        dateInput,
        startTimeInput,
        endTimeInput,
      });
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

async function setupSearchRidesPage() {
  const ridesList = document.querySelector('#rides-list');
  const searchForm = document.querySelector('#search-form');
  const resetButton = document.querySelector('#reset-search');
  const driverInput = searchForm.querySelector('input[name="driver"]');
  const startInput = searchForm.querySelector('input[name="start"]');
  const endInput = searchForm.querySelector('input[name="end"]');
  const openOnlyInput = searchForm.querySelector('input[name="openOnly"]');
  let activeRequestController = null;
  let lastRequestedFilterKey = '';

  const readFilters = () => {
    const formData = new FormData(searchForm);

    return {
      driver: String(formData.get('driver') || '').trim(),
      start: String(formData.get('start') || '').trim(),
      end: String(formData.get('end') || '').trim(),
      openOnly: formData.get('openOnly') === 'on',
    };
  };

  const refresh = async (signal) => {
    const rides = await loadRides(state.filters, {signal});
    ridesList.innerHTML = rides.length ?
        rides.map((ride) => renderRideCard(ride)).join('') :
        '<div class="empty-state">No rides found. Try adjusting the filters.</div>';
  };

  const runSearch = async (nextFilters, {force = false} = {}) => {
    const nextFilterKey = JSON.stringify(nextFilters);
    if (!force && nextFilterKey === lastRequestedFilterKey) {
      return;
    }

    if (activeRequestController) {
      activeRequestController.abort();
    }

    state.filters = nextFilters;
    lastRequestedFilterKey = nextFilterKey;
    const requestController = new AbortController();
    activeRequestController = requestController;

    try {
      await refresh(requestController.signal);
      if (activeRequestController !== requestController) {
        return;
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      if (activeRequestController === requestController) {
        lastRequestedFilterKey = '';
        setFeedback(error.message, true);
      }
    } finally {
      if (activeRequestController === requestController) {
        activeRequestController = null;
      }
    }
  };

  const scheduleSearch = debounce(() => {
    runSearch(readFilters());
  }, 350);

  await runSearch(state.filters, {force: true});
  await handleRideActions(ridesList, refresh);

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    scheduleSearch.cancel();
    await runSearch(readFilters(), {force: true});
  });

  [driverInput, startInput, endInput].forEach((input) => {
    input.addEventListener('input', () => {
      scheduleSearch();
    });

    input.addEventListener('change', () => {
      scheduleSearch.cancel();
      runSearch(readFilters());
    });
  });

  openOnlyInput.addEventListener('change', async () => {
    scheduleSearch.cancel();
    await runSearch(readFilters());
  });

  resetButton.addEventListener('click', async () => {
    scheduleSearch.cancel();
    searchForm.reset();
    lastRequestedFilterKey = '';
    await runSearch(
        {driver: '', start: '', end: '', openOnly: false}, {force: true});
  });
}

async function setupMyRidesPage() {
  const drivingContainer = document.querySelector('#my-driving-rides');
  const passengerContainer = document.querySelector('#my-passenger-rides');

  const refresh = async () => {
    const rides = await loadRides();
    const driving =
        rides.filter((ride) => ride.driverId === state.currentUser.id);
    const passenger = rides.filter(
        (ride) => ride.requests.some(
            (request) => request.passengerId === state.currentUser.id &&
                ['pending', 'accepted'].includes(request.status)));

    drivingContainer.innerHTML = driving.length ?
        driving.map((ride) => renderRideCard(ride, {allowRequest: false}))
            .join('') :
        '<div class="empty-state">You have not created any rides yet.</div>';

    passengerContainer.innerHTML = passenger.length ?
        passenger.map((ride) => renderRideCard(ride, {allowRequest: false}))
            .join('') :
        '<div class="empty-state">You have not joined any rides yet.</div>';
  };

  await refresh();
  await handleRideActions(drivingContainer, refresh);
  await handleRideActions(passengerContainer, refresh);
}

function renderDebugSummary(profiles, rides) {
  const requestCount =
      rides.reduce((total, ride) => total + ride.requests.length, 0);
  const messageCount =
      rides.reduce((total, ride) => total + ride.messages.length, 0);

  return `
    <div class="debug-summary-grid">
      <article class="debug-stat-card">
        <strong>${profiles.length}</strong>
        <span>Profiles</span>
      </article>
      <article class="debug-stat-card">
        <strong>${rides.length}</strong>
        <span>Rides</span>
      </article>
      <article class="debug-stat-card">
        <strong>${requestCount}</strong>
        <span>Seat requests</span>
      </article>
      <article class="debug-stat-card">
        <strong>${messageCount}</strong>
        <span>Messages</span>
      </article>
    </div>
  `;
}

function renderDebugUser(profile, rides) {
  const email = profile.email.toLowerCase();
  const drivingRides =
      rides.filter((ride) => ride.driverEmail.toLowerCase() === email);
  const passengerRides = rides.filter(
      (ride) => ride.requests.some(
          (request) => request.passengerEmail.toLowerCase() === email));

  return `
    <article class="debug-card">
      <div class="debug-card-header">
        <div>
          <h3>${escapeHtml(profile.name || 'Unnamed user')}</h3>
          <p class="meta">${escapeHtml(profile.email)}</p>
        </div>
        <div class="pill-row">
          <span class="pill">Driving: ${drivingRides.length}</span>
          <span class="pill">Passenger: ${passengerRides.length}</span>
        </div>
      </div>

      <div class="debug-meta-grid">
        <div>
          <strong>Phone</strong>
          <div class="meta">${escapeHtml(profile.phone || '—')}</div>
        </div>
        <div>
          <strong>Default car</strong>
          <div class="meta">${escapeHtml(profile.defaultCar || '—')}</div>
        </div>
        <div>
          <strong>Default office</strong>
          <div class="meta">${
      escapeHtml(formatOfficeLocation(profile.defaultOffice) || '—')}</div>
        </div>
        <div>
          <strong>Default home</strong>
          <div class="meta">${escapeHtml(profile.defaultHome || '—')}</div>
        </div>
        <div>
          <strong>Created</strong>
          <div class="meta">${formatDateTime(profile.createdAt)}</div>
        </div>
      </div>

      <div class="debug-section-grid">
        <section class="debug-subsection">
          <h4>Rides as driver</h4>
          ${
      drivingRides.length ?
          `
            <ul class="debug-list">
              ${
              drivingRides
                  .map(
                      (ride) => `
                  <li>
                    <strong>${escapeHtml(ride.startPoint)} → ${
                          escapeHtml(ride.endPoint)}</strong>
                    <span class="meta">${
                          formatDateTimeRange(
                              ride.startWindowStart,
                              ride.startWindowEnd,
                              )} · Seats ${ride.seatsLeft}/${
                          ride.seatsTotal}</span>
                  </li>
                `).join('')}
            </ul>
          ` :
          '<div class="empty-state">No rides created by this user.</div>'}
        </section>

        <section class="debug-subsection">
          <h4>Rides as passenger</h4>
          ${
      passengerRides.length ?
          `
            <ul class="debug-list">
              ${
              passengerRides
                  .map((ride) => {
                    const request = ride.requests.find(
                        (item) => item.passengerEmail.toLowerCase() === email);

                    return `
                  <li>
                    <strong>${escapeHtml(ride.startPoint)} → ${
                        escapeHtml(ride.endPoint)}</strong>
                    <span class="meta">Driver: ${
                        escapeHtml(
                            ride.driver?.name || ride.driverEmail)}</span>
                    <span class="pill status-${
                        escapeHtml(request?.status || 'pending')}">${
                        escapeHtml(request?.status || 'pending')}</span>
                  </li>
                `;
                  })
                  .join('')}
            </ul>
          ` :
          '<div class="empty-state">No passenger ride activity for this user.</div>'}
        </section>
      </div>
    </article>
  `;
}

function renderDebugRide(ride) {
  return `
    <article class="debug-card">
      <div class="debug-card-header">
        <div>
          <h3>${escapeHtml(ride.startPoint)} → ${escapeHtml(ride.endPoint)}</h3>
          <p class="meta">Ride ID: ${escapeHtml(ride.id)}</p>
        </div>
        <div class="pill-row">
          <span class="pill">Seats ${ride.seatsLeft}/${ride.seatsTotal}</span>
          <span class="pill">Requests ${ride.requests.length}</span>
          <span class="pill">Messages ${ride.messages.length}</span>
        </div>
      </div>

      <div class="debug-meta-grid">
        <div>
          <strong>Driver</strong>
          <div class="meta">${
      escapeHtml(ride.driver?.name || ride.driverEmail)}</div>
        </div>
        <div>
          <strong>Driver email</strong>
          <div class="meta">${escapeHtml(ride.driverEmail)}</div>
        </div>
        <div>
          <strong>Window</strong>
          <div class="meta">${
      formatDateTimeRange(ride.startWindowStart, ride.startWindowEnd)}</div>
        </div>
        <div>
          <strong>Car</strong>
          <div class="meta">${escapeHtml(ride.car || '—')}</div>
        </div>
      </div>

      <section class="debug-subsection">
        <h4>Notes</h4>
        <div class="meta">${
      escapeHtml(ride.notes || 'No notes for this ride.')}</div>
      </section>

      <div class="debug-section-grid">
        <section class="debug-subsection">
          <h4>Seat requests</h4>
          ${
      ride.requests.length ?
          `
            <ul class="debug-list">
              ${
              ride.requests
                  .map(
                      (request) => `
                  <li>
                    <strong>${
                          escapeHtml(
                              request.passenger?.name ||
                              request.passengerEmail)}</strong>
                    <span class="meta">${
                          escapeHtml(request.passengerEmail)} · ${
                          escapeHtml(request.message || 'No message')}</span>
                    <span class="pill status-${escapeHtml(request.status)}">${
                          escapeHtml(request.status)}</span>
                  </li>
                `).join('')}
            </ul>
          ` :
          '<div class="empty-state">No seat requests yet.</div>'}
        </section>

        <section class="debug-subsection">
          <h4>Messages</h4>
          ${
      ride.messages.length ?
          `
            <ul class="debug-list">
              ${
              ride.messages
                  .map(
                      (message) => `
                  <li>
                    <strong>${
                          escapeHtml(
                              message.sender?.name ||
                              message.senderEmail)}</strong>
                    <span class="meta">${
                          formatDateTime(message.createdAt)}</span>
                    <span>${escapeHtml(message.text)}</span>
                  </li>
                `).join('')}
            </ul>
          ` :
          '<div class="empty-state">No chat messages yet.</div>'}
        </section>
      </div>
    </article>
  `;
}

async function setupDebugPage() {
  const summary = document.querySelector('#debug-summary');
  const usersContainer = document.querySelector('#debug-users-list');
  const ridesContainer = document.querySelector('#debug-rides-list');
  const refreshButton = document.querySelector('#debug-refresh');

  const refresh = async () => {
    const payload = await api('/api/admin/overview');
    const {profiles, rides} = payload;

    summary.innerHTML = renderDebugSummary(profiles, rides);
    usersContainer.innerHTML = profiles.length ?
        profiles.map((profile) => renderDebugUser(profile, rides)).join('') :
        '<div class="empty-state">No users found in the database.</div>';
    ridesContainer.innerHTML = rides.length ?
        rides.map((ride) => renderDebugRide(ride)).join('') :
        '<div class="empty-state">No rides found in the database.</div>';
  };

  await refresh();

  if (refreshButton) {
    refreshButton.addEventListener('click', async () => {
      try {
        await refresh();
      } catch (error) {
        setFeedback(error.message, true);
      }
    });
  }
}

async function setupProfilePage() {
  const form = document.querySelector('#profile-update-form');
  const deleteAccountButton = document.querySelector('#delete-account-button');
  form.elements.name.value = state.currentUser.name || '';
  form.elements.email.value = state.currentUser.email || '';
  form.elements.phone.value = state.currentUser.phone || '';
  form.elements.defaultCar.value = state.currentUser.defaultCar || '';
  form.elements.defaultOffice.value = state.currentUser.defaultOffice || '';
  form.elements.defaultHome.value = state.currentUser.defaultHome || '';

  syncSelectPlaceholderState(form.elements.defaultOffice);
  form.elements.defaultOffice.addEventListener('change', () => {
    syncSelectPlaceholderState(form.elements.defaultOffice);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentEmail = state.currentUser.email;
    const formData = new FormData(form);
    const profile = Object.fromEntries(formData.entries());

    try {
      const payload =
          await api(`/api/profiles/${encodeURIComponent(currentEmail)}`, {
            method: 'PATCH',
            body: JSON.stringify(profile),
          });

      state.currentUser = payload.profile;
      hydrateUserPill();
      setPendingToast('Profile updated successfully.');
      redirectTo(consumeReturnPath(PROFILE_RETURN_PATH_KEY, 'dashboard.html'));
    } catch (error) {
      setFeedback(error.message, true);
    }
  });

  deleteAccountButton?.addEventListener('click', async () => {
    openDeleteAccountModal();
  });
}

async function init() {
  await loadCurrentUser();

  if (protectedPages.has(page) && !ensureAuthenticated()) {
    return;
  }

  if (page === 'debug' && !ensureManager()) {
    return;
  }

  wireReturnPathLinks();
  showPendingToastIfPresent();

  switch (page) {
    case 'landing':
      await setupLandingPage();
      break;
    case 'signup':
      await setupSignupPage();
      break;
    case 'login':
      await setupLoginPage();
      break;
    case 'dashboard':
      await setupDashboardPage();
      break;
    case 'create-ride':
      await setupCreateRidePage();
      break;
    case 'search-rides':
      await setupSearchRidesPage();
      break;
    case 'my-rides':
      await setupMyRidesPage();
      break;
    case 'find-users':
      await setupFindUsersPage();
      break;
    case 'debug':
      await setupDebugPage();
      break;
    case 'profile':
      await setupProfilePage();
      break;
    default:
      break;
  }
}

init().catch((error) => {
  setFeedback(error.message, true);
});
